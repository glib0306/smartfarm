// Harvest & machinery map: crop harvest conditions per field, real-time machinery status,
// shortest / fastest machinery routes between two points, and GPS telemetry intake.
var router = require('express').Router();
var db = require('../../../common/db');
var auth = require('../../../common/auth');
var h = require('../../../common/http');
var routing = require('../lib/routing');
var machinery = require('../lib/machinery');

var STATUSES = ['operating', 'idle', 'repair'];

router.get('/map', auth.requireMenu('machinery_map'), h.wrap(async function (req, res) {
  var fields = db.num(await db.query('SELECT f.id, f.soil_no, f.crop, f.area_ha, f.grade, f.x, f.y, f.w, f.h, f.sowing_date, ' +
    'c.name AS cultivar_name, d.name AS department_name FROM fields f JOIN cultivars c ON c.id = f.cultivar_id ' +
    'JOIN departments d ON d.id = f.department_id ORDER BY f.id'), ['area_ha']);
  var hc = db.num(await db.query('SELECT * FROM harvest_conditions WHERE assessed_on > CURDATE() - INTERVAL 7 DAY AND assessed_on <= CURDATE() ' +
    'ORDER BY field_id, assessed_on'), ['maturity_pct', 'grain_moisture_pct', 'lodging_pct', 'expected_yield_t_ha', 'harvested_pct']);
  var crops = db.num(await db.query('SELECT * FROM crop_types ORDER BY planted DESC, code'),
    ['harvest_moisture_max', 'harvest_moisture_min', 'storage_moisture', 'typical_yield_t_ha']);
  var types = db.num(await db.query('SELECT * FROM machine_types ORDER BY category, type'),
    ['width_m', 'weight_t', 'road_speed_kmh', 'field_speed_kmh', 'work_rate_ha_h', 'fuel_l_h']);
  var net = await machinery.loadNetwork();
  var rain = await db.query("SELECT forecast_date, conditions FROM weather_forecast WHERE conditions IN ('rain', 'snow') " +
    'AND forecast_date > CURDATE() AND forecast_date <= CURDATE() + INTERVAL 3 DAY ORDER BY forecast_date');

  var cropBy = {};
  crops.forEach(function (c) { cropBy[c.code] = c; });
  var byReadiness = {};
  var harvestedHa = 0;
  var readyT = 0;
  fields.forEach(function (f) {
    f.history = hc.filter(function (r) { return r.field_id === f.id; });
    var cur = f.history[f.history.length - 1] || null;
    f.harvest = cur;
    var key = cur ? cur.readiness : 'unknown';
    var b = byReadiness[key] = byReadiness[key] || { readiness: key, fields: 0, area_ha: 0 };
    b.fields++;
    b.area_ha = Math.round((b.area_ha + f.area_ha) * 100) / 100;
    if (!cur) return;
    harvestedHa += f.area_ha * cur.harvested_pct / 100;
    if (cur.readiness === 'ready' || cur.readiness === 'harvesting') {
      readyT += f.area_ha * (1 - cur.harvested_pct / 100) * cur.expected_yield_t_ha;
    }
  });

  // harvest priority: lodged crops, rain on the way and grain already in the moisture window go first
  var priority = fields.filter(function (f) { return f.harvest && (f.harvest.readiness === 'ready' || f.harvest.readiness === 'harvesting'); })
    .map(function (f) {
      var c = cropBy[f.crop];
      var hv = f.harvest;
      var reasons = [];
      var score = 0;
      if (hv.lodging_pct >= 10) { score += 30 + hv.lodging_pct; reasons.push('lodging ' + hv.lodging_pct + '%'); }
      if (rain.length) { score += 20; reasons.push('rain forecast ' + rain[0].forecast_date); }
      if (c && hv.grain_moisture_pct !== null && hv.grain_moisture_pct <= c.harvest_moisture_max) {
        score += 15; reasons.push('moisture ' + hv.grain_moisture_pct + '% in harvest window');
      } else if (c && hv.grain_moisture_pct !== null) {
        reasons.push('moisture ' + hv.grain_moisture_pct + '% above ' + c.harvest_moisture_max + '%');
      }
      if (hv.readiness === 'harvesting') { score += 10; reasons.push(hv.harvested_pct + '% harvested'); }
      return { field_id: f.id, soil_no: f.soil_no, crop: f.crop, readiness: hv.readiness, score: Math.round(score),
        remaining_t: Math.round(f.area_ha * (1 - hv.harvested_pct / 100) * hv.expected_yield_t_ha * 10) / 10, reasons: reasons };
    }).sort(function (a, b) { return b.score - a.score; });

  net.edges.forEach(function (e) {
    var a = net.nodes.filter(function (n) { return n.id === e.from_node; })[0];
    var b = net.nodes.filter(function (n) { return n.id === e.to_node; })[0];
    e.length_m = Math.round(Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)) * routing.METERS_PER_UNIT);
  });
  res.json({
    fields: fields, crop_types: crops, machine_types: types, roads: net,
    facilities: net.nodes.filter(function (n) { return n.kind !== 'junction'; }),
    rain_forecast: rain, priority: priority, meters_per_unit: routing.METERS_PER_UNIT,
    summary: { by_readiness: Object.keys(byReadiness).map(function (k) { return byReadiness[k]; }),
      harvested_ha: Math.round(harvestedHa * 100) / 100, ready_t: Math.round(readyT * 10) / 10 }
  });
}));

