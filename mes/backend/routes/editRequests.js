// Joint ratification of edits to data stored on earlier dates.
var router = require('express').Router();
var db = require('../../../common/db');
var h = require('../../../common/http');
var rule = require('../lib/editRule');
var planExec = require('../lib/planExec');

var hooks = { daily_reports: function (rec) { return planExec.recomputeFivePlan(rec.five_plan_id); } };

router.get('/', h.wrap(async function (req, res) {
  var u = req.user;
  var rows = await db.query('SELECT r.*, a.full_name AS requested_by_name, o.full_name AS owner_name FROM edit_requests r ' +
    'JOIN users a ON a.id = r.requested_by LEFT JOIN users o ON o.id = r.owner_id ' +
    'WHERE r.status = ? ' + (rule.isManager(u) ? '' : 'AND (r.owner_id = ? OR r.requested_by = ?) ') + 'ORDER BY r.created_at DESC',
  rule.isManager(u) ? ['pending'] : ['pending', u.id, u.id]);
  res.json(rows);
}));

router.post('/:id/approve', h.wrap(async function (req, res) {
  res.json(await rule.approve(req.params.id, req.user, hooks));
}));

router.post('/:id/reject', h.wrap(async function (req, res) {
  var r = await db.one('SELECT * FROM edit_requests WHERE id = ?', [req.params.id]);
  if (!r) throw h.fail(404, 'Not found');
  if (!(rule.isManager(req.user) || req.user.id === r.owner_id)) throw h.fail(403, 'Not allowed');
  await db.query('UPDATE edit_requests SET status = ? WHERE id = ?', ['rejected', r.id]);
  res.json({ ok: true });
}));

module.exports = router;
