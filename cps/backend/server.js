// CPS backend (Node + Express + Python). Simulations driven by the MES data in the shared smartfarm database.
var express = require('express');
var cors = require('cors');
var path = require('path');
var fs = require('fs');
var config = require('../../common/config');
var db = require('../../common/db');
var auth = require('../../common/auth');
var h = require('../../common/http');
var py = require('../../common/python');
var gi = require('../../common/growthInput');
var pestInput = require('../../common/pestInput');

var app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', function (req, res) { res.json({ ok: true, system: 'CPS', time: new Date().toISOString() }); });
app.post('/api/auth/login', h.wrap(async function (req, res) { res.json(await auth.login(req.body.username, req.body.password)); }));
app.use('/api', auth.authRequired);
app.get('/api/auth/me', function (req, res) { res.json({ user: req.user }); });

var PRICE = { rice: 1350, wheat: 1100 };
var TYPE_LABEL = { annual: 'Annual', monthly: 'Monthly', fifteen: '15-day', five: '5-day' };

app.get('/api/fields', h.wrap(async function (req, res) {
  res.json(db.num(await db.query('SELECT f.*, c.name AS cultivar_name, c.color AS cultivar_color FROM fields f JOIN cultivars c ON c.id = f.cultivar_id ORDER BY f.id'),
    ['area_ha']));
}));

app.get('/api/cultivars', h.wrap(async function (req, res) { res.json(await db.query('SELECT * FROM cultivars ORDER BY crop DESC, id')); }));

// ------------------------------------------------------------------ production plan simulation
app.get('/api/plans', h.wrap(async function (req, res) {
  var rows = db.num(await db.query('SELECT p.id, p.plan_type, p.variant_name, p.status, p.period_start, p.period_end, p.mech_ratio, p.expected_cost, ' +
    'p.expected_revenue, p.efficiency, d.name AS department_name FROM production_plans p JOIN departments d ON d.id = p.department_id ' +
    "WHERE p.period_end >= CURDATE() - INTERVAL 45 DAY OR p.plan_type = 'annual' ORDER BY FIELD(p.plan_type, 'annual', 'monthly', 'fifteen', 'five'), " +
    'p.period_start DESC, p.department_id, p.variant_no LIMIT 300'), ['mech_ratio', 'expected_cost', 'expected_revenue', 'efficiency']);
  rows.forEach(function (r) {
    r.label = TYPE_LABEL[r.plan_type] + ' ' + r.period_start + ' .. ' + r.period_end + ' | ' + r.department_name + ' | ' + r.variant_name + ' [' + r.status + ']';
  });
  res.json(rows);
}));

async function teamsOf(deptId) {
  var d = await db.one('SELECT * FROM departments WHERE id = ?', [deptId]);
  if (d.level === 3) return [d.id];
  if (d.level === 2) return (await db.query('SELECT id FROM departments WHERE parent_id = ?', [d.id])).map(function (r) { return r.id; });
  return (await db.query('SELECT id FROM departments WHERE level = 3')).map(function (r) { return r.id; });
}

async function simulatePlan(plan) {
  var teams = await teamsOf(plan.department_id);
  var fields = db.num(await db.query('SELECT f.id, f.crop, f.area_ha, f.grade, c.potential_yield, c.max_tillers, ' +
    '(SELECT MAX(tiller_number) FROM growth_surveys g WHERE g.field_id = f.id) AS tmax FROM fields f JOIN cultivars c ON c.id = f.cultivar_id ' +
    'WHERE f.department_id IN (?)', [teams]), ['area_ha', 'potential_yield', 'max_tillers', 'tmax']);
  fields.forEach(function (f) { f.tiller_ratio = f.tmax ? f.tmax / f.max_tillers : 1; });
  var fullRevenue = fields.reduce(function (a, f) { return a + f.area_ha * f.potential_yield * (1 - 0.06 * (f.grade - 1)) * PRICE[f.crop]; }, 0);
  var share = fullRevenue > 0 ? Math.min(1, Number(plan.expected_revenue) / fullRevenue) : 1;
  var out = await py.run('scenario_yield', { plan: { mech_ratio: Number(plan.mech_ratio), cost: Number(plan.expected_cost), revenue_share: share },
    fields: fields, prices: PRICE, runs: 400, seed: plan.id });
  out.plan = { id: plan.id, variant_name: plan.variant_name, plan_type: plan.plan_type, status: plan.status, period_start: plan.period_start,
    period_end: plan.period_end, expected_cost: Number(plan.expected_cost), expected_revenue: Number(plan.expected_revenue),
    mech_ratio: Number(plan.mech_ratio), revenue_share: Math.round(share * 1000) / 1000 };
  return out;
}

