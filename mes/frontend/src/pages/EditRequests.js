// Joint ratification of edits to data stored on earlier dates (entering person + manager).
import React, { useEffect, useState } from 'react';
import { api, post } from '../api';
import { DataTable, Loading, PageTitle, Panel, notify, notifyError } from '../components/ui';

export default function EditRequests({ user }) {
  const [rows, setRows] = useState(null);
  const load = () => api('/edit-requests').then(setRows).catch(notifyError);
  useEffect(() => { load(); }, []);
  async function act(r, what) {
    try {
      const res = await post('/edit-requests/' + r.id + '/' + what);
      notify(what === 'reject' ? 'Request rejected' : res.status === 'applied' ? 'Both parties ratified: change applied.' : 'Ratified. Waiting for the other party.');
      load();
    } catch (e) { notifyError(e); }
  }
  if (!rows) return <Loading />;
  return (
    <div>
      <PageTitle>Ratification of data edits</PageTitle>
      <div className="info-box">Only data stored today can be edited directly. Changes to earlier data need joint ratification by the person who entered it and a manager.</div>
      <Panel>
        <DataTable rowKey={(r) => r.id} rows={rows} empty="No pending requests" columns={[
          { key: 'created_at', label: 'Requested' }, { key: 'table_name', label: 'Data' }, { key: 'record_id', label: 'Record' },
          { key: 'payload', label: 'Change', render: (r) => <code>{r.payload}</code> },
          { key: 'requested_by_name', label: 'Requested by' }, { key: 'owner_name', label: 'Entered by' },
          { key: 'owner_approved', label: 'Owner', render: (r) => (r.owner_approved ? '✔' : '…') },
          { key: 'manager_approved', label: 'Manager', render: (r) => (r.manager_approved ? '✔' : '…') },
          { key: 'a', label: '', render: (r) => {
            const canOwner = r.owner_id === user.id && !r.owner_approved;
            const canMgr = (user.role === 'manager' || user.role === 'admin') && r.owner_id !== user.id && !r.manager_approved;
            return (
              <span className="row" style={{ flexWrap: 'nowrap' }}>
                <button className="btn btn-primary" disabled={!canOwner && !canMgr} onClick={() => act(r, 'approve')}>Ratify</button>
                <button className="btn btn-danger" onClick={() => act(r, 'reject')}>Reject</button>
              </span>
            );
          } }]} />
      </Panel>
    </div>
  );
}
