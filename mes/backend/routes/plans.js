// Production plans and orders: annual (ERP submission), monthly, 15-day and 5-day plan variants with approval.
var router = require('express').Router();
var db = require('../../../common/db');
var auth = require('../../../common/auth');
var h = require('../../../common/http');
var dates = require('../../../common/dates');
var svc = require('../lib/planService');

var LABEL = { annual: 'annual', monthly: 'monthly', fifteen: '15-day', five: '5-day' };

function menuFor(type) { return function (req, res, next) { return auth.requireMenu(type)(req, res, next); }; }

async function respond(res, type, deptId, period, parent, user, extra) {
  var plans = await svc.loadPlans('p.plan_type = ? AND p.department_id = ? AND p.period_start = ? AND p.period_end = ?',
    [type, deptId, period[0], period[1]]);
  if (!plans.length && parent) {
    await svc.generate(type, parent, deptId, period[0], period[1]);
    plans = await svc.loadPlans('p.plan_type = ? AND p.department_id = ? AND p.period_start = ? AND p.period_end = ?',
      [type, deptId, period[0], period[1]]);
  }
  var can = plans.length ? await svc.canApprove(user, plans[0]) : false;
  res.json(Object.assign({ type: type, department_id: deptId, period: { start: period[0], end: period[1] },
    parent: parent ? { id: parent.id, variant_name: parent.variant_name, period_start: parent.period_start,
      period_end: parent.period_end, plan_type: parent.plan_type } : null,
    plans: plans, can_approve: can,
    approved_id: (plans.filter(function (p) { return p.status === 'approved'; })[0] || {}).id || null,
    info: plans.length ? null : 'The parent plan has no production tasks in this period for the selected department.'
  }, extra || {}));
}

// ------------------------------------------------------------------ annual
router.get('/annual', menuFor('annual'), h.wrap(async function (req, res) {
  var year = parseInt(req.query.year || new Date().getFullYear(), 10);
  var where = "p.plan_type = 'annual' AND YEAR(p.period_start) = ?";
  var plans = await svc.loadPlans(where, [year]);
  if (!plans.length) {
    await svc.generateAnnual(year);
    plans = await svc.loadPlans(where, [year]);
  }
  var sub = plans.filter(function (p) { return p.status === 'submitted'; })[0];
  res.json({ type: 'annual', year: year, plans: plans, submitted_id: sub ? sub.id : null,
    can_submit: req.user.role === 'admin' || (req.user.role === 'manager' && req.user.department_level === 1) });
}));

router.post('/:id/submit', menuFor('annual'), h.wrap(async function (req, res) {
  var plan = (await svc.loadPlans('p.id = ?', [req.params.id]))[0];
  if (!plan || plan.plan_type !== 'annual') throw h.fail(404, 'Annual plan not found');
  if (!(await svc.canApprove(req.user, plan))) throw h.fail(403, 'You are not authorised to submit plans to ERP');
  if (plan.status === 'submitted') throw h.fail(409, 'This plan has already been submitted to ERP.', { warning: true });
  var other = await db.one("SELECT id, variant_name FROM production_plans WHERE plan_type = 'annual' AND status = 'submitted' " +
    'AND YEAR(period_start) = YEAR(?) AND id <> ?', [plan.period_start, plan.id]);
  if (other) throw h.fail(409, 'A plan (' + other.variant_name + ') has already been submitted. Cancel that submission first.', { warning: true });
  var payload = { plan_id: plan.id, plan_type: 'annual', variant: plan.variant_name, period: [plan.period_start, plan.period_end],
    expected_yield_t: plan.expected_yield_t, expected_cost: plan.expected_cost, tasks: plan.tasks.map(function (t) {
      return { crop: t.crop, process: t.process, department: t.department_name, start: t.start_date, end: t.end_date, ha: t.planned_qty };
    }),
    labor: plan.resources.filter(function (r) { return r.resource_type === 'labor'; }),
    equipment: plan.resources.filter(function (r) { return r.resource_type === 'equipment'; }),
    materials: plan.resources.filter(function (r) { return r.resource_type === 'material'; }) };
  await db.query("INSERT INTO erp_submissions (ref_type, ref_id, payload, status, submitted_by, submitted_at) VALUES ('plan', ?, ?, 'submitted', ?, NOW())",
    [plan.id, JSON.stringify(payload), req.user.id]);
  await db.query("UPDATE production_plans SET status = 'submitted', status_by = ?, status_at = NOW() WHERE id = ?", [req.user.id, plan.id]);
  res.json({ ok: true, message: 'Submitted: "' + plan.variant_name + '" with its labour, equipment and materials was transferred to ERP and ratified.' });
}));

