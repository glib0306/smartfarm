// Decision support: yield prediction (BP neural network), soil fertility & water holding capacity (PLS),
// resource redistribution (linear programming) and reporting optimised solutions to ERP.
var router = require('express').Router();
var db = require('../../../common/db');
var auth = require('../../../common/auth');
var h = require('../../../common/http');
var py = require('../../../common/python');
var dates = require('../../../common/dates');

router.use(auth.requireMenu('decision'));

// ------------------------------------------------------------------ yield prediction (BPNN, self-learning)
router.get('/yield', h.wrap(async function (req, res) {
  var hist = db.num(await db.query('SELECT y.n_applied, y.avg_temp, y.rainfall, y.max_tillers, y.spad, f.grade, c.potential_yield, y.yield_t_ha ' +
    'FROM yield_history y JOIN fields f ON f.id = y.field_id JOIN cultivars c ON c.id = y.cultivar_id'),
  ['n_applied', 'avg_temp', 'rainfall', 'max_tillers', 'spad', 'potential_yield', 'yield_t_ha']);
  var w = await db.one('SELECT AVG(t_avg) AS t, SUM(rainfall) AS r FROM weather_daily WHERE obs_date > CURDATE() - INTERVAL 120 DAY');
  var cur = await db.query('SELECT f.id AS field_id, f.soil_no, f.crop, f.area_ha, f.grade, c.potential_yield, ' +
    '(SELECT MAX(tiller_number) FROM growth_surveys g WHERE g.field_id = f.id) AS max_tillers, ' +
    '(SELECT spad FROM growth_surveys g WHERE g.field_id = f.id ORDER BY survey_date DESC LIMIT 1) AS spad ' +
    'FROM fields f JOIN cultivars c ON c.id = f.cultivar_id ORDER BY f.id');
  cur.forEach(function (c) {
    c.n_applied = c.crop === 'rice' ? 150 : 120;
    c.avg_temp = c.crop === 'rice' ? Math.max(18, Number(w.t) + 4) : Math.min(13, Number(w.t) - 4);
    c.rainfall = Number(w.r) * 3;
    c.max_tillers = Number(c.max_tillers || 0);
    c.spad = Number(c.spad || 38);
    c.potential_yield = Number(c.potential_yield);
    c.area_ha = Number(c.area_ha);
  });
  var saved = await db.one("SELECT * FROM model_params WHERE model = 'bpnn_yield' ORDER BY trained_at DESC LIMIT 1");
  var retrain = req.query.retrain === '1' || !saved;
  var out = await py.run('yield_bpnn', { history: hist, current: cur, retrain: retrain, saved: saved ? JSON.parse(saved.params) : null,
    saved_rmse: saved ? Number(saved.rmse) : null, epochs: 150 }, 300000);
  if (retrain) {
    await db.query("INSERT INTO model_params (model, cultivar_id, params, samples, rmse, trained_at) VALUES ('bpnn_yield', NULL, ?, ?, ?, NOW())",
      [JSON.stringify(out.model), out.samples, out.rmse]);
  }
  var totals = {};
  out.predictions.forEach(function (p) {
    totals[p.crop] = (totals[p.crop] || 0) + p.yield_t_ha * p.area_ha;
  });
  res.json({ predictions: out.predictions, rmse: out.rmse, samples: out.samples, loss: out.loss, retrained: retrain,
    trained_at: retrain ? new Date().toISOString() : saved.trained_at,
    totals: Object.keys(totals).map(function (k) { return { crop: k, tonnes: Math.round(totals[k] * 10) / 10 }; }) });
}));

// ------------------------------------------------------------------ soil fertility by land grade & water holding capacity
router.get('/fertility', h.wrap(async function (req, res) {
  var fields = db.num(await db.query('SELECT f.id AS field_id, f.soil_no, f.crop, f.grade, f.water_holding_capacity, f.organic_matter, f.ph, ' +
    '(SELECT AVG(y.yield_t_ha / c.potential_yield) FROM yield_history y JOIN cultivars c ON c.id = y.cultivar_id WHERE y.field_id = f.id) AS mean_yield_index ' +
    'FROM fields f ORDER BY f.id'), ['water_holding_capacity', 'organic_matter', 'ph', 'mean_yield_index']);
  var w = await db.one('SELECT AVG(t_avg) AS t, AVG(t_max - t_min) AS dtr FROM weather_daily WHERE obs_date > CURDATE() - INTERVAL 14 DAY');
  // Hargreaves reference evapotranspiration with a mid-latitude autumn extraterrestrial radiation of ~ 9 mm/day
  var et0 = 0.0023 * (Number(w.t) + 17.8) * Math.sqrt(Math.max(1, Number(w.dtr))) * 9;
  var out = await py.run('fertility', { fields: fields, et0_mm_day: et0, root_depth_m: 0.4 });
  var byGrade = {};
  fields.forEach(function (f) {
    var g = byGrade[f.grade] = byGrade[f.grade] || { grade: f.grade, n: 0, whc: 0, om: 0, yi: 0 };
    g.n += 1; g.whc += f.water_holding_capacity; g.om += f.organic_matter; g.yi += f.mean_yield_index;
  });
  out.grades = Object.keys(byGrade).sort().map(function (k) {
    var g = byGrade[k];
    return { grade: g.grade, fields: g.n, whc: Math.round(g.whc / g.n), organic_matter: Math.round(100 * g.om / g.n) / 100, yield_index: Math.round(100 * g.yi / g.n) / 100 };
  });
  out.et0 = Math.round(et0 * 100) / 100;
  res.json(out);
}));

