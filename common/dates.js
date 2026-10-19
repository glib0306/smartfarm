// Date helpers. All "today" logic uses the server clock.
function pad(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parse(s) { var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function addDays(d, n) { var r = new Date(d.getTime()); r.setDate(r.getDate() + n); return r; }
function today() { return ymd(new Date()); }
function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000) + 1; }

function monthBounds(day) {
  var d = parse(day);
  var first = new Date(d.getFullYear(), d.getMonth(), 1);
  var last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [ymd(first), ymd(last)];
}

// 15-day periods of a month: [1..split], [split+1..end]. split = 14, 15 or 16 (14/15/16-day plans).
function fifteenPeriods(day, split) {
  var mb = monthBounds(day);
  var s = parseInt(split || 15, 10);
  if ([14, 15, 16].indexOf(s) < 0) s = 15;
  var first = parse(mb[0]);
  var mid = new Date(first.getFullYear(), first.getMonth(), s);
  return [[mb[0], ymd(mid)], [ymd(addDays(mid, 1)), mb[1]]];
}

// 5-day periods of a 15-day period: 5 + 5 + rest (4..6 days, the last one may be a six-day plan).
function fivePeriods(start, end) {
  var s = parse(start);
  return [[ymd(s), ymd(addDays(s, 4))], [ymd(addDays(s, 5)), ymd(addDays(s, 9))], [ymd(addDays(s, 10)), end]];
}

function findPeriod(periods, day) {
  for (var i = 0; i < periods.length; i++) if (day >= periods[i][0] && day <= periods[i][1]) return periods[i];
  return periods[0];
}

module.exports = { ymd: ymd, parse: parse, addDays: addDays, today: today, daysBetween: daysBetween,
  monthBounds: monthBounds, fifteenPeriods: fifteenPeriods, fivePeriods: fivePeriods, findPeriod: findPeriod };
