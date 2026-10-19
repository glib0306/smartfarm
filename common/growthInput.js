// Builds the input of the Python growth model (shared by MES growth forecast and CPS growth simulation).
var db = require('./db');

async function futureTemps(days) {
  var rows = await db.query('SELECT t_avg FROM weather_forecast WHERE forecast_date > CURDATE() ORDER BY forecast_date LIMIT ?', [days || 30]);
  var temps = rows.map(function (r) { return Number(r.t_avg); });
  // beyond the forecast horizon: continue the trend of the last 7 forecast days
  if (temps.length >= 2) {
    var tail = temps.slice(-7);
    var slope = (tail[tail.length - 1] - tail[0]) / Math.max(1, tail.length - 1);
    while (temps.length < 200) temps.push(Math.max(-15, temps[temps.length - 1] + slope * 0.5));
  }
  return temps.length ? temps : [15];
}

// fieldWhere: SQL condition on alias f, e.g. 'f.cultivar_id = ?'
async function build(fieldWhere, params) {
  var fields = await db.query('SELECT f.id, f.soil_no, f.crop, f.area_ha, f.grade, f.sowing_date, DATEDIFF(CURDATE(), f.sowing_date) AS das, ' +
    'c.id AS cid, c.name AS cultivar_name, c.base_temp, c.phyllochron, c.max_leaves, c.max_tillers, c.maturity_days, c.potential_yield ' +
    'FROM fields f JOIN cultivars c ON c.id = f.cultivar_id WHERE ' + (fieldWhere || '1 = 1') + ' ORDER BY f.id', params || []);
  if (!fields.length) return [];
  var minSow = fields.reduce(function (m, f) { return f.sowing_date < m ? f.sowing_date : m; }, fields[0].sowing_date);
  var weather = await db.query('SELECT obs_date, t_avg FROM weather_daily WHERE obs_date >= ? AND obs_date <= CURDATE()', [minSow]);
  var temp = {};
  weather.forEach(function (w) { temp[w.obs_date] = Number(w.t_avg); });
  var ids = fields.map(function (f) { return f.id; });
  var surveys = await db.query('SELECT field_id, days_after_sowing AS das, leaf_number AS leaf, tiller_number AS tiller FROM growth_surveys ' +
    'WHERE field_id IN (?) ORDER BY survey_date', [ids]);
  return fields.map(function (f) {
    var past = [];
    var d = new Date(f.sowing_date + 'T00:00:00');
    for (var i = 0; i < Math.max(1, f.das); i++) {
      var key = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      past.push(temp[key] !== undefined ? temp[key] : 15);
      d.setDate(d.getDate() + 1);
    }
    var maturity = f.crop === 'wheat' ? 110 : f.maturity_days; // wheat season is time-compressed in the virtual data
    return {
      field_id: f.id, soil_no: f.soil_no, crop: f.crop, area_ha: Number(f.area_ha), grade: f.grade, das_today: f.das,
      cultivar_name: f.cultivar_name, potential_yield: Number(f.potential_yield),
      cultivar: { id: f.cid, base_temp: Number(f.base_temp), phyllochron: Number(f.phyllochron), max_leaves: Number(f.max_leaves),
        max_tillers: Number(f.max_tillers), maturity_days: maturity },
      past_temps: past,
      surveys: surveys.filter(function (s) { return s.field_id === f.id; }).map(function (s) {
        return { das: s.das, leaf: Number(s.leaf), tiller: Number(s.tiller) };
      })
    };
  });
}

// Self-learning: persist re-calibrated model parameters (one row per cultivar per training run).
async function saveModels(models) {
  for (var i = 0; i < (models || []).length; i++) {
    var m = models[i];
    await db.query("INSERT INTO model_params (model, cultivar_id, params, samples, rmse, trained_at) VALUES ('growth', ?, ?, ?, ?, NOW())",
      [m.cultivar_id, JSON.stringify(m.params), m.samples, m.rmse]);
  }
}

module.exports = { build: build, futureTemps: futureTemps, saveModels: saveModels };
