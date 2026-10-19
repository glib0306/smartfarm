// MySQL connection pool with promise helpers (mysqljs works with MySQL 5.x and the MariaDB shipped in XAMPP).
var mysql = require('mysql');
var config = require('./config');

var pool = mysql.createPool(Object.assign({ connectionLimit: 10, dateStrings: true, multipleStatements: false,
  supportBigNumbers: true }, config.db));

function query(sql, params) {
  return new Promise(function (resolve, reject) {
    pool.query(sql, params || [], function (err, rows) {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function one(sql, params) {
  return query(sql, params).then(function (rows) { return rows[0] || null; });
}

// Runs fn(q) inside a transaction; q has the same signature as query().
function transaction(fn) {
  return new Promise(function (resolve, reject) {
    pool.getConnection(function (err, conn) {
      if (err) return reject(err);
      function q(sql, params) {
        return new Promise(function (res, rej) {
          conn.query(sql, params || [], function (e, rows) { return e ? rej(e) : res(rows); });
        });
      }
      conn.beginTransaction(function (e) {
        if (e) { conn.release(); return reject(e); }
        Promise.resolve().then(function () { return fn(q); }).then(function (result) {
          conn.commit(function (ce) {
            conn.release();
            return ce ? reject(ce) : resolve(result);
          });
        }).catch(function (fe) {
          conn.rollback(function () { conn.release(); reject(fe); });
        });
      });
    });
  });
}

// Converts DECIMAL strings to numbers for chart-friendly JSON.
function num(rows, keys) {
  rows.forEach(function (r) {
    keys.forEach(function (k) { if (r[k] !== null && r[k] !== undefined) r[k] = Number(r[k]); });
  });
  return rows;
}

module.exports = { pool: pool, query: query, one: one, transaction: transaction, num: num };
