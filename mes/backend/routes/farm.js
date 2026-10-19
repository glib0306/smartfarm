// Farm-level data: home dashboard, variety layout, weather & sensors, equipment, irrigation.
var router = require('express').Router();
var db = require('../../../common/db');
var auth = require('../../../common/auth');
var h = require('../../../common/http');

var FIELD_SQL = 'SELECT f.*, c.name AS cultivar_name, c.color AS cultivar_color, d.name AS department_name FROM fields f ' +
  'JOIN cultivars c ON c.id = f.cultivar_id JOIN departments d ON d.id = f.department_id ORDER BY f.id';

function fieldsNum(rows) { return db.num(rows, ['area_ha', 'water_holding_capacity', 'organic_matter', 'ph']); }

router.get('/fields', h.wrap(async function (req, res) { res.json(fieldsNum(await db.query(FIELD_SQL))); }));
router.get('/cultivars', h.wrap(async function (req, res) { res.json(await db.query('SELECT * FROM cultivars ORDER BY crop DESC, id')); }));
router.get('/departments', h.wrap(async function (req, res) { res.json(await db.query('SELECT * FROM departments ORDER BY level, id')); }));

// ------------------------------------------------------------------ home dashboard (real-time monitoring)
router.get('/home', h.wrap(async function (req, res) {
  var people = await db.query('SELECT kind, COUNT(*) AS n FROM attendance WHERE att_date = CURDATE() GROUP BY kind');
  var eqStatus = await db.query('SELECT status, COUNT(*) AS n FROM equipment GROUP BY status');
  var eqType = await db.query('SELECT type, COUNT(*) AS n FROM equipment GROUP BY type ORDER BY n DESC');
  var workers = await db.query('SELECT field_id, kind, COUNT(*) AS n FROM attendance WHERE att_date = CURDATE() AND field_id IS NOT NULL GROUP BY field_id, kind');
  var fields = fieldsNum(await db.query(FIELD_SQL));
  fields.forEach(function (f) {
    f.workers = 0;
    f.visitors = 0;
    workers.forEach(function (w) { if (w.field_id === f.id) { if (w.kind === 'operator') f.workers += w.n; else f.visitors += w.n; } });
  });
  // simulated live telemetry: operating machines move slowly around their working position
  var t = Date.now() / 1000;
  var eq = await db.query('SELECT id, designation, equipment_no, type, status, x, y FROM equipment');
  eq.forEach(function (e) {
    if (e.status === 'operating') {
      e.x = Math.round(e.x + 12 * Math.sin(t / 15 + e.id));
      e.y = Math.round(e.y + 8 * Math.cos(t / 11 + e.id));
    }
  });
  res.json({ time: new Date().toISOString(), people: people, equipment_status: eqStatus, equipment_types: eqType, fields: fields, equipment: eq });
}));

// ------------------------------------------------------------------ variety layout (drag & drop, saved to DB)
async function setCultivar(fieldId, cultivarId) {
  var c = await db.one('SELECT * FROM cultivars WHERE id = ?', [cultivarId]);
  if (!c) throw h.fail(400, 'Unknown cultivar');
  await db.query('UPDATE fields SET cultivar_id = ?, crop = ? WHERE id = ?', [c.id, c.crop, fieldId]);
}

router.put('/fields/:id/cultivar', auth.requireMenu('layout'), h.wrap(async function (req, res) {
  await setCultivar(req.params.id, req.body.cultivar_id);
  res.json({ ok: true, fields: fieldsNum(await db.query(FIELD_SQL)) });
}));

router.post('/layout/swap', auth.requireMenu('layout'), h.wrap(async function (req, res) {
  var a = await db.one('SELECT * FROM fields WHERE id = ?', [req.body.from_field]);
  var b = await db.one('SELECT * FROM fields WHERE id = ?', [req.body.to_field]);
  if (!a || !b) throw h.fail(404, 'Field not found');
  await setCultivar(a.id, b.cultivar_id);
  await setCultivar(b.id, a.cultivar_id);
  res.json({ ok: true, fields: fieldsNum(await db.query(FIELD_SQL)) });
}));

