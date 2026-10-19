// Production diary (daily information): third-level teams enter daily plan / execution per farmer.
var router = require('express').Router();
var db = require('../../../common/db');
var auth = require('../../../common/auth');
var h = require('../../../common/http');
var dates = require('../../../common/dates');
var rule = require('../lib/editRule');
var planExec = require('../lib/planExec');

router.use(auth.requireMenu('diary'));

function currentFive(deptId, day) {
  return db.one("SELECT * FROM production_plans WHERE plan_type = 'five' AND status = 'approved' AND department_id = ? " +
    'AND period_start <= ? AND period_end >= ? LIMIT 1', [deptId, day, day]);
}

router.get('/', h.wrap(async function (req, res) {
  var u = req.user;
  if (u.department_level !== 3) {
    return res.json({ approved: false, level_ok: false,
      message: 'The production diary is written by third-level departments (work teams). Your department is at level ' + u.department_level + '.' });
  }
  var day = dates.today();
  var plan = await currentFive(u.department_id, day);
  if (!plan) {
    return res.json({ approved: false, level_ok: true, department: u.department_name, date: day,
      message: 'The 5-day production plan of ' + u.department_name + ' is not approved, so the diary has not been written.' });
  }
  var farmers = await db.query("SELECT id, full_name FROM users WHERE department_id = ? AND approved = 1 AND role IN ('farmer', 'operator') ORDER BY id",
    [u.department_id]);
  var reports = db.num(await db.query('SELECT * FROM daily_reports WHERE department_id = ? AND report_date = ?', [u.department_id, day]),
    ['plan_qty', 'exec_qty']);
  var tasks = db.num(await db.query('SELECT process, crop, planned_qty, executed_qty FROM plan_tasks WHERE plan_id = ?', [plan.id]),
    ['planned_qty', 'executed_qty']);
  var totalPlan = tasks.reduce(function (s, t) { return s + t.planned_qty; }, 0);
  var days = dates.daysBetween(plan.period_start, plan.period_end);
  var suggested = farmers.length ? Math.round(100 * totalPlan / days / farmers.length) / 100 : 0;
  var rows = farmers.map(function (f) {
    var r = reports.filter(function (x) { return x.farmer_id === f.id; })[0];
    return { farmer_id: f.id, full_name: f.full_name, report_id: r ? r.id : null, plan_qty: r ? r.plan_qty : suggested,
      exec_qty: r ? r.exec_qty : 0, saved: !!r };
  });
  var history = db.num(await db.query('SELECT report_date, SUM(plan_qty) AS plan_qty, SUM(exec_qty) AS exec_qty FROM daily_reports ' +
    'WHERE five_plan_id = ? GROUP BY report_date ORDER BY report_date', [plan.id]), ['plan_qty', 'exec_qty']);
  res.json({ approved: true, level_ok: true, date: day, department: u.department_name,
    plan: { id: plan.id, variant_name: plan.variant_name, period_start: plan.period_start, period_end: plan.period_end,
      tasks: tasks, total_planned: totalPlan },
    rows: rows, history: history });
}));

// Saves today's reports (the date comes from the server clock) and updates the 5-day plan execution.
router.post('/', h.wrap(async function (req, res) {
  var u = req.user;
  if (u.department_level !== 3) throw h.fail(403, 'Only third-level departments write the diary');
  var plan = await currentFive(u.department_id, dates.today());
  if (!plan) throw h.fail(409, 'The 5-day production plan is not approved', { warning: true });
  var rows = (req.body && req.body.rows) || [];
  var valid = (await db.query('SELECT id FROM users WHERE department_id = ?', [u.department_id])).map(function (r) { return r.id; });
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (valid.indexOf(Number(r.farmer_id)) < 0) continue;
    await db.query('INSERT INTO daily_reports (department_id, farmer_id, report_date, five_plan_id, plan_qty, exec_qty, created_by, created_at, updated_at) ' +
      'VALUES (?, ?, CURDATE(), ?, ?, ?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE plan_qty = VALUES(plan_qty), exec_qty = VALUES(exec_qty), ' +
      'five_plan_id = VALUES(five_plan_id), updated_at = NOW()',
    [u.department_id, r.farmer_id, plan.id, Math.max(0, Number(r.plan_qty) || 0), Math.max(0, Number(r.exec_qty) || 0), u.id]);
  }
  var tot = await planExec.recomputeFivePlan(plan.id);
  res.json({ ok: true, message: 'Daily report saved. 5-day plan execution updated: ' + tot.executed.toFixed(2) + ' / ' + tot.planned.toFixed(2) + ' ha.' });
}));

// Earlier dates: editing requires joint ratification (data editing rule).
router.put('/report/:id', h.wrap(async function (req, res) {
  res.json(await rule.editOrRequest('daily_reports', req.params.id, req.body || {}, req.user, function (rec) {
    return planExec.recomputeFivePlan(rec.five_plan_id);
  }));
}));

router.get('/history', h.wrap(async function (req, res) {
  res.json(db.num(await db.query('SELECT r.*, u.full_name FROM daily_reports r JOIN users u ON u.id = r.farmer_id WHERE r.department_id = ? ' +
    'ORDER BY r.report_date DESC, u.full_name LIMIT 200', [req.user.department_id]), ['plan_qty', 'exec_qty']));
}));

module.exports = router;
