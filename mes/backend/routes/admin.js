// Authorization management (administrator only): users, login approval, menu permissions, organisation hierarchy.
var router = require('express').Router();
var db = require('../../../common/db');
var auth = require('../../../common/auth');
var h = require('../../../common/http');

var MENUS = [
  { key: 'home', label: 'Home screen' },
  { key: 'layout', label: 'Variety layout' },
  { key: 'annual', label: 'Annual production plan' },
  { key: 'monthly', label: 'Monthly production plan' },
  { key: 'fifteen', label: '15-day production plan' },
  { key: 'five', label: '5-day production plan' },
  { key: 'weather', label: 'Weather' },
  { key: 'fulfilment', label: 'Fulfilment of plan' },
  { key: 'power_consumption', label: 'Power consumption' },
  { key: 'power_system', label: 'Power system status' },
  { key: 'growth', label: 'Growth forecast' },
  { key: 'pest', label: 'Pest monitoring' },
  { key: 'equipment', label: 'Equipment management' },
  { key: 'machinery_map', label: 'Harvest & machinery map' },
  { key: 'irrigation', label: 'Irrigation system' },
  { key: 'diary', label: 'Production daily information' },
  { key: 'decision', label: 'Decision support (ERP optimisation)' },
  { key: 'admin', label: 'Authorization management' }
];

router.use(auth.requireAdmin);

router.get('/menus', function (req, res) { res.json(MENUS); });

router.get('/users', h.wrap(async function (req, res) {
  var users = await db.query('SELECT u.id, u.username, u.full_name, u.role, u.approved, u.department_id, u.created_at, ' +
    'd.name AS department_name, d.level AS department_level FROM users u JOIN departments d ON d.id = u.department_id ' +
    'ORDER BY u.approved, d.level, u.department_id, u.id');
  var perms = await db.query('SELECT user_id, menu_key FROM user_permissions');
  var map = {};
  perms.forEach(function (p) { (map[p.user_id] = map[p.user_id] || []).push(p.menu_key); });
  users.forEach(function (u) { u.permissions = map[u.id] || []; });
  res.json(users);
}));

router.post('/users', h.wrap(async function (req, res) {
  var b = req.body || {};
  if (!b.username || !b.password || !b.full_name || !b.department_id) throw h.fail(400, 'username, password, full name and department are required');
  if (await db.one('SELECT id FROM users WHERE username = ?', [b.username])) throw h.fail(409, 'Username already exists');
  var salt = auth.newSalt();
  var r = await db.query('INSERT INTO users (username, password_hash, salt, full_name, department_id, role, approved, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, NOW())', [b.username, auth.hashPassword(b.password, salt), salt, b.full_name,
    b.department_id, b.role || 'operator', b.approved ? 1 : 0]);
  await setPermissions(r.insertId, b.permissions || ['home']);
  res.json({ id: r.insertId });
}));

router.put('/users/:id', h.wrap(async function (req, res) {
  var b = req.body || {};
  var u = await db.one('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!u) throw h.fail(404, 'User not found');
  await db.query('UPDATE users SET full_name = ?, department_id = ?, role = ?, approved = ? WHERE id = ?',
    [b.full_name || u.full_name, b.department_id || u.department_id, b.role || u.role,
      b.approved === undefined ? u.approved : (b.approved ? 1 : 0), u.id]);
  if (b.password) {
    var salt = auth.newSalt();
    await db.query('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?', [auth.hashPassword(b.password, salt), salt, u.id]);
  }
  if (Array.isArray(b.permissions)) await setPermissions(u.id, b.permissions);
  res.json({ ok: true });
}));

router.post('/users/:id/approve', h.wrap(async function (req, res) {
  await db.query('UPDATE users SET approved = ? WHERE id = ?', [req.body && req.body.approved === false ? 0 : 1, req.params.id]);
  res.json({ ok: true });
}));

async function setPermissions(userId, menus) {
  var valid = MENUS.map(function (m) { return m.key; });
  await db.query('DELETE FROM user_permissions WHERE user_id = ?', [userId]);
  var rows = menus.filter(function (m) { return valid.indexOf(m) >= 0; }).map(function (m) { return [userId, m]; });
  if (rows.length) await db.query('INSERT INTO user_permissions (user_id, menu_key) VALUES ?', [rows]);
}

// ---- organisation system (hierarchical structure)
router.get('/departments', h.wrap(async function (req, res) {
  res.json(await db.query('SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS members ' +
    'FROM departments d ORDER BY d.level, d.id'));
}));

router.post('/departments', h.wrap(async function (req, res) {
  var b = req.body || {};
  if (!b.name) throw h.fail(400, 'Name is required');
  var level = 1;
  if (b.parent_id) {
    var parent = await db.one('SELECT level FROM departments WHERE id = ?', [b.parent_id]);
    if (!parent) throw h.fail(400, 'Parent department not found');
    if (parent.level >= 3) throw h.fail(400, 'The organisation has at most three levels');
    level = parent.level + 1;
  }
  var r = await db.query('INSERT INTO departments (name, parent_id, level, crop) VALUES (?, ?, ?, ?)',
    [b.name, b.parent_id || null, level, b.crop || null]);
  res.json({ id: r.insertId });
}));

router.put('/departments/:id', h.wrap(async function (req, res) {
  var b = req.body || {};
  await db.query('UPDATE departments SET name = ?, crop = ? WHERE id = ?', [b.name, b.crop || null, req.params.id]);
  res.json({ ok: true });
}));

router.delete('/departments/:id', h.wrap(async function (req, res) {
  var used = await db.one('SELECT (SELECT COUNT(*) FROM users WHERE department_id = ?) + ' +
    '(SELECT COUNT(*) FROM departments WHERE parent_id = ?) + (SELECT COUNT(*) FROM fields WHERE department_id = ?) AS n',
  [req.params.id, req.params.id, req.params.id]);
  if (used.n > 0) throw h.fail(409, 'Department still has members, sub-departments or fields');
  await db.query('DELETE FROM departments WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.MENUS = MENUS;
