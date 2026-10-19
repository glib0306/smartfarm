// Quality control: growth survey & forecast, nutrition diagnosis, pest monitoring and technical measures.
var router = require('express').Router();
var db = require('../../../common/db');
var auth = require('../../../common/auth');
var h = require('../../../common/http');
var py = require('../../../common/python');
var gi = require('../../../common/growthInput');
var rule = require('../lib/editRule');
var pestInput = require('../../../common/pestInput');

var growth = auth.requireMenu('growth');
var pest = auth.requireMenu('pest');
var INDEXES = ['leaf_number', 'tiller_number', 'plant_height', 'spad'];

// ------------------------------------------------------------------ growth survey results
router.get('/surveys', growth, h.wrap(async function (req, res) {
  var idx = INDEXES.indexOf(req.query.index) >= 0 ? req.query.index : 'leaf_number';
  var where = ['f.crop = ?'];
  var params = [req.query.crop || 'rice'];
  if (req.query.cultivar_id) { where.push('f.cultivar_id = ?'); params.push(req.query.cultivar_id); }
  var rows = await db.query('SELECT f.soil_no, c.name AS cultivar_name, s.survey_date, s.growth_stage, s.' + idx + ' AS value ' +
    'FROM growth_surveys s JOIN fields f ON f.id = s.field_id JOIN cultivars c ON c.id = f.cultivar_id ' +
    'JOIN (SELECT field_id, MAX(survey_date) AS mx FROM growth_surveys GROUP BY field_id) l ON l.field_id = s.field_id AND l.mx = s.survey_date ' +
    'WHERE ' + where.join(' AND ') + ' ORDER BY f.id', params);
  res.json({ index: idx, rows: db.num(rows, ['value']) });
}));

// ------------------------------------------------------------------ season-specific growth forecast (monthly / 10-day / weekly)
router.get('/forecast', growth, h.wrap(async function (req, res) {
  var horizon = Math.min(60, Math.max(1, parseInt(req.query.horizon || '30', 10)));
  var where = 'f.crop = ?';
  var params = [req.query.crop || 'rice'];
  if (req.query.cultivar_id) { where += ' AND f.cultivar_id = ?'; params.push(req.query.cultivar_id); }
  var fields = await gi.build(where, params);
  if (!fields.length) return res.json({ fields: [], series: [] });
  var out = await py.run('growth_forecast', { fields: fields, future_temps: await gi.futureTemps(horizon), horizon: horizon });
  var last = await db.one("SELECT MAX(trained_at) AS t FROM model_params WHERE model = 'growth' AND DATE(trained_at) = CURDATE()");
  if (!last || !last.t) await gi.saveModels(out.models); // daily self-learning snapshot
  // pivot into chart rows: one row per day, one key per soil number
  var start = new Date();
  var rows = [];
  for (var d = 0; d < horizon; d++) {
    var dt = new Date(start.getTime() + (d + 1) * 86400000);
    var row = { day: d + 1, date: (dt.getMonth() + 1) + '/' + dt.getDate() };
    out.fields.forEach(function (f) {
      row['leaf_' + f.soil_no] = f.series[d].leaf;
      row['tiller_' + f.soil_no] = f.series[d].tiller;
    });
    rows.push(row);
  }
  res.json({ horizon: horizon, soil_nos: out.fields.map(function (f) { return f.soil_no; }), rows: rows,
    params: out.fields.map(function (f) { return Object.assign({ soil_no: f.soil_no }, f.params); }), models: out.models });
}));

// Explicit re-training of the growth model (self-learning on all survey data).
router.post('/retrain', growth, h.wrap(async function (req, res) {
  var fields = await gi.build();
  var out = await py.run('growth_forecast', { fields: fields, future_temps: await gi.futureTemps(7), horizon: 7 });
  await gi.saveModels(out.models);
  res.json({ ok: true, models: out.models });
}));

// ------------------------------------------------------------------ date forecast by reaching index
router.post('/reach', growth, h.wrap(async function (req, res) {
  var b = req.body || {};
  var kind = b.kind === 'tiller' ? 'tiller' : 'leaf';
  var fields = await gi.build('f.crop = ? AND f.cultivar_id = ?', [b.crop || 'rice', b.cultivar_id]);
  if (!fields.length) throw h.fail(404, 'No fields with this cultivar');
  var out = await py.run('reach_date', { fields: fields, target: Number(b.target), kind: kind, future_temps: await gi.futureTemps(150), max_days: 150 });
  var today = new Date();
  out.series.forEach(function (s) {
    var d = new Date(today.getTime() + s.day * 86400000);
    s.date = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  });
  out.reached_date = out.reached_day ? out.series[out.reached_day - 1].date : null;
  res.json(out);
}));

