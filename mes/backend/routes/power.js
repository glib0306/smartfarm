// Power management: consumption status (monthly / 10-day / weekly), power system status and distribution analysis.
var router = require('express').Router();
var db = require('../../../common/db');
var auth = require('../../../common/auth');
var h = require('../../../common/http');

router.get('/options', h.wrap(async function (req, res) {
  var depts = await db.query('SELECT DISTINCT d.id, d.name FROM departments d JOIN power_stations s ON s.department_id = d.id ORDER BY d.id');
  var stations = await db.query('SELECT id, name, type FROM power_stations ORDER BY id');
  res.json({ departments: depts, stations: stations });
}));

function pivot(rows, labelKey, seriesKey, nameKey) {
  var labels = [];
  var series = {};
  var map = {};
  rows.forEach(function (r) {
    if (labels.indexOf(r[labelKey]) < 0) labels.push(r[labelKey]);
    series[r[seriesKey]] = r[nameKey];
    map[r[labelKey]] = map[r[labelKey]] || { label: r[labelKey] };
    map[r[labelKey]]['s' + r[seriesKey]] = Math.round(Number(r.kwh));
  });
  return { rows: labels.map(function (l) { return map[l]; }),
    series: Object.keys(series).map(function (k) { return { key: 's' + k, name: series[k] }; }) };
}

router.get('/consumption', auth.requireMenu('power_consumption'), h.wrap(async function (req, res) {
  var mode = req.query.mode || 'monthly';
  var dep = req.query.department_id && req.query.department_id !== 'all' ? parseInt(req.query.department_id, 10) : null;
  var rows;
  if (mode === 'monthly') {
    rows = await db.query("SELECT DATE_FORMAT(c.reading_date, '%Y-%m') AS label, c.department_id AS sid, d.name, SUM(c.kwh) AS kwh FROM power_consumption c " +
      'JOIN departments d ON d.id = c.department_id WHERE c.reading_date > CURDATE() - INTERVAL 4 MONTH ' + (dep ? 'AND c.department_id = ? ' : '') +
      'GROUP BY label, c.department_id, d.name ORDER BY label, c.department_id', dep ? [dep] : []);
    return res.json(pivot(rows, 'label', 'sid', 'name'));
  }
  if (mode === 'tenday') {
    var ids = String(req.query.stations || 'all');
    var list = ids === 'all' ? null : ids.split(',').map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x > 0; });
    rows = await db.query("SELECT CONCAT(DATE_FORMAT(c.reading_date, '%m'), '/', CASE WHEN DAY(c.reading_date) <= 10 THEN '01-10' " +
      "WHEN DAY(c.reading_date) <= 20 THEN '11-20' ELSE '21-' END) AS label, c.station_id AS sid, s.name, SUM(c.kwh) AS kwh " +
      'FROM power_consumption c JOIN power_stations s ON s.id = c.station_id WHERE c.reading_date > CURDATE() - INTERVAL 90 DAY ' +
      (list && list.length ? 'AND c.station_id IN (?) ' : '') + 'GROUP BY label, c.station_id, s.name ORDER BY MIN(c.reading_date), c.station_id',
    list && list.length ? [list] : []);
    return res.json(pivot(rows, 'label', 'sid', 'name'));
  }
  rows = await db.query("SELECT DATE_FORMAT(c.reading_date, '%m-%d') AS label, c.department_id AS sid, d.name, SUM(c.kwh) AS kwh FROM power_consumption c " +
    'JOIN departments d ON d.id = c.department_id WHERE c.reading_date > CURDATE() - INTERVAL 7 DAY ' + (dep ? 'AND c.department_id = ? ' : '') +
    'GROUP BY label, c.department_id, d.name ORDER BY label, c.department_id', dep ? [dep] : []);
  res.json(pivot(rows, 'label', 'sid', 'name'));
}));

// Power system status + distribution analysis (load balancing proposals for faulty or overloaded nodes).
router.get('/system', auth.requireMenu('power_system'), h.wrap(async function (req, res) {
  var stations = db.num(await db.query('SELECT s.*, d.name AS department_name FROM power_stations s JOIN departments d ON d.id = s.department_id ORDER BY s.id'),
    ['capacity_kw', 'load_kw']);
  var lines = db.num(await db.query('SELECT * FROM power_lines'), ['voltage_kv']);
  var today = await db.query('SELECT station_id, kwh FROM power_consumption WHERE reading_date = CURDATE()');
  stations.forEach(function (s) {
    s.utilisation = Math.round(100 * s.load_kw / s.capacity_kw);
    var t = today.filter(function (x) { return x.station_id === s.id; })[0];
    s.kwh_today = t ? Number(t.kwh) : 0;
  });
  var proposals = [];
  stations.filter(function (s) { return s.status === 'fault' || s.utilisation > 85; }).forEach(function (s) {
    var excess = s.status === 'fault' ? s.load_kw : s.load_kw - 0.8 * s.capacity_kw;
    var candidates = stations.filter(function (c) { return c.id !== s.id && c.status === 'normal' && (c.type === s.type || c.type === 'transformer' || c.type === 'substation'); })
      .sort(function (a, b) { return (b.capacity_kw - b.load_kw) - (a.capacity_kw - a.load_kw); });
    candidates.forEach(function (c) {
      if (excess <= 0) return;
      var spare = 0.85 * c.capacity_kw - c.load_kw;
      if (spare <= 0) return;
      var move = Math.min(spare, excess);
      excess -= move;
      proposals.push({ from: s.name, to: c.name, kw: Math.round(move * 10) / 10, reason: s.status === 'fault' ? 'fault isolation' : 'overload relief' });
    });
    if (excess > 0) proposals.push({ from: s.name, to: '(shed / reschedule loads)', kw: Math.round(excess * 10) / 10, reason: 'insufficient spare capacity' });
  });
  res.json({ stations: stations, lines: lines, proposals: proposals,
    totals: { capacity_kw: stations.reduce(function (a, s) { return a + s.capacity_kw; }, 0), load_kw: stations.reduce(function (a, s) { return a + s.load_kw; }, 0),
      faults: stations.filter(function (s) { return s.status !== 'normal'; }).length + lines.filter(function (l) { return l.status !== 'normal'; }).length } });
}));

module.exports = router;