// ------------------------------------------------------------------ resource redistribution (manpower, equipment, water)
router.get('/allocation', h.wrap(async function (req, res) {
  var resource = req.query.resource || 'labor';
  var day = dates.today();
  var teams = await db.query('SELECT d.id, d.name, d.parent_id FROM departments d WHERE d.level = 3 AND d.crop IS NOT NULL ORDER BY d.id');
  var units = [];
  var eqHours = await db.one("SELECT COUNT(*) AS n FROM equipment WHERE status <> 'repair'");
  for (var i = 0; i < teams.length; i++) {
    var t = teams[i];
    var plan = await db.one("SELECT * FROM production_plans WHERE plan_type = 'five' AND status = 'approved' AND department_id = ? AND period_start <= ? AND period_end >= ?",
      [t.id, day, day]);
    var days = plan ? dates.daysBetween(plan.period_start, plan.period_end) : 5;
    var required = 0;
    var available = 0;
    if (resource === 'labor') {
      var w = await db.one("SELECT COUNT(*) AS n FROM users WHERE department_id = ? AND role IN ('farmer', 'operator') AND approved = 1", [t.id]);
      available = w.n * days;
      if (plan) required = Number((await db.one("SELECT COALESCE(SUM(quantity), 0) AS q FROM plan_resources WHERE plan_id = ? AND resource_type = 'labor'", [plan.id])).q);
    } else if (resource === 'equipment') {
      available = eqHours.n * 10 * days / teams.length;
      if (plan) required = Number((await db.one("SELECT COALESCE(SUM(quantity), 0) AS q FROM plan_resources WHERE plan_id = ? AND resource_type = 'equipment'", [plan.id])).q);
    } else {
      var fl = await db.query('SELECT crop, SUM(area_ha) AS a FROM fields WHERE department_id = ? GROUP BY crop', [t.id]);
      fl.forEach(function (f) { required += Number(f.a) * (f.crop === 'rice' ? 110 : 35); }); // m3/day: ET + percolation
      var pump = await db.one("SELECT COALESCE(SUM(flow_m3h), 0) AS q FROM irrigation_pumps WHERE status = 'running' AND id = ?", [t.id % 2 === 1 ? 1 : 2]);
      available = Number(pump.q) * 20 / 2; // 20 h operation shared by two teams per intake
    }
    units.push({ id: t.id, name: t.name, parent_id: t.parent_id, available: Math.round(available * 10) / 10, required: Math.round(required * 10) / 10 });
  }
  var distance = {};
  units.forEach(function (a) { units.forEach(function (b) { distance[a.id + '-' + b.id] = a.parent_id === b.parent_id ? 1 : 3; }); });
  var out = await py.run('allocate', { units: units, distance: distance, benefit: 100 });
  out.resource = resource;
  out.unit = resource === 'labor' ? 'man-day' : (resource === 'equipment' ? 'machine-h' : 'm3/day');
  res.json(out);
}));

// ------------------------------------------------------------------ provide optimised solutions to ERP
router.post('/submit', h.wrap(async function (req, res) {
  var b = req.body || {};
  if (!b.kind || !b.data) throw h.fail(400, 'kind and data are required');
  var r = await db.query("INSERT INTO erp_submissions (ref_type, ref_id, payload, status, submitted_by, submitted_at) VALUES ('optimization', 0, ?, 'submitted', ?, NOW())",
    [JSON.stringify({ kind: b.kind, data: b.data }), req.user.id]);
  res.json({ ok: true, id: r.insertId, message: 'Optimised solution (' + b.kind + ') was provided to ERP.' });
}));

module.exports = router;
