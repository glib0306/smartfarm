// Production plan service: loading, generating variants (annual -> monthly -> 15-day -> 5-day) and authority rules.
var db = require('../../../common/db');
var py = require('../../../common/python');
var dates = require('../../../common/dates');

var REVENUE = { rice: 7.4 * 1350, wheat: 5.2 * 1100 };
var YIELD = { rice: 7.4, wheat: 5.2 };

async function loadPlans(where, params) {
  var plans = await db.query('SELECT p.*, d.name AS department_name, u.full_name AS status_by_name FROM production_plans p ' +
    'JOIN departments d ON d.id = p.department_id LEFT JOIN users u ON u.id = p.status_by WHERE ' + where +
    ' ORDER BY p.variant_no', params);
  if (!plans.length) return [];
  var ids = plans.map(function (p) { return p.id; });
  var tasks = db.num(await db.query('SELECT t.*, d.name AS department_name FROM plan_tasks t LEFT JOIN departments d ' +
    'ON d.id = t.department_id WHERE t.plan_id IN (?) ORDER BY t.start_date, t.process', [ids]), ['planned_qty', 'executed_qty']);
  var res = db.num(await db.query('SELECT * FROM plan_resources WHERE plan_id IN (?) ORDER BY resource_type, process, name', [ids]),
    ['quantity', 'cost']);
  plans.forEach(function (p) {
    db.num([p], ['mech_ratio', 'expected_yield_t', 'expected_cost', 'expected_revenue', 'efficiency']);
    p.tasks = tasks.filter(function (t) { return t.plan_id === p.id; });
    p.resources = res.filter(function (r) { return r.plan_id === p.id; });
    var c = { labor: 0, equipment: 0, material: 0 };
    p.resources.forEach(function (r) { c[r.resource_type] = (c[r.resource_type] || 0) + r.cost; });
    p.cost_breakdown = c;
  });
  return plans;
}

async function normMap() {
  var rows = await db.query('SELECT * FROM process_norms');
  var m = {};
  rows.forEach(function (n) {
    m[n.crop + '|' + n.process] = { labor_manual: Number(n.labor_manual), labor_mech: Number(n.labor_mech),
      machine_h: Number(n.machine_h), equipment_type: n.equipment_type, material: n.material,
      material_per_ha: Number(n.material_per_ha), material_unit: n.material_unit, material_price: Number(n.material_price) };
  });
  return { map: m, rows: rows };
}

async function teamIds(deptId) {
  var d = await db.one('SELECT * FROM departments WHERE id = ?', [deptId]);
  if (!d) return [];
  if (d.level === 3) return [d.id];
  if (d.level === 2) return (await db.query('SELECT id FROM departments WHERE parent_id = ?', [d.id])).map(function (r) { return r.id; });
  return (await db.query('SELECT id FROM departments WHERE level = 3')).map(function (r) { return r.id; });
}

async function capacity(deptId, days) {
  var teams = await teamIds(deptId);
  var tot = await db.one('SELECT SUM(area_ha) AS a FROM fields');
  var part = teams.length ? await db.one('SELECT SUM(area_ha) AS a FROM fields WHERE department_id IN (?)', [teams]) : { a: 0 };
  var share = Number(part.a || 0) / Number(tot.a || 1);
  var eq = await db.query("SELECT type, COUNT(*) AS n FROM equipment WHERE status <> 'repair' GROUP BY type");
  var cap = {};
  eq.forEach(function (e) { cap[e.type] = e.n * 10 * days * 0.8 * share; });
  return cap;
}

async function processCount() {
  var rows = await db.query('SELECT crop, COUNT(*) AS n FROM process_norms GROUP BY crop');
  var m = {};
  rows.forEach(function (r) { m[r.crop] = r.n; });
  return m;
}

async function insertVariants(type, parentId, deptId, ps, pe, result) {
  return db.transaction(async function (q) {
    var exists = await q('SELECT id FROM production_plans WHERE plan_type = ? AND department_id = ? AND period_start = ? AND period_end = ?',
      [type, deptId, ps, pe]);
    if (exists.length) return;
    for (var i = 0; i < result.variants.length; i++) {
      var v = result.variants[i];
      var r = await q('INSERT INTO production_plans (plan_type, parent_id, department_id, variant_no, variant_name, period_start, ' +
        'period_end, status, mech_ratio, expected_yield_t, expected_cost, expected_revenue, efficiency, created_at) ' +
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, NOW())",
      [type, parentId, deptId, i + 1, v.name, ps, pe, v.mech_ratio, v.yield_t, v.cost.total, v.revenue, v.efficiency]);
      var pid = r.insertId;
      if (result.tasks.length) {
        await q('INSERT INTO plan_tasks (plan_id, crop, process, department_id, start_date, end_date, planned_qty, executed_qty) VALUES ?',
          [result.tasks.map(function (t) { return [pid, t.crop, t.process, t.department_id, t.start_date, t.end_date, t.planned_qty, 0]; })]);
      }
      if (v.resources.length) {
        await q('INSERT INTO plan_resources (plan_id, process, resource_type, name, quantity, unit, cost) VALUES ?',
          [v.resources.map(function (x) { return [pid, x.process, x.resource_type, x.name, x.quantity, x.unit, x.cost]; })]);
      }
    }
  });
}

