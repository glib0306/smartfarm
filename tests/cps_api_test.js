// CPS API smoke test (needs a running CPS backend): node tests/cps_api_test.js [port]
var http = require('http');
var PORT = process.argv[2] || process.env.CPS_PORT || 5000;
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
function short(b) { var s = JSON.stringify(b); return s.length > 300 ? s.slice(0, 300) + '...' : s; }
(async function () {
  var fails = 0;
  async function t(label, method, path, body, token, expect) {
    var t0 = Date.now();
    var r = await call(method, path, body, token);
    var ok = (expect || [200]).indexOf(r.status) >= 0;
    if (!ok) fails++;
    console.log((ok ? 'OK  ' : 'FAIL') + ' ' + r.status + ' ' + label + ' (' + (Date.now() - t0) + 'ms) ' + short(r.body));
    return r.body;
  }
  await t('unauth', 'GET', '/plans', null, null, [401]);
  var tok = (await call('POST', '/auth/login', { username: 'director', password: '1234' })).body.token;
  var plans = await t('plans', 'GET', '/plans', null, tok);
  var monthly = plans.filter(function (p) { return p.plan_type === 'monthly' && p.status === 'approved'; })[0];
  var annual = plans.filter(function (p) { return p.plan_type === 'annual'; })[0];
  var five = plans.filter(function (p) { return p.plan_type === 'five'; })[0];
  await t('plan sim annual', 'GET', '/plan-sim/' + annual.id, null, tok);
  await t('plan sim monthly', 'GET', '/plan-sim/' + monthly.id, null, tok);
  await t('plan sim five', 'GET', '/plan-sim/' + five.id, null, tok);
  var g = await t('growth sim', 'GET', '/growth-sim?weeks=8', null, tok);
  console.log('   rice weeks:', JSON.stringify(g.crops.rice.map(function (w) { return [w.week, w.leaf, w.tiller, w.height_cm, w.stage, w.ripeness]; })));
  console.log('   wheat weeks:', JSON.stringify(g.crops.wheat.map(function (w) { return [w.week, w.leaf, w.tiller, w.height_cm, w.stage]; })));
  await t('response rice', 'POST', '/response', { crop: 'rice', measures: ['n_topdress', 'pest_control'] }, tok);
  await t('response wheat', 'POST', '/response', { crop: 'wheat', cultivar_id: 4, measures: ['irrigation'] }, tok);
  await t('pest sim', 'GET', '/pest-sim?days=21', null, tok);
  console.log(fails ? fails + ' FAILURES' : 'ALL PASSED');
})();
