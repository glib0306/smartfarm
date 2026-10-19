// Data editing rule: only data stored today can be edited directly.
// Data from earlier dates can be modified only after joint ratification of the person who entered it and a manager.
var db = require('../../../common/db');
var dates = require('../../../common/dates');

var EDITABLE = {
  pests: { dateCol: 'created_at', ownerCol: 'created_by',
    cols: ['field_id', 'pest_name', 'category', 'occurred_on', 'location_desc', 'image_url', 'individuals', 'damaged_area_m2'] },
  daily_reports: { dateCol: 'report_date', ownerCol: 'created_by', cols: ['plan_qty', 'exec_qty'] }
};

function clean(table, payload) {
  var out = {};
  EDITABLE[table].cols.forEach(function (c) { if (payload[c] !== undefined) out[c] = payload[c]; });
  return out;
}

function isManager(user) { return user.role === 'admin' || user.role === 'manager'; }

// Applies the change if allowed today, otherwise records an edit request. Returns {applied, request_id, message}.
async function editOrRequest(table, id, payload, user, afterApply) {
  var cfg = EDITABLE[table];
  var rec = await db.one('SELECT * FROM ' + table + ' WHERE id = ?', [id]);
  if (!rec) { var e = new Error('Record not found'); e.status = 404; throw e; }
  var data = clean(table, payload);
  if (!Object.keys(data).length) { var e2 = new Error('Nothing to update'); e2.status = 400; throw e2; }
  if (String(rec[cfg.dateCol]).slice(0, 10) === dates.today()) {
    await db.query('UPDATE ' + table + ' SET ? WHERE id = ?', [data, id]);
    if (afterApply) await afterApply(rec);
    return { applied: true, message: 'Saved' };
  }
  var owner = rec[cfg.ownerCol] || null;
  var r = await db.query('INSERT INTO edit_requests (table_name, record_id, payload, requested_by, owner_id, owner_approved, ' +
    'manager_approved, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NOW())',
  [table, id, JSON.stringify(data), user.id, owner, owner === user.id ? 1 : 0, 'pending']);
  return { applied: false, request_id: r.insertId,
    message: 'This record was stored on an earlier date. An edit request was created and needs joint ratification ' +
      'by the person who entered it and a manager.' };
}

async function approve(reqId, user, hooks) {
  var r = await db.one('SELECT * FROM edit_requests WHERE id = ?', [reqId]);
  if (!r || r.status !== 'pending') { var e = new Error('Request not pending'); e.status = 404; throw e; }
  var owner = r.owner_approved;
  var manager = r.manager_approved;
  var acted = false;
  if (user.id === r.owner_id && !owner) { owner = 1; acted = true; }
  if (isManager(user) && user.id !== r.owner_id && !manager) { manager = 1; acted = true; }
  if (!acted) { var e2 = new Error('You cannot ratify this request (owner and a different manager must approve)'); e2.status = 403; throw e2; }
  var status = owner && manager ? 'applied' : 'pending';
  await db.query('UPDATE edit_requests SET owner_approved = ?, manager_approved = ?, status = ? WHERE id = ?',
    [owner, manager, status, r.id]);
  if (status === 'applied') {
    var data = clean(r.table_name, JSON.parse(r.payload));
    var rec = await db.one('SELECT * FROM ' + r.table_name + ' WHERE id = ?', [r.record_id]);
    await db.query('UPDATE ' + r.table_name + ' SET ? WHERE id = ?', [data, r.record_id]);
    if (hooks && hooks[r.table_name] && rec) await hooks[r.table_name](rec);
  }
  return { status: status, owner_approved: owner, manager_approved: manager };
}

module.exports = { editOrRequest: editOrRequest, approve: approve, EDITABLE: EDITABLE, isManager: isManager };