router.get('/live', auth.requireMenu('machinery_map'), h.wrap(async function (req, res) {
  var live = await machinery.liveMachines();
  var counts = {};
  live.machines.forEach(function (m) { counts[m.status] = (counts[m.status] || 0) + 1; });
  res.json({ time: new Date().toISOString(), machines: live.machines, alerts: live.alerts, status_counts: counts });
}));

// Resolves a route end: {x, y} | {equipment_id} (live position) | {field_id} (field centre) | {node_id}.
async function resolvePoint(p, machines, nodes) {
  if (!p) throw h.fail(400, 'Route start and end are required');
  if (p.equipment_id) {
    var m = machines.filter(function (x) { return x.id === Number(p.equipment_id); })[0];
    if (!m) throw h.fail(404, 'Machine not found');
    return { x: m.x, y: m.y, label: m.designation, field_id: m.field_id };
  }
  if (p.field_id) {
    var f = await db.one('SELECT id, soil_no, x, y, w, h FROM fields WHERE id = ?', [p.field_id]);
    if (!f) throw h.fail(404, 'Field not found');
    return { x: f.x + f.w / 2, y: f.y + f.h / 2, label: 'Field ' + f.soil_no, field_id: f.id };
  }
  if (p.node_id) {
    var n = nodes.filter(function (x) { return x.id === Number(p.node_id); })[0];
    if (!n) throw h.fail(404, 'Road point not found');
    return { x: n.x, y: n.y, label: n.name || 'Junction ' + n.id };
  }
  var x = Number(p.x);
  var y = Number(p.y);
  if (!isFinite(x) || !isFinite(y) || x < 0 || y < 0 || x > 1100 || y > 700) throw h.fail(400, 'Point is outside the farm map');
  var inside = await db.one('SELECT id, soil_no FROM fields WHERE ? BETWEEN x AND x + w AND ? BETWEEN y AND y + h', [x, y]);
  return { x: x, y: y, field_id: inside ? inside.id : null,
    label: p.label || (inside ? 'Field ' + inside.soil_no : 'Map point') + ' (' + Math.round(x) + ', ' + Math.round(y) + ')' };
}

