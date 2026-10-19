// MES backend (Node + Express + Python analytics). Serves the REST API and, in production, the built React app.
var express = require('express');
var cors = require('cors');
var path = require('path');
var fs = require('fs');
var config = require('../../common/config');
var http = require('../../common/http');
var auth = require('../../common/auth');

var app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', function (req, res) { res.json({ ok: true, system: 'MES', time: new Date().toISOString() }); });
app.get('/api/time', function (req, res) { res.json({ now: new Date().toISOString() }); });

app.use('/api/auth', require('./routes/auth'));
app.use('/api', auth.authRequired);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/edit-requests', require('./routes/editRequests'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/fulfilment', require('./routes/fulfilment'));
app.use('/api/diary', require('./routes/diary'));
app.use('/api/farm', require('./routes/farm'));
app.use('/api/machinery', require('./routes/machinery'));
app.use('/api/quality', require('./routes/quality'));
app.use('/api/power', require('./routes/power'));
app.use('/api/decision', require('./routes/decision'));
app.use('/api/erp', require('./routes/erp'));
app.use('/api', function (req, res) { res.status(404).json({ error: 'Unknown API endpoint' }); });

var build = path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(build)) {
  app.use(express.static(build));
  app.get('*', function (req, res) { res.sendFile(path.join(build, 'index.html')); });
}
app.use(http.errorHandler);

if (require.main === module) {
  app.listen(config.mesPort, function () { console.log('MES backend listening on http://localhost:' + config.mesPort); });
}
module.exports = app;
