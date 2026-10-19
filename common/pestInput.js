// Builds the input of the Python pest / disease spread model (MES damage prediction, CPS infestation simulation).
var db = require('./db');
var gi = require('./growthInput');

async function build(days, controlled) {
  var fields = await db.query('SELECT id AS field_id, soil_no, crop, area_ha, x, y FROM fields ORDER BY id');
  // derive grid rows / columns from map coordinates
  var xs = Array.from(new Set(fields.map(function (f) { return f.x; }))).sort(function (a, b) { return a - b; });
  var ys = Array.from(new Set(fields.map(function (f) { return f.y; }))).sort(function (a, b) { return a - b; });
  fields.forEach(function (f) { f.col = xs.indexOf(f.x); f.row = ys.indexOf(f.y); f.area_ha = Number(f.area_ha); });
  var inf = await db.query('SELECT p.field_id, p.pest_name, p.category, p.individuals, p.damaged_area_m2, c.growth_rate, c.spread_prob, c.optimum_temp ' +
    'FROM pests p JOIN pest_catalog c ON c.name = p.pest_name WHERE p.occurred_on >= CURDATE() - INTERVAL 30 DAY');
  db.num(inf, ['damaged_area_m2', 'growth_rate', 'spread_prob', 'optimum_temp']);
  return { fields: fields, infestations: inf, days: days, temps: await gi.futureTemps(days), controlled: controlled || [] };
}

module.exports = { build: build };
