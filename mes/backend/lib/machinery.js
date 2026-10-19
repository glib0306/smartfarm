// Real-time machinery state for the harvest & machinery map.
// A machine that sent GPS telemetry in the last GPS_FRESH_S seconds is shown where it reported.
// Otherwise operating machines are simulated from their latest telemetry: field machines drive a
// back-and-forth work pattern over their field, grain trucks shuttle between their field and the seed plant.
var db = require('../../../common/db');
var routing = require('./routing');

var GPS_FRESH_S = 120;
var TRAIL_POINTS = 15;
var TRAIL_STEP_S = 20;

var MACHINE_SQL = 'SELECT e.id, e.designation, e.equipment_no, e.type, e.status, e.reason, e.range_desc, e.x AS base_x, e.y AS base_y, ' +
  'e.updated_at, d.name AS department_name, t.code, t.category, t.color, t.mobile, t.tracked, t.width_m, t.weight_t, t.road_speed_kmh, ' +
  't.field_speed_kmh, t.fuel_l_h, m.recorded_at, m.x, m.y, m.heading, m.speed_kmh, m.fuel_pct, m.engine_hours, m.field_id, m.task, m.source, ' +
  'TIMESTAMPDIFF(SECOND, m.recorded_at, NOW()) AS age_s ' +
  'FROM equipment e JOIN departments d ON d.id = e.department_id LEFT JOIN machine_types t ON t.type = e.type ' +
  'LEFT JOIN (SELECT equipment_id, MAX(id) AS mx FROM machine_telemetry GROUP BY equipment_id) l ON l.equipment_id = e.id ' +
  'LEFT JOIN machine_telemetry m ON m.id = l.mx ORDER BY e.id';

var NUMERIC = ['width_m', 'weight_t', 'road_speed_kmh', 'field_speed_kmh', 'fuel_l_h', 'x', 'y', 'speed_kmh', 'fuel_pct', 'engine_hours'];

async function loadNetwork() {
  var nodes = await db.query('SELECT * FROM road_nodes ORDER BY id');
  var edges = db.num(await db.query('SELECT * FROM road_edges ORDER BY id'), ['width_m', 'max_weight_t', 'speed_limit_kmh']);
  return { nodes: nodes, edges: edges };
}

function profileOf(m) {
  return { type: m.type, width_m: m.width_m, weight_t: m.weight_t, road_speed_kmh: m.road_speed_kmh,
    field_speed_kmh: m.field_speed_kmh, tracked: m.tracked };
}

// Back-and-forth passes across the field, 8 map units (16 m) apart.
function workPattern(f) {
  var inset = 6;
  var pts = [];
  var row = 0;
  for (var y = f.y + inset; y <= f.y + f.h - inset; y += 8) {
    var xs = [f.x + inset, f.x + f.w - inset];
    if (row % 2) xs.reverse();
    pts.push([xs[0], y], [xs[1], y]);
    row++;
  }
  return pts;
}

// Position after `seconds` driving forwards and backwards along a polyline at `kmh`.
function shuttle(points, kmh, seconds) {
  var len = routing.polylineLength(points);
  if (!len) return { x: points[0][0], y: points[0][1], heading: 0 };
  var units = ((seconds * kmh / 3.6 / routing.METERS_PER_UNIT) % (2 * len) + 2 * len) % (2 * len);
  if (units <= len) return routing.pointAlong(points, units);
  var p = routing.pointAlong(points, 2 * len - units);
  return { x: p.x, y: p.y, heading: (p.heading + 180) % 360 };
}

function round1(v) { return Math.round(v * 10) / 10; }

