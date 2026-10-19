// Fulfilment (execution) of plans: farm-wide %, per-department %, and plan vs result per process.
var router = require('express').Router();
var db = require('../../../common/db');
var auth = require('../../../common/auth');
var h = require('../../../common/http');
var dates = require('../../../common/dates');
var svc = require('../lib/planService');

router.use(auth.requireMenu('fulfilment'));

function pct(e, p) { return p > 0 ? Math.round(1000 * e / p) / 10 : 0; }
function r2(v) { return Math.round(v * 100) / 100; }

// Planned quantity due until "day" (pro rata within each 5-day plan) and executed quantity, per team.
async function teamProgress(monthStart, day) {
  var rows = await db.query("SELECT p.id, p.department_id, p.period_start, p.period_end, SUM(t.planned_qty) AS planned, SUM(t.executed_qty) AS executed " +
    "FROM production_plans p JOIN plan_tasks t ON t.plan_id = p.id WHERE p.plan_type = 'five' AND p.status = 'approved' " +
    'AND p.period_start >= ? AND p.period_start <= ? GROUP BY p.id, p.department_id, p.period_start, p.period_end', [monthStart, day]);
  var by = {};
  rows.forEach(function (r) {
    var len = dates.daysBetween(r.period_start, r.period_end);
    // days already finished (reports of today are still being written)
    var lastDone = day <= r.period_end ? dates.ymd(dates.addDays(dates.parse(day), -1)) : r.period_end;
    var elapsed = Math.max(0, Math.min(len, dates.daysBetween(r.period_start, lastDone)));
    var b = by[r.department_id] = by[r.department_id] || { planned: 0, executed: 0, total_planned: 0 };
    b.planned += Number(r.planned) * elapsed / len;
    b.total_planned += Number(r.planned);
    b.executed += Number(r.executed);
  });
  return by;
}

router.get('/summary', h.wrap(async function (req, res) {
  var day = req.query.date || dates.today();
  var mb = dates.monthBounds(day);
  var prog = await teamProgress(mb[0], day);
  var depts = await db.query('SELECT id, name, level, parent_id FROM departments WHERE level > 1 AND crop IS NOT NULL ORDER BY level, id');
  var out = depts.map(function (d) {
    var teams = d.level === 3 ? [d.id] : depts.filter(function (x) { return x.parent_id === d.id; }).map(function (x) { return x.id; });
    var p = 0;
    var e = 0;
    teams.forEach(function (t) { if (prog[t]) { p += prog[t].planned; e += prog[t].executed; } });
    return { id: d.id, name: d.name, level: d.level, planned: r2(p), executed: r2(e), pct: pct(e, p) };
  });
  var P = 0;
  var E = 0;
  Object.keys(prog).forEach(function (k) { P += prog[k].planned; E += prog[k].executed; });
  var monthly = await svc.approvedPlan('monthly', 1, day);
  var mp = monthly ? Number((await db.one('SELECT SUM(planned_qty) AS p FROM plan_tasks WHERE plan_id = ?', [monthly.id])).p) : 0;
  res.json({ date: day, month: mb,
    farm: { planned_to_date: r2(P), executed: r2(E), pct: pct(E, P), month_planned: r2(mp), month_pct: pct(E, mp),
      monthly_plan: monthly ? monthly.variant_name : null },
    departments: out });
}));

async function execByProcess(teams, ps, pe) {
  var rows = await db.query("SELECT t.process, SUM(t.executed_qty) AS ex FROM plan_tasks t JOIN production_plans p ON p.id = t.plan_id " +
    "WHERE p.plan_type = 'five' AND p.status = 'approved' AND p.department_id IN (?) AND p.period_start >= ? AND p.period_end <= ? " +
    'GROUP BY t.process', [teams, ps, pe]);
  var m = {};
  rows.forEach(function (r) { m[r.process] = Number(r.ex); });
  return m;
}

async function compare(plans, teams, useOwnExec) {
  if (!plans.length) return null;
  var ids = plans.map(function (p) { return p.id; });
  var tasks = await db.query('SELECT process, SUM(planned_qty) AS planned, SUM(executed_qty) AS executed, MIN(id) AS first_id FROM plan_tasks ' +
    'WHERE plan_id IN (?) AND department_id IN (?) GROUP BY process ORDER BY first_id', [ids, teams]);
  var ex = useOwnExec ? null : await execByProcess(teams, plans[0].period_start, plans[0].period_end);
  return {
    period: [plans[0].period_start, plans[0].period_end],
    plans: plans.map(function (p) { return p.variant_name; }),
    rows: tasks.map(function (t) {
      var e = useOwnExec ? Number(t.executed) : (ex[t.process] || 0);
      return { process: t.process, planned: r2(Number(t.planned)), executed: r2(e), pct: pct(e, Number(t.planned)) };
    })
  };
}

router.get('/departments', h.wrap(async function (req, res) {
  res.json(await db.query('SELECT id, name, level FROM departments WHERE crop IS NOT NULL ORDER BY level, id'));
}));

router.get('/department/:id', h.wrap(async function (req, res) {
  var day = req.query.date || dates.today();
  var dept = await db.one('SELECT * FROM departments WHERE id = ?', [req.params.id]);
  if (!dept) throw h.fail(404, 'Department not found');
  var teams = await svc.teamIds(dept.id);
  if (!teams.length) teams = [dept.id];
  var divs = dept.level === 3 ? [dept.parent_id] : (dept.level === 2 ? [dept.id]
    : (await db.query('SELECT id FROM departments WHERE level = 2')).map(function (r) { return r.id; }));
  var five = await db.query("SELECT * FROM production_plans WHERE plan_type = 'five' AND status = 'approved' AND department_id IN (?) " +
    'AND period_start <= ? AND period_end >= ?', [teams, day, day]);
  if (!five.length) {
    var last = await db.one("SELECT MAX(period_start) AS s FROM production_plans WHERE plan_type = 'five' AND status = 'approved' " +
      'AND department_id IN (?) AND period_start <= ?', [teams, day]);
    if (last && last.s) {
      five = await db.query("SELECT * FROM production_plans WHERE plan_type = 'five' AND status = 'approved' AND department_id IN (?) AND period_start = ?",
        [teams, last.s]);
    }
  }
  var fifteen = await db.query("SELECT * FROM production_plans WHERE plan_type = 'fifteen' AND status = 'approved' AND department_id IN (?) " +
    'AND period_start <= ? AND period_end >= ?', [divs, day, day]);
  var monthly = await db.query("SELECT * FROM production_plans WHERE plan_type = 'monthly' AND status = 'approved' " +
    'AND period_start <= ? AND period_end >= ?', [day, day]);
  res.json({ department: dept, five: await compare(five, teams, true), fifteen: await compare(fifteen, teams, false),
    monthly: await compare(monthly, teams, false) });
}));

module.exports = router;