router.post('/route', auth.requireMenu('machinery_map'), h.wrap(async function (req, res) {
  var b = req.body || {};
  var net = await machinery.loadNetwork();
  var live = (b.from && b.from.equipment_id) || (b.to && b.to.equipment_id) || b.equipment_id ? (await machinery.liveMachines()).machines : [];
  var from = await resolvePoint(b.from, live, net.nodes);
  var to = await resolvePoint(b.to, live, net.nodes);

  var type = null;
  var machine = null;
  if (b.equipment_id) {
    machine = live.filter(function (m) { return m.id === Number(b.equipment_id); })[0];
    if (!machine) throw h.fail(404, 'Machine not found');
  }
  var typeName = machine ? machine.type : b.machine_type;
  if (typeName) {
    type = db.num(await db.query('SELECT * FROM machine_types WHERE type = ?', [typeName]),
      ['width_m', 'weight_t', 'road_speed_kmh', 'field_speed_kmh'])[0];
    if (!type) throw h.fail(400, 'Unknown machine type ' + typeName);
    if (!type.mobile) throw h.fail(400, typeName + ' is stationary plant and is not routed', { warning: true });
  }
  var profile = type ? machinery.profileOf(type) : routing.DEFAULT_PROFILE;
  var opts = { profile: profile, optimize: b.optimize, allowDirect: !!from.field_id && from.field_id === to.field_id };
  var route = routing.findRoute(net.nodes, net.edges, from, to, opts);
  if (!route) throw h.fail(422, 'No passable route for ' + profile.type + ' between these points', { warning: true });
  var free = routing.findRoute(net.nodes, net.edges, from, to, Object.assign({}, opts, { ignoreRestrictions: true }));
  var blocked = net.edges.map(function (e) { return { id: e.id, reason: routing.blockedReason(e, profile) }; })
    .filter(function (e) { return e.reason; });
  res.json(Object.assign(route, {
    from: from, to: to, profile: profile, machine: machine ? { id: machine.id, designation: machine.designation } : null,
    blocked_edges: blocked, unrestricted_m: free ? free.distance_m : null,
    detour_m: free ? Math.max(0, route.distance_m - free.distance_m) : 0
  }));
}));

// GPS / machine terminal intake on the farm LAN: {records: [{equipment_id, x, y, speed_kmh, heading, fuel_pct, status, field_id, task}]}
router.post('/telemetry', h.wrap(async function (req, res) {
  var recs = (req.body && req.body.records) || [];
  if (!Array.isArray(recs) || !recs.length) throw h.fail(400, 'records[] is required');
  var ids = (await db.query('SELECT id, status FROM equipment')).reduce(function (a, e) { a[e.id] = e.status; return a; }, {});
  var last = {};
  (await db.query('SELECT t.equipment_id, t.engine_hours, t.field_id, t.task FROM machine_telemetry t JOIN (SELECT equipment_id, MAX(id) AS mx ' +
    'FROM machine_telemetry GROUP BY equipment_id) l ON l.mx = t.id')).forEach(function (r) { last[r.equipment_id] = r; });
  var rows = recs.map(function (r) {
    var id = Number(r.equipment_id);
    if (!ids[id]) throw h.fail(400, 'Unknown equipment_id ' + r.equipment_id);
    var x = Number(r.x);
    var y = Number(r.y);
    if (!isFinite(x) || !isFinite(y)) throw h.fail(400, 'x and y are required for equipment ' + id);
    var status = r.status || ids[id];
    if (STATUSES.indexOf(status) < 0) throw h.fail(400, 'status must be one of ' + STATUSES.join(', '));
    var prev = last[id] || {};
    return [id, r.recorded_at ? new Date(r.recorded_at) : new Date(), x, y, Math.round(Number(r.heading) || 0) % 360,
      Number(r.speed_kmh) || 0, r.fuel_pct === undefined ? 50 : Number(r.fuel_pct),
      r.engine_hours === undefined ? Number(prev.engine_hours) || 0 : Number(r.engine_hours), status,
      r.field_id === undefined ? prev.field_id || null : r.field_id, r.task === undefined ? prev.task || null : r.task, 'gps'];
  });
  await db.query('INSERT INTO machine_telemetry (equipment_id, recorded_at, x, y, heading, speed_kmh, fuel_pct, engine_hours, status, ' +
    'field_id, task, source) VALUES ?', [rows]);
  for (var i = 0; i < rows.length; i++) {
    await db.query('UPDATE equipment SET x = ?, y = ?, status = ?, updated_at = NOW() WHERE id = ?',
      [Math.round(rows[i][2]), Math.round(rows[i][3]), rows[i][8], rows[i][0]]);
  }
  res.json({ ok: true, stored: rows.length });
}));

module.exports = router;