// Live state of every machine. Returns { machines, alerts }.
async function liveMachines(nowMs) {
  var now = (nowMs || Date.now()) / 1000;
  var rows = db.num(await db.query(MACHINE_SQL), NUMERIC);
  var fields = await db.query('SELECT id, soil_no, crop, x, y, w, h FROM fields');
  var fieldById = {};
  fields.forEach(function (f) { fieldById[f.id] = f; });
  var gpsTrail = await db.query('SELECT equipment_id, x, y FROM machine_telemetry WHERE source = ? AND recorded_at > NOW() - INTERVAL 10 MINUTE ' +
    'ORDER BY recorded_at DESC, id DESC', ['gps']);
  var net = null;
  var plant = null;
  var alerts = [];

  for (var i = 0; i < rows.length; i++) {
    var m = rows[i];
    var f = m.field_id ? fieldById[m.field_id] : null;
    m.soil_no = f ? f.soil_no : null;
    m.mobile = m.mobile === null ? 1 : m.mobile;
    m.trail = [];
    var age = m.age_s === null ? Infinity : m.age_s;
    var elapsedH = isFinite(age) ? age / 3600 : 0;
    if (m.recorded_at === null) {
      m.x = m.base_x; m.y = m.base_y; m.heading = 0; m.speed_kmh = 0; m.fuel_pct = null; m.engine_hours = null;
    }

    if (m.source === 'gps' && age <= GPS_FRESH_S) {
      m.live = 'gps';
      m.trail = gpsTrail.filter(function (g) { return g.equipment_id === m.id; }).slice(0, TRAIL_POINTS)
        .map(function (g) { return [Number(g.x), Number(g.y)]; }).reverse();
    } else if (m.status === 'operating' && m.mobile) {
      m.live = 'sim';
      var path = null;
      var kmh = m.field_speed_kmh || 5;
      if (m.type === 'Grain truck' && f) {
        if (!net) {
          net = await loadNetwork();
          plant = net.nodes.filter(function (n) { return n.name === 'Seed processing plant'; })[0];
        }
        var r = plant ? routing.findRoute(net.nodes, net.edges, { x: f.x + f.w / 2, y: f.y + f.h / 2 }, plant,
          { profile: profileOf(m), optimize: 'time' }) : null;
        if (r) { path = r.points; kmh = Math.min(m.road_speed_kmh, 20); m.route_m = r.distance_m; }
      }
      if (!path && f) path = workPattern(f);
      if (path) {
        var phase = m.id * 137;
        var p = shuttle(path, kmh, now + phase);
        m.x = round1(p.x); m.y = round1(p.y); m.heading = p.heading;
        m.speed_kmh = round1(kmh * (0.9 + 0.1 * Math.sin(now / 7 + m.id)));
        for (var k = TRAIL_POINTS; k >= 1; k--) {
          var q = shuttle(path, kmh, now + phase - k * TRAIL_STEP_S);
          m.trail.push([round1(q.x), round1(q.y)]);
        }
      }
      // fuel use since the last report; a refill brings the tank back to ~95 %
      if (m.fuel_pct !== null) {
        var fuel = m.fuel_pct - elapsedH * (m.fuel_l_h || 5) * 0.4;
        if (fuel < 12) fuel = 95 - ((12 - fuel) % 83);
        m.fuel_pct = round1(fuel);
        m.engine_hours = round1(m.engine_hours + elapsedH);
      }
    } else {
      m.live = m.source === 'gps' ? 'gps-stale' : (m.mobile ? 'parked' : 'stationary');
      m.speed_kmh = 0;
    }
    m.last_seen_s = m.live === 'sim' ? 0 : (isFinite(age) ? age : null);
    if (m.status === 'operating' && m.fuel_pct !== null && m.fuel_pct < 20) {
      alerts.push({ level: 'warning', equipment_id: m.id, text: m.designation + ': low fuel ' + m.fuel_pct + '%' });
    }
    if (m.live === 'gps-stale' && m.status === 'operating') {
      alerts.push({ level: 'warning', equipment_id: m.id, text: m.designation + ': no GPS signal for ' + Math.round(age / 60) + ' min' });
    }
    if (m.status === 'repair') alerts.push({ level: 'info', equipment_id: m.id, text: m.designation + ' under repair: ' + (m.reason || '-') });
    ['base_x', 'base_y', 'age_s', 'source', 'recorded_at'].forEach(function (key) { delete m[key]; });
  }
  return { machines: rows, alerts: alerts };
}

module.exports = { loadNetwork: loadNetwork, liveMachines: liveMachines, profileOf: profileOf, GPS_FRESH_S: GPS_FRESH_S };
