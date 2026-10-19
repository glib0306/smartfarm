// Authorization management (administrator only): users, login approval, menu permissions, organisation hierarchy.
import React, { useEffect, useState } from 'react';
import { api, del, post, put } from '../api';
import { DataTable, Loading, Modal, PageTitle, Panel, Select, StatusPill, Tabs, notify, notifyError } from '../components/ui';

const ROLES = ['admin', 'manager', 'operator', 'farmer'].map((r) => ({ value: r, label: r }));

function UserEditor({ user, menus, deps, onClose, onSaved }) {
  const isNew = !user.id;
  const [f, setF] = useState({ ...user, password: '' });
  const set = (k, v) => setF({ ...f, [k]: v });
  const toggle = (k) => set('permissions', f.permissions.indexOf(k) >= 0 ? f.permissions.filter((x) => x !== k) : f.permissions.concat(k));
  async function save() {
    try {
      if (isNew) await post('/admin/users', f); else await put('/admin/users/' + f.id, f);
      notify('User saved');
      onSaved();
    } catch (e) { notifyError(e); }
  }
  return (
    <Modal title={isNew ? 'Add user' : 'Edit user ' + user.username} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
      <div className="grid g2">
        <label className="field-inline">Username <input type="text" value={f.username} disabled={!isNew} onChange={(e) => set('username', e.target.value)} /></label>
        <label className="field-inline">Full name <input type="text" value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></label>
        <label className="field-inline">Password <input type="password" placeholder={isNew ? '' : '(unchanged)'} value={f.password} onChange={(e) => set('password', e.target.value)} /></label>
        <Select label="Role" value={f.role} onChange={(v) => set('role', v)} options={ROLES} />
        <Select label="Department" value={f.department_id} onChange={(v) => set('department_id', Number(v))}
          options={deps.map((d) => ({ value: d.id, label: '— '.repeat(d.level - 1) + d.name + ' (L' + d.level + ')' }))} />
        <label className="field-inline"><input type="checkbox" checked={!!f.approved} onChange={(e) => set('approved', e.target.checked)} /> Login approved</label>
      </div>
      <h4>Navigation permissions</h4>
      <div className="grid g3">
        {menus.map((m) => (
          <label key={m.key} className="field-inline"><input type="checkbox" checked={f.permissions.indexOf(m.key) >= 0} onChange={() => toggle(m.key)} /> {m.label}</label>
        ))}
      </div>
    </Modal>
  );
}

function Users({ menus, deps }) {
  const [users, setUsers] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = () => api('/admin/users').then(setUsers).catch(notifyError);
  useEffect(() => { load(); }, []);
  if (!users) return <Loading />;
  async function approve(u, ok) {
    try { await post('/admin/users/' + u.id + '/approve', { approved: ok }); notify(ok ? 'Login approved' : 'Login blocked'); load(); } catch (e) { notifyError(e); }
  }
  return (
    <Panel title={`Users (${users.length})`} extra={<button className="btn btn-primary"
      onClick={() => setEdit({ username: '', full_name: '', role: 'farmer', department_id: deps[0] && deps[0].id, approved: true, permissions: ['home'] })}>Add user</button>}>
      <DataTable maxHeight={600} rowKey={(u) => u.id} rows={users} columns={[
        { key: 'username', label: 'Username' }, { key: 'full_name', label: 'Name' }, { key: 'role', label: 'Role' },
        { key: 'department_name', label: 'Department', render: (u) => `${u.department_name} (L${u.department_level})` },
        { key: 'approved', label: 'Login', render: (u) => <StatusPill status={u.approved ? 'approved' : 'pending'} /> },
        { key: 'permissions', label: 'Menus', render: (u) => u.permissions.length },
        { key: 'a', label: '', render: (u) => (
          <span className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="btn" onClick={() => setEdit(u)}>Edit</button>
            {u.approved ? <button className="btn btn-danger" onClick={() => approve(u, false)}>Block</button>
              : <button className="btn btn-primary" onClick={() => approve(u, true)}>Approve login</button>}
          </span>) }]} />
      {edit && <UserEditor user={edit} menus={menus} deps={deps} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </Panel>
  );
}

function Organisation({ deps, reload }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  async function add() {
    try { await post('/admin/departments', { name, parent_id: parent || null }); notify('Department added'); setName(''); reload(); } catch (e) { notifyError(e); }
  }
  async function rename(d) {
    const n = window.prompt('New name for ' + d.name, d.name);
    if (!n) return;
    try { await put('/admin/departments/' + d.id, { name: n, crop: d.crop }); reload(); } catch (e) { notifyError(e); }
  }
  async function remove(d) {
    try { await del('/admin/departments/' + d.id); notify('Department removed'); reload(); } catch (e) { notifyError(e); }
  }
  const ordered = [];
  const walk = (pid) => deps.filter((d) => (d.parent_id || null) === pid).forEach((d) => { ordered.push(d); walk(d.id); });
  walk(null);
  return (
    <Panel title="Organisation system (hierarchical structure)" extra={
      <div className="row">
        <input type="text" placeholder="New department" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={parent} onChange={setParent} options={[{ value: '', label: '(top level)' }].concat(deps.filter((d) => d.level < 3).map((d) => ({ value: d.id, label: d.name })))} />
        <button className="btn btn-primary" disabled={!name} onClick={add}>Add</button>
      </div>}>
      <DataTable rowKey={(d) => d.id} rows={ordered} columns={[
        { key: 'name', label: 'Department', render: (d) => <span style={{ paddingLeft: (d.level - 1) * 22 }}>{d.level > 1 ? '└ ' : ''}{d.name}</span> },
        { key: 'level', label: 'Level', align: 'right' }, { key: 'crop', label: 'Crop' }, { key: 'members', label: 'Members', align: 'right' },
        { key: 'a', label: '', render: (d) => (
          <span className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="btn" onClick={() => rename(d)}>Rename</button>
            <button className="btn btn-danger" onClick={() => remove(d)}>Delete</button>
          </span>) }]} />
    </Panel>
  );
}

function ErpLog() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/erp/submissions').then(setRows).catch(notifyError); }, []);
  if (!rows) return <Loading />;
  return (
    <Panel title="ERP interface log">
      <DataTable rowKey={(r) => r.id} rows={rows} columns={[
        { key: 'submitted_at', label: 'Submitted' }, { key: 'ref_type', label: 'Type' }, { key: 'ref_id', label: 'Ref' },
        { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status === 'submitted' ? 'submitted' : 'draft'} /> },
        { key: 'submitted_by_name', label: 'By' }, { key: 'cancelled_at', label: 'Cancelled' },
        { key: 'preview', label: 'Payload', render: (r) => <span className="small muted">{String(r.preview).slice(0, 80)}…</span> }]} />
    </Panel>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('users');
  const [menus, setMenus] = useState([]);
  const [deps, setDeps] = useState(null);
  const loadDeps = () => api('/admin/departments').then(setDeps).catch(notifyError);
  useEffect(() => { api('/admin/menus').then(setMenus).catch(notifyError); loadDeps(); }, []);
  if (!deps) return <Loading />;
  return (
    <div>
      <PageTitle>Authorization management</PageTitle>
      <Tabs tabs={[{ key: 'users', label: 'Users & permissions' }, { key: 'org', label: 'Organisation' }, { key: 'erp', label: 'ERP log' }]} active={tab} onChange={setTab} />
      {tab === 'users' && <Users menus={menus} deps={deps} />}
      {tab === 'org' && <Organisation deps={deps} reload={loadDeps} />}
      {tab === 'erp' && <ErpLog />}
    </div>
  );
}