app.get('/api/plan-sim/:id', h.wrap(async function (req, res) {
  var plan = await db.one('SELECT * FROM production_plans WHERE id = ?', [req.params.id]);
  if (!plan) throw h.fail(404, 'Plan not found');
  var main = await simulatePlan(plan);
  // compare all variants (production scenarios) of the same plan period and department
  var siblings = await db.query('SELECT * FROM production_plans WHERE plan_type = ? AND department_id = ? AND period_start = ? AND period_end = ? ORDER BY variant_no',
    [plan.plan_type, plan.department_id, plan.period_start, plan.period_end]);
  var compare = [];
  for (var i = 0; i < siblings.length; i++) {
    var s = siblings[i].id === plan.id ? main : await simulatePlan(siblings[i]);
    compare.push({ id: siblings[i].id, name: siblings[i].variant_name, profit_mean: s.profit.mean, profit_p10: s.profit.p10, profit_p90: s.profit.p90,
      yield_t: s.yields.reduce(function (a, y) { return a + y.mean; }, 0) });
  }
  main.compare = compare;
  res.json(main);
}));

// ------------------------------------------------------------------ growth simulation by growth stage (3D, weekly)
app.get('/api/growth-sim', h.wrap(async function (req, res) {
  var weeks = Math.min(16, Math.max(2, parseInt(req.query.weeks || '8', 10)));
  var fields = await gi.build();
  var out = await py.run('growth_forecast', { fields: fields, future_temps: await gi.futureTemps(weeks * 7), horizon: weeks * 7 });
  var byCrop = {};
  out.fields.forEach(function (f, i) {
    var src = fields[i];
    var c = byCrop[src.crop] = byCrop[src.crop] || { max_leaves: 0, n: 0, weeks: [] };
    c.max_leaves = Math.max(c.max_leaves, src.cultivar.max_leaves);
    c.n += 1;
    var last = src.surveys[src.surveys.length - 1] || { leaf: 0, tiller: 0 };
    for (var w = 0; w <= weeks; w++) {
      var leaf = w === 0 ? last.leaf : f.series[w * 7 - 1].leaf;
      var till = w === 0 ? last.tiller : f.series[w * 7 - 1].tiller;
      var das = src.das_today + w * 7;
      var cw = c.weeks[w] = c.weeks[w] || { week: w, leaf: 0, tiller: 0, das: 0, ripeness: 0 };
      cw.leaf += leaf; cw.tiller += till; cw.das += das;
      cw.ripeness += Math.max(0, Math.min(1, (das / src.cultivar.maturity_days - 0.7) / 0.3));
    }
  });
  var result = {};
  Object.keys(byCrop).forEach(function (k) {
    var c = byCrop[k];
    result[k] = c.weeks.map(function (w) {
      var leaf = w.leaf / c.n;
      var maxH = k === 'rice' ? 100 : 90;
      return { week: w.week, leaf: Math.round(leaf * 100) / 100, tiller: Math.round(100 * w.tiller / c.n) / 100,
        das: Math.round(w.das / c.n), height_cm: Math.round(maxH * Math.min(1, leaf / c.max_leaves) * 10) / 10,
        ripeness: Math.round(100 * w.ripeness / c.n) / 100,
        stage: stage(k, w.das / c.n, k === 'rice' ? 135 : 110) };
    });
  });
  res.json({ weeks: weeks, crops: result });
}));