// ------------------------------------------------------------------ nutritional status diagnosis
router.get('/nutrition', growth, h.wrap(async function (req, res) {
  var fields = await db.query('SELECT f.id, f.soil_no, f.crop, c.name AS cultivar_name FROM fields f JOIN cultivars c ON c.id = f.cultivar_id ' +
    'WHERE f.crop = ? ORDER BY f.id', [req.query.crop || 'rice']);
  var fid = parseInt(req.query.field_id || (fields[0] && fields[0].id), 10);
  var history = db.num(await db.query('SELECT * FROM nutrient_status WHERE field_id = ? ORDER BY diag_date', [fid]), ['n_pct', 'p_pct', 'k_pct', 'spad']);
  res.json({ fields: fields, field_id: fid, field: fields.filter(function (f) { return f.id === fid; })[0] || null,
    latest: history[history.length - 1] || null, history: history });
}));

// ------------------------------------------------------------------ growth map
router.get('/map', growth, h.wrap(async function (req, res) {
  var rows = await db.query('SELECT f.id, f.soil_no, f.crop, f.x, f.y, f.w, f.h, f.area_ha, c.name AS cultivar_name, s.survey_date, s.leaf_number, ' +
    's.tiller_number, s.plant_height, s.spad AS survey_spad, s.growth_stage, s.status, n.n_pct, n.p_pct, n.k_pct, n.status AS nutrient_status ' +
    'FROM fields f JOIN cultivars c ON c.id = f.cultivar_id ' +
    'LEFT JOIN (SELECT g.* FROM growth_surveys g JOIN (SELECT field_id, MAX(survey_date) AS mx FROM growth_surveys GROUP BY field_id) l ' +
    '  ON l.field_id = g.field_id AND l.mx = g.survey_date) s ON s.field_id = f.id ' +
    'LEFT JOIN (SELECT ns.* FROM nutrient_status ns JOIN (SELECT field_id, MAX(diag_date) AS mx FROM nutrient_status GROUP BY field_id) l2 ' +
    '  ON l2.field_id = ns.field_id AND l2.mx = ns.diag_date) n ON n.field_id = f.id ORDER BY f.id');
  res.json(db.num(rows, ['area_ha', 'leaf_number', 'tiller_number', 'plant_height', 'survey_spad', 'n_pct', 'p_pct', 'k_pct']));
}));

// ------------------------------------------------------------------ pests: history (editable), map, prediction
router.get('/pests', pest, h.wrap(async function (req, res) {
  var rows = await db.query('SELECT p.*, f.soil_no, DATE(p.created_at) = CURDATE() AS editable_today FROM pests p JOIN fields f ON f.id = p.field_id ' +
    'ORDER BY p.occurred_on DESC, p.id DESC');
  var catalog = await db.query('SELECT * FROM pest_catalog ORDER BY crop, name');
  res.json({ rows: db.num(rows, ['damaged_area_m2']), catalog: catalog });
}));

router.post('/pests', pest, h.wrap(async function (req, res) {
  var b = req.body || {};
  if (!b.field_id || !b.pest_name) throw h.fail(400, 'Field and pest name are required');
  var cat = await db.one('SELECT category FROM pest_catalog WHERE name = ?', [b.pest_name]);
  var r = await db.query('INSERT INTO pests (field_id, pest_name, category, occurred_on, location_desc, image_url, individuals, damaged_area_m2, ' +
    'created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())', [b.field_id, b.pest_name, b.category || (cat ? cat.category : 'pest'),
    b.occurred_on || new Date().toISOString().slice(0, 10), b.location_desc || '', b.image_url || '', Number(b.individuals) || 0,
    Number(b.damaged_area_m2) || 0, req.user.id]);
  res.json({ id: r.insertId });
}));

router.put('/pests/:id', pest, h.wrap(async function (req, res) {
  res.json(await rule.editOrRequest('pests', req.params.id, req.body || {}, req.user));
}));

router.delete('/pests/:id', pest, h.wrap(async function (req, res) {
  var r = await db.query('DELETE FROM pests WHERE id = ? AND DATE(created_at) = CURDATE()', [req.params.id]);
  if (!r.affectedRows) throw h.fail(409, 'Only records stored today can be deleted', { warning: true });
  res.json({ ok: true });
}));

router.get('/pest-map', pest, h.wrap(async function (req, res) {
  var fields = await db.query('SELECT f.id, f.soil_no, f.crop, f.x, f.y, f.w, f.h, f.area_ha, c.name AS cultivar_name FROM fields f ' +
    'JOIN cultivars c ON c.id = f.cultivar_id ORDER BY f.id');
  var pests = await db.query('SELECT * FROM pests WHERE occurred_on >= CURDATE() - INTERVAL 30 DAY ORDER BY occurred_on DESC');
  fields.forEach(function (f) {
    f.pests = db.num(pests.filter(function (p) { return p.field_id === f.id; }), ['damaged_area_m2']);
    f.state = f.pests.some(function (p) { return p.category === 'disease'; }) ? 'disease' : (f.pests.length ? 'pest' : 'normal');
  });
  res.json(fields);
}));