// ------------------------------------------------------------------ weather, sensors and soil
router.get('/weather', auth.requireMenu('weather'), h.wrap(async function (req, res) {
  var micro = db.num(await db.query('SELECT s.sensor_no, s.location, m.measured_at, m.temperature, m.humidity, m.wind_speed, m.rainfall, m.solar_radiation ' +
    'FROM micro_climate m JOIN weather_sensors s ON s.id = m.sensor_id JOIN (SELECT sensor_id, MAX(measured_at) AS mx FROM micro_climate ' +
    'WHERE measured_at <= NOW() GROUP BY sensor_id) l ON l.sensor_id = m.sensor_id AND l.mx = m.measured_at ORDER BY s.sensor_no'),
  ['temperature', 'humidity', 'wind_speed', 'rainfall', 'solar_radiation']);
  var today = await db.one('SELECT * FROM weather_daily WHERE obs_date <= CURDATE() ORDER BY obs_date DESC LIMIT 1');
  if (today) db.num([today], ['t_max', 't_min', 't_avg', 'humidity', 'rainfall']);
  var forecast = db.num(await db.query('SELECT * FROM weather_forecast WHERE forecast_date > CURDATE() ORDER BY forecast_date LIMIT 10'),
    ['t_max', 't_min', 't_avg', 'humidity']);
  var soil = db.num(await db.query('SELECT f.soil_no, f.crop, r.measured_at, r.water_level_cm, r.moisture_pct, r.soil_temp, r.water_temp ' +
    'FROM soil_readings r JOIN fields f ON f.id = r.field_id JOIN (SELECT field_id, MAX(measured_at) AS mx FROM soil_readings ' +
    'WHERE measured_at <= NOW() GROUP BY field_id) l ON l.field_id = r.field_id AND l.mx = r.measured_at ORDER BY f.id'),
  ['water_level_cm', 'moisture_pct', 'soil_temp', 'water_temp']);
  var hist = db.num(await db.query('SELECT obs_date, t_avg, rainfall FROM weather_daily WHERE obs_date > CURDATE() - INTERVAL 30 DAY ORDER BY obs_date'),
    ['t_avg', 'rainfall']);
  // analysis: alerts derived from ACS and soil sensor data
  var alerts = [];
  forecast.slice(0, 5).forEach(function (f) {
    if (f.t_min < 2) alerts.push({ level: 'warning', text: 'Frost risk on ' + f.forecast_date + ' (min ' + f.t_min + ' C)' });
  });
  soil.forEach(function (s) {
    if (s.crop === 'wheat' && s.moisture_pct < 25) alerts.push({ level: 'warning', text: s.soil_no + ': low soil moisture ' + s.moisture_pct + '% - irrigation advised' });
    if (s.crop === 'rice' && s.water_level_cm < 2.5) alerts.push({ level: 'info', text: s.soil_no + ': paddy water level ' + s.water_level_cm + ' cm' });
  });
  var rain30 = hist.reduce(function (a, b) { return a + b.rainfall; }, 0);
  var gdd30 = hist.reduce(function (a, b) { return a + Math.max(0, b.t_avg - 10); }, 0);
  res.json({ micro: micro, today: today, forecast: forecast, soil: soil, alerts: alerts,
    analysis: { rain_30d: Math.round(rain30 * 10) / 10, gdd10_30d: Math.round(gdd30), history: hist } });
}));

// Sensor data intake (ACS meteorological, soil, irrigation sensors). Accepts batches from gateways on the LAN.
router.post('/sensors/ingest', h.wrap(async function (req, res) {
  var b = req.body || {};
  var n = 0;
  if (Array.isArray(b.micro) && b.micro.length) {
    await db.query('INSERT INTO micro_climate (sensor_id, measured_at, temperature, humidity, wind_speed, rainfall, solar_radiation) VALUES ?',
      [b.micro.map(function (m) { return [m.sensor_id, m.measured_at, m.temperature, m.humidity, m.wind_speed || 0, m.rainfall || 0, m.solar_radiation || 0]; })]);
    n += b.micro.length;
  }
  if (Array.isArray(b.soil) && b.soil.length) {
    await db.query('INSERT INTO soil_readings (field_id, measured_at, water_level_cm, moisture_pct, soil_temp, water_temp) VALUES ?',
      [b.soil.map(function (s) { return [s.field_id, s.measured_at, s.water_level_cm || 0, s.moisture_pct, s.soil_temp, s.water_temp || 0]; })]);
    n += b.soil.length;
  }
  if (b.daily) {
    var d = b.daily;
    await db.query('REPLACE INTO weather_daily (obs_date, conditions, t_max, t_min, t_avg, humidity, rainfall, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [d.obs_date, d.conditions, d.t_max, d.t_min, d.t_avg, d.humidity, d.rainfall || 0, 'ACS']);
    n += 1;
  }
  res.json({ ok: true, stored: n });
}));

// ------------------------------------------------------------------ equipment
router.get('/equipment', auth.requireMenu('equipment'), h.wrap(async function (req, res) {
  var eq = await db.query('SELECT e.*, d.name AS department_name FROM equipment e JOIN departments d ON d.id = e.department_id ORDER BY e.type, e.id');
  res.json({ equipment: eq, fields: fieldsNum(await db.query(FIELD_SQL)) });
}));

// ------------------------------------------------------------------ irrigation
router.get('/irrigation', auth.requireMenu('irrigation'), h.wrap(async function (req, res) {
  var pumps = db.num(await db.query('SELECT * FROM irrigation_pumps ORDER BY id'), ['flow_m3h', 'power_kw']);
  var canals = db.num(await db.query('SELECT * FROM irrigation_canals ORDER BY id'), ['capacity_m3h']);
  var soil = db.num(await db.query('SELECT r.field_id, r.water_level_cm, r.moisture_pct FROM soil_readings r JOIN (SELECT field_id, MAX(measured_at) AS mx ' +
    'FROM soil_readings WHERE measured_at <= NOW() GROUP BY field_id) l ON l.field_id = r.field_id AND l.mx = r.measured_at'), ['water_level_cm', 'moisture_pct']);
  var fields = fieldsNum(await db.query(FIELD_SQL));
  fields.forEach(function (f) {
    var s = soil.filter(function (x) { return x.field_id === f.id; })[0];
    f.water_level_cm = s ? s.water_level_cm : null;
    f.moisture_pct = s ? s.moisture_pct : null;
  });
  var running = pumps.filter(function (p) { return p.status === 'running'; });
  res.json({ pumps: pumps, canals: canals, fields: fields,
    summary: { running: running.length, total_flow_m3h: running.reduce(function (a, p) { return a + p.flow_m3h; }, 0),
      power_kw: running.reduce(function (a, p) { return a + p.power_kw; }, 0) } });
}));

router.post('/irrigation/pumps/:id/toggle', auth.requireMenu('irrigation'), h.wrap(async function (req, res) {
  var p = await db.one('SELECT * FROM irrigation_pumps WHERE id = ?', [req.params.id]);
  if (!p) throw h.fail(404, 'Pump not found');
  if (p.status === 'fault') throw h.fail(409, 'Pump is in fault state and cannot be started', { warning: true });
  await db.query('UPDATE irrigation_pumps SET status = ? WHERE id = ?', [p.status === 'running' ? 'stopped' : 'running', p.id]);
  res.json({ ok: true });
}));

module.exports = router;
