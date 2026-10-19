// ERP interface log (offline): everything MES transferred to ERP, with submission / cancellation state.
var router = require('express').Router();
var db = require('../../../common/db');
var h = require('../../../common/http');

router.get('/submissions', h.wrap(async function (req, res) {
  var rows = await db.query('SELECT e.id, e.ref_type, e.ref_id, e.status, e.submitted_at, e.cancelled_at, u.full_name AS submitted_by_name, ' +
    'LEFT(e.payload, 300) AS preview FROM erp_submissions e LEFT JOIN users u ON u.id = e.submitted_by ORDER BY e.submitted_at DESC LIMIT 100');
  res.json(rows);
}));

router.get('/submissions/:id', h.wrap(async function (req, res) {
  var r = await db.one('SELECT * FROM erp_submissions WHERE id = ?', [req.params.id]);
  if (!r) throw h.fail(404, 'Not found');
  r.payload = JSON.parse(r.payload);
  res.json(r);
}));

module.exports = router;