// Generates plan variants for a period from the approved parent plan (LP optimisation in Python).
async function generate(type, parent, deptId, ps, pe) {
  var parentTasks = db.num(await db.query('SELECT crop, process, department_id, start_date, end_date, planned_qty FROM plan_tasks WHERE plan_id = ?',
    [parent.id]), ['planned_qty']);
  var teams = type === 'monthly' ? null : await teamIds(deptId);
  var norms = await normMap();
  var prices = await db.query('SELECT * FROM prices');
  var pm = {};
  prices.forEach(function (p) { pm[p.item] = Number(p.value); });
  var result = await py.run('derive_plan', {
    parent_tasks: parentTasks, period_start: ps, period_end: pe, department_ids: teams, norms: norms.map,
    equipment_capacity: await capacity(deptId, dates.daysBetween(ps, pe)),
    prices: { labor_md: pm.labor_md || 12, machine_h: pm.machine_h || 25 },
    revenue_per_ha: { rice: YIELD.rice * (pm.rice_seed_t || 1350), wheat: YIELD.wheat * (pm.wheat_seed_t || 1100) },
    yield_per_ha: YIELD, process_count: await processCount()
  });
  if (!result.tasks.length) return false;
  await insertVariants(type, parent.id, deptId, ps, pe, result);
  return true;
}

// Annual variants for a year with no plan yet (built from process norms and the current variety layout).
async function generateAnnual(year) {
  var norms = await normMap();
  var areas = await db.query('SELECT crop, department_id, SUM(area_ha) AS a FROM fields GROUP BY crop, department_id');
  var tasks = [];
  norms.rows.forEach(function (n) {
    areas.forEach(function (a) {
      if (a.crop !== n.crop) return;
      var s = dates.addDays(new Date(year, 0, 1), n.start_doy);
      var e = dates.addDays(new Date(year, 0, 1), n.end_doy);
      tasks.push({ crop: n.crop, process: n.process, department_id: a.department_id, start_date: dates.ymd(s),
        end_date: dates.ymd(e), planned_qty: Number(Number(a.a).toFixed(2)) });
    });
  });
  var ps = year + '-01-01';
  var pe = year + '-12-31';
  var result = await py.run('derive_plan', {
    parent_tasks: tasks, period_start: ps, period_end: pe, department_ids: null, norms: norms.map,
    equipment_capacity: await capacity(1, 365), revenue_per_ha: REVENUE, yield_per_ha: YIELD, process_count: await processCount(),
    variants: [{ name: 'Variant A - balanced', capacity_factor: 0.5 }, { name: 'Variant B - mechanised', capacity_factor: 1.0 }]
  });
  await insertVariants('annual', null, 1, ps, pe, result);
}

async function approvedPlan(type, deptId, day) {
  var status = type === 'annual' ? 'submitted' : 'approved';
  return db.one('SELECT * FROM production_plans WHERE plan_type = ? AND department_id = ? AND status = ? AND period_start <= ? ' +
    'AND period_end >= ? ORDER BY id DESC LIMIT 1', [type, deptId, status, day, day]);
}

// Authority: who can approve a plan of the given type for the given department.
async function canApprove(user, plan) {
  if (user.role === 'admin') return true;
  if (user.role !== 'manager') return false;
  if (plan.plan_type === 'annual' || plan.plan_type === 'monthly' || plan.plan_type === 'fifteen') return user.department_level === 1;
  if (plan.plan_type === 'five') {
    if (user.department_level === 1) return true;
    if (user.department_level === 2) {
      var d = await db.one('SELECT parent_id FROM departments WHERE id = ?', [plan.department_id]);
      return !!d && d.parent_id === user.department_id;
    }
  }
  return false;
}

module.exports = { loadPlans: loadPlans, generate: generate, generateAnnual: generateAnnual, approvedPlan: approvedPlan,
  canApprove: canApprove, teamIds: teamIds };