router.post('/:id/cancel-submit', menuFor('annual'), h.wrap(async function (req, res) {
  var plan = await db.one('SELECT * FROM production_plans WHERE id = ?', [req.params.id]);
  if (!plan || plan.status !== 'submitted') throw h.fail(409, 'Plan is not submitted', { warning: true });
  if (!(await svc.canApprove(req.user, plan))) throw h.fail(403, 'Not authorised');
  await db.query("UPDATE erp_submissions SET status = 'cancelled', cancelled_at = NOW() WHERE ref_type = 'plan' AND ref_id = ? AND status = 'submitted'", [plan.id]);
  await db.query("UPDATE production_plans SET status = 'draft', status_by = ?, status_at = NOW() WHERE id = ?", [req.user.id, plan.id]);
  res.json({ ok: true, message: 'Submission to ERP cancelled.' });
}));

// ------------------------------------------------------------------ monthly (first level of the organisation only)
router.get('/monthly', menuFor('monthly'), h.wrap(async function (req, res) {
  if (req.user.role !== 'admin' && req.user.department_level !== 1) throw h.fail(403, 'Only first-level subscribers may browse the monthly plan');
  var day = req.query.date || dates.today();
  var period = dates.monthBounds(day);
  var parent = await svc.approvedPlan('annual', 1, period[0]);
  if (!parent) return res.json({ type: 'monthly', warning: 'There is no approved annual production plan. Submit an annual plan to ERP first.', plans: [] });
  await respond(res, 'monthly', 1, period, parent, req.user);
}));

// ------------------------------------------------------------------ 15-day (second-level departments)
router.get('/fifteen', menuFor('fifteen'), h.wrap(async function (req, res) {
  var u = req.user;
  var options;
  if (u.role === 'admin' || u.department_level === 1) {
    options = await db.query('SELECT id, name FROM departments WHERE level = 2 AND crop IS NOT NULL ORDER BY id');
  } else if (u.department_level === 2) {
    options = [{ id: u.department_id, name: u.department_name }];
  } else throw h.fail(403, 'The 15-day plan can be browsed down to the second level only');
  var deptId = parseInt(req.query.department_id || (options[0] && options[0].id), 10);
  if (!options.some(function (o) { return o.id === deptId; })) throw h.fail(403, 'Department not allowed');
  var day = req.query.date || dates.today();
  var parent = await svc.approvedPlan('monthly', 1, day);
  var extra = { departments: options };
  if (!parent) return res.json(Object.assign({ type: 'fifteen', department_id: deptId, plans: [],
    warning: 'There is no approved monthly production plan for this month.' }, extra));
  // period: keep the period of existing plans unless a different split (14/15/16) is requested and nothing is approved
  var existing = await db.query("SELECT period_start, period_end, MAX(status = 'approved') AS appr FROM production_plans WHERE plan_type = 'fifteen' " +
    'AND department_id = ? AND period_start <= ? AND period_end >= ? GROUP BY period_start, period_end', [deptId, day, day]);
  var period = dates.findPeriod(dates.fifteenPeriods(day, req.query.split), day);
  if (existing.length) {
    var ex = existing[0];
    var differs = ex.period_start !== period[0] || ex.period_end !== period[1];
    if (!req.query.split || !differs) period = [ex.period_start, ex.period_end];
    else if (existing.some(function (e) { return Number(e.appr) === 1; })) {
      extra.warning_split = 'A 15-day plan for ' + ex.period_start + ' .. ' + ex.period_end + ' is already approved; the period cannot be changed.';
      period = [ex.period_start, ex.period_end];
    } else {
      var drafts = await db.query("SELECT id FROM production_plans WHERE plan_type = 'fifteen' AND department_id = ? AND period_start = ? AND period_end = ?",
        [deptId, ex.period_start, ex.period_end]);
      var ids = drafts.map(function (d) { return d.id; });
      if (ids.length) {
        await db.query('DELETE FROM plan_tasks WHERE plan_id IN (?)', [ids]);
        await db.query('DELETE FROM plan_resources WHERE plan_id IN (?)', [ids]);
        await db.query('DELETE FROM production_plans WHERE id IN (?)', [ids]);
      }
    }
  }
  extra.days = dates.daysBetween(period[0], period[1]);
  await respond(res, 'fifteen', deptId, period, parent, u, extra);
}));

