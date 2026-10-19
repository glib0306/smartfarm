// Bridge to the Python analytics engine: python analytics/run.py <command>, JSON in via stdin, JSON out via stdout.
var spawn = require('child_process').spawn;
var path = require('path');
var config = require('./config');

function run(command, data, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var proc = spawn(config.python, [path.join(config.analyticsDir, 'run.py'), command], { windowsHide: true });
    var out = '';
    var err = '';
    var timer = setTimeout(function () { proc.kill(); reject(new Error('Python analytics timed out: ' + command)); },
      timeoutMs || 120000);
    proc.stdout.on('data', function (d) { out += d; });
    proc.stderr.on('data', function (d) { err += d; });
    proc.on('error', function (e) { clearTimeout(timer); reject(new Error('Cannot start Python (' + config.python + '): ' + e.message)); });
    proc.on('close', function () {
      clearTimeout(timer);
      var parsed;
      try { parsed = JSON.parse(out); } catch (e) { return reject(new Error('Python output invalid: ' + (err || out).slice(0, 500))); }
      if (parsed && parsed.error) return reject(new Error('Analytics error: ' + parsed.error));
      resolve(parsed);
    });
    proc.stdin.write(JSON.stringify(data || {}));
    proc.stdin.end();
  });
}

module.exports = { run: run };