function stage(crop, das, mat) {
  var p = das / mat;
  var names = crop === 'rice'
    ? [[0.15, 'Seedling'], [0.35, 'Tillering'], [0.55, 'Panicle initiation'], [0.7, 'Heading'], [0.85, 'Grain filling'], [9, 'Maturity']]
    : [[0.12, 'Emergence'], [0.3, 'Tillering'], [0.6, 'Overwintering'], [0.75, 'Jointing'], [0.88, 'Heading'], [9, 'Maturity']];
  for (var i = 0; i < names.length; i++) if (p <= names[i][0]) return names[i][1];
  return 'Maturity';
}

// ------------------------------------------------------------------ response measures for the crop growth period
app.post('/api/response', h.wrap(async function (req, res) {
  var b = req.body || {};
  var where = 'f.crop = ?';
  var params = [b.crop || 'rice'];
  if (b.cultivar_id) { where += ' AND f.cultivar_id = ?'; params.push(b.cultivar_id); }
  var fields = await gi.build(where, params);
  if (!fields.length) throw h.fail(404, 'No fields for this selection');
  var ids = fields.map(function (f) { return f.field_id; });
  var soil = await db.one('SELECT AVG(r.moisture_pct) AS m, AVG(r.water_level_cm) AS wl FROM soil_readings r WHERE r.field_id IN (?) AND r.measured_at > NOW() - INTERVAL 2 DAY', [ids]);
  var pests = await db.one('SELECT COALESCE(SUM(damaged_area_m2), 0) AS dmg FROM pests WHERE field_id IN (?) AND occurred_on > CURDATE() - INTERVAL 30 DAY', [ids]);
  var area = fields.reduce(function (a, f) { return a + f.area_ha; }, 0);
  var frost = await db.one('SELECT MIN(t_min) AS tmin FROM weather_forecast WHERE forecast_date <= CURDATE() + INTERVAL 10 DAY');
  var water = b.crop === 'wheat' ? Math.max(0, (32 - Number(soil.m || 32)) / 100) : Math.max(0, (3 - Number(soil.wl || 3)) / 30);
  var stress = { water_stress: Math.round(water * 1000) / 1000, pest_loss: Math.min(0.3, Math.round(5000 * Number(pests.dmg) / (area * 10000)) / 1000) }; // damaged share x 5 (spread)
  var py_ = fields.reduce(function (a, f) { return a + f.potential_yield * (1 - 0.06 * (f.grade - 1)); }, 0) / fields.length;
  var out = await py.run('response', { fields: fields, future_temps: await gi.futureTemps(b.horizon || 45), horizon: b.horizon || 45,
    measures: b.measures || [], stress: stress, potential_yield: py_ });
  out.stress = stress;
  out.inputs = { soil_moisture: Number(soil.m), water_level_cm: Number(soil.wl), damaged_m2: Number(pests.dmg), min_forecast_temp: Number(frost.tmin), fields: fields.length };
  res.json(out);
}));

// ------------------------------------------------------------------ disease & pest infestation simulation
app.get('/api/pest-sim', h.wrap(async function (req, res) {
  var days = Math.min(60, Math.max(3, parseInt(req.query.days || '21', 10)));
  var out = await py.run('pest_spread', await pestInput.build(days, []));
  var fields = db.num(await db.query('SELECT id, soil_no, crop, x, y, w, h, area_ha FROM fields ORDER BY id'), ['area_ha']);
  fields.forEach(function (f) {
    f.expected = out.final.filter(function (x) { return x.field_id === f.id; });
    f.state = f.expected.some(function (x) { return x.category === 'disease'; }) ? 'disease' : (f.expected.length ? 'pest' : 'normal');
  });
  res.json({ days: days, daily: out.daily, fields: fields });
}));

app.use('/api', function (req, res) { res.status(404).json({ error: 'Unknown API endpoint' }); });

var build = path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(build)) {
  app.use(express.static(build));
  app.get('*', function (req, res) { res.sendFile(path.join(build, 'index.html')); });
}
app.use(h.errorHandler);

if (require.main === module) {
  app.listen(config.cpsPort, function () { console.log('CPS backend listening on http://localhost:' + config.cpsPort); });
}
module.exports = app;
