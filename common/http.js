// Small Express helpers shared by MES and CPS.
function wrap(fn) {
  return function (req, res, next) { Promise.resolve(fn(req, res, next)).catch(next); };
}

function fail(status, message, extra) {
  var e = new Error(message);
  e.status = status;
  e.extra = extra;
  return e;
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  var status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json(Object.assign({ error: err.message || 'Server error' }, err.extra || {}));
}

module.exports = { wrap: wrap, fail: fail, errorHandler: errorHandler };
