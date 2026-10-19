// Sums the daily reports of a 5-day plan and distributes the executed quantity over its tasks (pro rata to plan).
var db = require('../../../common/db');

async function recomputeFivePlan(planId) {
  if (!planId) return;
  var tot = await db.one('SELECT COALESCE(SUM(exec_qty), 0) AS ex FROM daily_reports WHERE five_plan_id = ?', [planId]);
  var planned = await db.one('SELECT COALESCE(SUM(planned_qty), 0) AS p FROM plan_tasks WHERE plan_id = ?', [planId]);
  var p = Number(planned.p);
  var ex = Number(tot.ex);
  await db.query('UPDATE plan_tasks SET executed_qty = ROUND(? * planned_qty / ?, 2) WHERE plan_id = ?',
    [ex, p > 0 ? p : 1, planId]);
  return { executed: ex, planned: p };
}

module.exports = { recomputeFivePlan: recomputeFivePlan };
