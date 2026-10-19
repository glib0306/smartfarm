// Authentication (PBKDF2 password hashes + HMAC-signed tokens) and authority checks. No external services needed.
var crypto = require('crypto');
var db = require('./db');
var config = require('./config');

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), String(salt), 10000, 32, 'sha256').toString('hex');
}

function newSalt() { return crypto.randomBytes(4).toString('hex'); }

function b64(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function unb64(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(); }
function sign(data) { return crypto.createHmac('sha256', config.tokenSecret).update(data).digest('hex'); }

function issueToken(userId) {
  var body = b64(JSON.stringify({ uid: userId, exp: Date.now() + config.tokenHours * 3600000 }));
  return body + '.' + sign(body);
}

function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  var parts = token.split('.');
  var expected = sign(parts[0]);
  if (parts[1].length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return null;
  try {
    var p = JSON.parse(unb64(parts[0]));
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}

function loadUser(userId) {
  return db.one(
    'SELECT u.id, u.username, u.full_name, u.role, u.approved, u.department_id, d.name AS department_name, ' +
    'd.level AS department_level, d.parent_id AS department_parent_id, d.crop AS department_crop ' +
    'FROM users u JOIN departments d ON d.id = u.department_id WHERE u.id = ?', [userId]
  ).then(function (u) {
    if (!u) return null;
    return db.query('SELECT menu_key FROM user_permissions WHERE user_id = ?', [userId]).then(function (rows) {
      u.permissions = rows.map(function (r) { return r.menu_key; });
      return u;
    });
  });
}

function authRequired(req, res, next) {
  var h = req.headers.authorization || '';
  var token = h.indexOf('Bearer ') === 0 ? h.slice(7) : (req.query.token || '');
  var p = verifyToken(token);
  if (!p) return res.status(401).json({ error: 'Login required' });
  loadUser(p.uid).then(function (u) {
    if (!u || !u.approved) return res.status(401).json({ error: 'User not approved' });
    req.user = u;
    next();
  }).catch(next);
}

// Only users whose identifier carries the menu permission (or admins) may use the endpoint.
function requireMenu(key) {
  return function (req, res, next) {
    if (req.user.role === 'admin' || req.user.permissions.indexOf(key) >= 0) return next();
    res.status(403).json({ error: 'You do not have permission for this function (' + key + ')' });
  };
}

function requireAdmin(req, res, next) {
  if (req.user.role === 'admin') return next();
  res.status(403).json({ error: 'Administrator only' });
}

function login(username, password) {
  return db.one('SELECT id, password_hash, salt, approved FROM users WHERE username = ?', [username]).then(function (u) {
    if (!u || hashPassword(password, u.salt) !== u.password_hash) {
      var e = new Error('Wrong username or password'); e.status = 401; throw e;
    }
    if (!u.approved) { var e2 = new Error('Your login has not been approved by the administrator yet'); e2.status = 403; throw e2; }
    return loadUser(u.id).then(function (user) { return { token: issueToken(u.id), user: user }; });
  });
}

module.exports = { hashPassword: hashPassword, newSalt: newSalt, issueToken: issueToken, verifyToken: verifyToken,
  authRequired: authRequired, requireMenu: requireMenu, requireAdmin: requireAdmin, login: login, loadUser: loadUser };
