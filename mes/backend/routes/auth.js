var router = require('express').Router();
var db = require('../../../common/db');
var auth = require('../../../common/auth');
var h = require('../../../common/http');

router.post('/login', h.wrap(async function (req, res) {
  var b = req.body || {};
  res.json(await auth.login(b.username, b.password));
}));

router.get('/me', auth.authRequired, function (req, res) { res.json({ user: req.user }); });

// Self registration: the account stays locked until the administrator approves the login.
router.post('/register', h.wrap(async function (req, res) {
  var b = req.body || {};
  if (!b.username || !b.password || !b.full_name || !b.department_id) throw h.fail(400, 'All fields are required');
  var exists = await db.one('SELECT id FROM users WHERE username = ?', [b.username]);
  if (exists) throw h.fail(409, 'Username already exists');
  var salt = auth.newSalt();
  var r = await db.query('INSERT INTO users (username, password_hash, salt, full_name, department_id, role, approved, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, 0, NOW())', [b.username, auth.hashPassword(b.password, salt), salt, b.full_name, b.department_id, 'farmer']);
  await db.query('INSERT INTO user_permissions (user_id, menu_key) VALUES (?, ?)', [r.insertId, 'home']);
  res.json({ ok: true, message: 'Registration received. Wait for administrator approval.' });
}));

router.get('/departments', h.wrap(async function (req, res) {
  res.json(await db.query('SELECT id, name, level, parent_id FROM departments ORDER BY level, id'));
}));

module.exports = router;
