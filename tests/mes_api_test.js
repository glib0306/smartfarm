// MES API smoke test (needs a running MES backend and a freshly imported database): node tests/mes_api_test.js [port]
var http = require('http');
var PORT = process.argv[2] || process.env.MES_PORT || 4000;

function call(method, path, body, token) {
  return new Promise(function (resolve) {
    var data = body ? JSON.stringify(body) : null;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + path, method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}) }, function (res) {
      var s = '';
      res.on('data', function (d) { s += d; });
      res.on('end', function () { var j; try { j = JSON.parse(s); } catch (e) { j = s; } resolve({ status: res.statusCode, body: j }); });
    });
    if (data) req.write(data);
    req.end();
  });
}

function short(b) { var s = JSON.stringify(b); return s.length > 220 ? s.slice(0, 220) + '...' : s; }

async function login(u) { return (await call('POST', '/auth/login', { username: u, password: '1234' })).body.token; }

(async function () {
  var fails = 0;
  async function t(label, method, path, body, token, expect) {
    var t0 = Date.now();
    var r = await call(method, path, body, token);
    var ok = expect ? expect.indexOf(r.status) >= 0 : r.status === 200;
    if (!ok) fails++;
    console.log((ok ? 'OK  ' : 'FAIL') + ' ' + r.status + ' ' + label + ' (' + (Date.now() - t0) + 'ms) ' + short(r.body));
    return r.body;
  }
  var admin = await login('admin');
  var director = await login('director');
  var rice = await login('rice_div');
  var leader = await login('leader5');
  var farmer = await login('farmer5_1');
  await t('login bad', 'POST', '/auth/login', { username: 'admin', password: 'x' }, null, [401]);
  await t('login unapproved', 'POST', '/auth/login', { username: 'newcomer', password: '1234' }, null, [403]);
  await t('me', 'GET', '/auth/me', null, leader);
  await t('home', 'GET', '/farm/home', null, admin);
  await t('fields', 'GET', '/farm/fields', null, admin);
  await t('weather', 'GET', '/farm/weather', null, admin);
  await t('equipment', 'GET', '/farm/equipment', null, admin);
  await t('irrigation', 'GET', '/farm/irrigation', null, admin);
  var hmap = await t('machinery map', 'GET', '/machinery/map', null, leader);
  await t('machinery map forbidden for farmer', 'GET', '/machinery/map', null, farmer, [403]);
  var live = await t('machinery live', 'GET', '/machinery/live', null, admin);
  var plant = hmap.facilities.filter(function (f) { return f.name === 'Seed processing plant'; })[0];
  var combine = live.machines.filter(function (m) { return m.type === 'Combine harvester' && m.status === 'operating'; })[0];
  await t('route field -> plant (shortest)', 'POST', '/machinery/route', { from: { field_id: 1 }, to: { node_id: plant.id } }, admin);
  await t('route points (fastest, truck)', 'POST', '/machinery/route', { from: { x: 100, y: 100 }, to: { x: 900, y: 500 },
    machine_type: 'Grain truck', optimize: 'time' }, admin);
  if (combine) await t('route machine -> plant', 'POST', '/machinery/route', { from: { equipment_id: combine.id }, to: { node_id: plant.id },
    equipment_id: combine.id }, admin);
  await t('route stationary (warning)', 'POST', '/machinery/route', { from: { field_id: 1 }, to: { field_id: 2 }, machine_type: 'Grain dryer' }, admin, [400]);
  await t('route outside map', 'POST', '/machinery/route', { from: { x: -5, y: 10 }, to: { field_id: 2 } }, admin, [400]);
  await t('telemetry ingest', 'POST', '/machinery/telemetry', { records: [{ equipment_id: 1, x: 120, y: 80, speed_kmh: 6, heading: 90, fuel_pct: 64 }] }, admin);
  await t('telemetry bad id', 'POST', '/machinery/telemetry', { records: [{ equipment_id: 9999, x: 1, y: 1 }] }, admin, [400]);
  var annual = await t('annual', 'GET', '/plans/annual', null, director);
  await t('annual submit dup (warning)', 'POST', '/plans/' + annual.plans[1].id + '/submit', null, director, [409]);
  await t('monthly', 'GET', '/plans/monthly', null, director);
  await t('monthly forbidden for L2', 'GET', '/plans/monthly', null, rice, [403]);
  var f = await t('fifteen (L2)', 'GET', '/plans/fifteen', null, rice);
  await t('fifteen split 16', 'GET', '/plans/fifteen?split=16&department_id=3', null, director);
  var five = await t('five (L2)', 'GET', '/plans/five', null, rice);
  await t('five (L3 view)', 'GET', '/plans/five', null, leader);
  if (five.plans && five.plans.length) {
    var draft = five.plans.filter(function (p) { return p.status !== 'approved'; })[0];
    await t('approve second (warning)', 'POST', '/plans/' + draft.id + '/approve', null, rice, [409]);
    await t('approve by L3 (forbidden)', 'POST', '/plans/' + draft.id + '/approve', null, leader, [403]);
  }
  await t('next month monthly (generate)', 'GET', '/plans/monthly?date=' + nextMonth(), null, director);
  await t('fulfilment summary', 'GET', '/fulfilment/summary', null, admin);
  await t('fulfilment dept 5', 'GET', '/fulfilment/department/5', null, admin);
  await t('fulfilment dept 2', 'GET', '/fulfilment/department/2', null, admin);
  var diary = await t('diary', 'GET', '/diary', null, leader);
  if (diary.rows) {
    await t('diary save', 'POST', '/diary', { rows: diary.rows.map(function (r) { return { farmer_id: r.farmer_id, plan_qty: r.plan_qty, exec_qty: r.plan_qty * 0.9 }; }) }, leader);
  }
  var hist = await t('diary history', 'GET', '/diary/history', null, leader);
  var old = hist.filter(function (r) { return r.report_date < new Date().toISOString().slice(0, 10); })[0];
  if (old) {
    var er = await t('edit old report -> request', 'PUT', '/diary/report/' + old.id, { exec_qty: 1.11 }, leader);
    await t('edit requests list', 'GET', '/edit-requests', null, rice);
    await t('manager ratify', 'POST', '/edit-requests/' + er.request_id + '/approve', null, rice);
  }
  await t('surveys', 'GET', '/quality/surveys?crop=rice&index=tiller_number', null, admin);
  await t('forecast 30', 'GET', '/quality/forecast?crop=rice&cultivar_id=1&horizon=30', null, admin);
  await t('forecast wheat 7', 'GET', '/quality/forecast?crop=wheat&horizon=7', null, admin);
  await t('reach', 'POST', '/quality/reach', { crop: 'rice', cultivar_id: 2, kind: 'leaf', target: 15.5 }, admin);
  await t('nutrition', 'GET', '/quality/nutrition?crop=rice', null, admin);
  await t('growth map', 'GET', '/quality/map', null, admin);
  await t('pests', 'GET', '/quality/pests', null, admin);
  var np = await t('pest add', 'POST', '/quality/pests', { field_id: 3, pest_name: 'Rice blast', individuals: 40, damaged_area_m2: 12 }, admin);
  await t('pest edit today', 'PUT', '/quality/pests/' + np.id, { individuals: 55 }, admin);
  await t('pest map', 'GET', '/quality/pest-map', null, admin);
  await t('pest predict', 'POST', '/quality/pests/predict', { days: 21 }, admin);
  await t('measures prepare', 'POST', '/quality/measures/prepare', {}, admin);
  await t('measures submit', 'POST', '/quality/measures/submit', {}, admin);
  await t('measures submit dup', 'POST', '/quality/measures/submit', {}, admin, [409]);
  await t('measures cancel', 'POST', '/quality/measures/cancel', {}, admin);
  await t('power options', 'GET', '/power/options', null, admin);
  await t('power monthly', 'GET', '/power/consumption?mode=monthly&department_id=all', null, admin);
  await t('power tenday', 'GET', '/power/consumption?mode=tenday&stations=1,5,6', null, admin);
  await t('power weekly', 'GET', '/power/consumption?mode=weekly&department_id=10', null, admin);
  await t('power system', 'GET', '/power/system', null, admin);
  await t('decision yield', 'GET', '/decision/yield', null, admin);
  await t('decision fertility', 'GET', '/decision/fertility', null, admin);
  await t('decision allocation labor', 'GET', '/decision/allocation?resource=labor', null, admin);
  await t('decision allocation water', 'GET', '/decision/allocation?resource=water', null, admin);
  await t('decision submit', 'POST', '/decision/submit', { kind: 'labor', data: { x: 1 } }, admin);
  await t('erp', 'GET', '/erp/submissions', null, admin);
  await t('admin users', 'GET', '/admin/users', null, admin);
  await t('admin forbidden', 'GET', '/admin/users', null, director, [403]);
  await t('admin departments', 'GET', '/admin/departments', null, admin);
  await t('layout swap', 'POST', '/farm/layout/swap', { from_field: 1, to_field: 2 }, admin);
  await t('layout swap back', 'POST', '/farm/layout/swap', { from_field: 1, to_field: 2 }, admin);
  console.log(fails ? fails + ' FAILURES' : 'ALL PASSED');
})();

function nextMonth() { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); }