// ------------------------------------------------------------------ 5-day (third-level departments)
router.get('/five', menuFor('five'), h.wrap(async function (req, res) {
  var u = req.user;
  var options;
  if (u.role === 'admin' || u.department_level === 1) {
    options = await db.query('SELECT d.id, d.name FROM departments d WHERE d.level = 3 AND EXISTS (SELECT 1 FROM fields f WHERE f.department_id = d.id) ORDER BY d.id');
  } else if (u.department_level === 2) {
    options = await db.query('SELECT id, name FROM departments WHERE parent_id = ? ORDER BY id', [u.department_id]);
  } else {
    options = [{ id: u.department_id, name: u.department_name }];
  }
  var deptId = parseInt(req.query.department_id || (options[0] && options[0].id), 10);
  if (!options.some(function (o) { return o.id === deptId; })) throw h.fail(403, 'Department not allowed');
  var dept = await db.one('SELECT * FROM departments WHERE id = ?', [deptId]);
  var day = req.query.date || dates.today();
  var parent = await svc.approvedPlan('fifteen', dept.parent_id, day);
  var extra = { departments: options };
  if (!parent) return res.json(Object.assign({ type: 'five', department_id: deptId, plans: [],
    warning: 'There is no approved 15-day production plan for the parent department of ' + dept.name + '.' }, extra));
  var period = dates.findPeriod(dates.fivePeriods(parent.period_start, parent.period_end), day);
  extra.days = dates.daysBetween(period[0], period[1]);
  await respond(res, 'five', deptId, period, parent, u, extra);
}));

// ------------------------------------------------------------------ approval
router.post('/:id/approve', h.wrap(async function (req, res) {
  var plan = await db.one('SELECT * FROM production_plans WHERE id = ?', [req.params.id]);
  if (!plan || plan.plan_type === 'annual') throw h.fail(404, 'Plan not found');
  if (!(await svc.canApprove(req.user, plan))) throw h.fail(403, 'You are not authorised to approve ' + LABEL[plan.plan_type] + ' plans');
  if (plan.status === 'approved') throw h.fail(409, 'This plan has already been approved.', { warning: true });
  var other = await db.one("SELECT id, variant_name FROM production_plans WHERE plan_type = ? AND department_id = ? AND period_start = ? " +
    "AND status = 'approved' AND id <> ?", [plan.plan_type, plan.department_id, plan.period_start, plan.id]);
  if (other) throw h.fail(409, 'A plan (' + other.variant_name + ') has already been approved for this period. Cancel its approval first.', { warning: true });
  await db.query("UPDATE production_plans SET status = 'approved', status_by = ?, status_at = NOW() WHERE id = ?", [req.user.id, plan.id]);
  res.json({ ok: true, message: 'Approved: ' + plan.variant_name + ' is now the ' + LABEL[plan.plan_type] + ' production order.' });
}));

router.post('/:id/cancel-approval', h.wrap(async function (req, res) {
  var plan = await db.one('SELECT * FROM production_plans WHERE id = ?', [req.params.id]);
  if (!plan || plan.status !== 'approved') throw h.fail(409, 'Plan is not approved', { warning: true });
  if (!(await svc.canApprove(req.user, plan))) throw h.fail(403, 'Not authorised');
  var children = await db.one("SELECT COUNT(*) AS n FROM production_plans WHERE parent_id = ? AND status = 'approved'", [plan.id]);
  await db.query("UPDATE production_plans SET status = 'draft', status_by = ?, status_at = NOW() WHERE id = ?", [req.user.id, plan.id]);
  res.json({ ok: true, message: 'Approval cancelled.' + (children.n ? ' Warning: ' + children.n + ' approved lower-level plan(s) were derived from it.' : '') });
}));

router.get('/:id', h.wrap(async function (req, res) {
  var p = (await svc.loadPlans('p.id = ?', [req.params.id]))[0];
  if (!p) throw h.fail(404, 'Plan not found');
  res.json(p);
}));

module.exports = router;