router.post('/pests/predict', pest, h.wrap(async function (req, res) {
  var days = Math.min(60, Math.max(3, parseInt((req.body && req.body.days) || 21, 10)));
  res.json(await py.run('pest_spread', await pestInput.build(days, req.body && req.body.controlled)));
}));

// ------------------------------------------------------------------ cultivation technical measures -> ERP
router.post('/measures/prepare', pest, h.wrap(async function (req, res) {
  var sub = await db.one("SELECT id FROM technical_measures WHERE status = 'submitted' LIMIT 1");
  if (sub) throw h.fail(409, 'Technical measures have already been submitted to ERP. Cancel the submission first.', { warning: true });
  await db.query("DELETE FROM technical_measures WHERE status = 'draft'");
  var rows = await db.query('SELECT p.id, p.field_id, f.soil_no, f.area_ha, p.pest_name, c.control_measure, c.pesticide, c.dose_per_ha, c.dose_unit ' +
    'FROM pests p JOIN fields f ON f.id = p.field_id JOIN pest_catalog c ON c.name = p.pest_name ' +
    'WHERE p.occurred_on >= CURDATE() - INTERVAL 30 DAY ORDER BY f.id');
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var a = Number(r.area_ha);
    await db.query("INSERT INTO technical_measures (pest_id, field_id, measure, labor_md, equipment, equipment_h, material, material_qty, material_unit, status, created_at) " +
      "VALUES (?, ?, ?, ?, 'Boom sprayer', ?, ?, ?, ?, 'draft', NOW())",
    [r.id, r.field_id, r.soil_no + ' - ' + r.pest_name + ': ' + r.control_measure, (a * 0.8).toFixed(2), (a * 1.5).toFixed(2), r.pesticide,
      (a * Number(r.dose_per_ha)).toFixed(2), r.dose_unit]);
  }
  res.json(await measuresSummary());
}));

async function measuresSummary() {
  var m = db.num(await db.query("SELECT t.*, f.soil_no FROM technical_measures t LEFT JOIN fields f ON f.id = t.field_id WHERE t.status IN ('draft', 'submitted') ORDER BY t.id"),
    ['labor_md', 'equipment_h', 'material_qty']);
  var labor = 0;
  var eq = {};
  var mat = {};
  m.forEach(function (x) {
    labor += x.labor_md;
    eq[x.equipment] = (eq[x.equipment] || 0) + x.equipment_h;
    var k = x.material + '|' + x.material_unit;
    mat[k] = (mat[k] || 0) + x.material_qty;
  });
  return {
    measures: m, submitted: m.some(function (x) { return x.status === 'submitted'; }),
    labor: [{ name: 'Workers', quantity: Math.round(labor * 100) / 100, unit: 'man-day' }],
    equipment: Object.keys(eq).map(function (k) { return { name: k, quantity: Math.round(eq[k] * 100) / 100, unit: 'h' }; }),
    materials: Object.keys(mat).map(function (k) { return { name: k.split('|')[0], quantity: Math.round(mat[k] * 100) / 100, unit: k.split('|')[1] }; })
  };
}

router.get('/measures', pest, h.wrap(async function (req, res) { res.json(await measuresSummary()); }));

router.post('/measures/submit', pest, h.wrap(async function (req, res) {
  var s = await measuresSummary();
  if (s.submitted) throw h.fail(409, 'These measures have already been submitted to ERP.', { warning: true });
  if (!s.measures.length) throw h.fail(400, 'Prepare the technical measures first');
  await db.query("INSERT INTO erp_submissions (ref_type, ref_id, payload, status, submitted_by, submitted_at) VALUES ('measure', ?, ?, 'submitted', ?, NOW())",
    [s.measures[0].id, JSON.stringify(s), req.user.id]);
  await db.query("UPDATE technical_measures SET status = 'submitted' WHERE status = 'draft'");
  res.json({ ok: true, message: 'Submitted: cultivation technical measures with labour, materials and equipment were reported to ERP.' });
}));

router.post('/measures/cancel', pest, h.wrap(async function (req, res) {
  await db.query("UPDATE erp_submissions SET status = 'cancelled', cancelled_at = NOW() WHERE ref_type = 'measure' AND status = 'submitted'");
  await db.query("UPDATE technical_measures SET status = 'draft' WHERE status = 'submitted'");
  res.json({ ok: true, message: 'Submission cancelled.' });
}));

module.exports = router;
