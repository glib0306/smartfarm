// Power management: consumption status (monthly / 10-day / weekly tabs) and power system status diagram.
import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { DataTable, Loading, PageTitle, Panel, Select, StatusPill, Tabs, color, notifyError } from '../components/ui';

function ConsumptionChart({ data }) {
  if (!data) return <Loading />;
  return (
    <ResponsiveContainer width="100%" height={420}>
      <BarChart data={data.rows} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <CartesianGrid stroke="#e3e8e4" vertical={false} />
        <XAxis dataKey="label" />
        <YAxis tickFormatter={(v) => (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} unit=" kWh" width={80} />
        <Tooltip formatter={(v) => v.toLocaleString() + ' kWh'} />
        <Legend />
        {data.series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={color(i)} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PowerConsumption() {
  const [tab, setTab] = useState('monthly');
  const [opts, setOpts] = useState(null);
  const [dept, setDept] = useState('all');
  const [stations, setStations] = useState([]);
  const [data, setData] = useState(null);
  useEffect(() => { api('/power/options').then(setOpts).catch(notifyError); }, []);
  useEffect(() => {
    setData(null);
    const q = tab === 'tenday' ? 'stations=' + (stations.length ? stations.join(',') : 'all') : 'department_id=' + dept;
    api(`/power/consumption?mode=${tab}&${q}`).then(setData).catch(notifyError);
  }, [tab, dept, stations]);
  if (!opts) return <Loading />;
  const deptSel = <Select label="Department" value={dept} onChange={setDept}
    options={[{ value: 'all', label: 'All' }].concat(opts.departments.map((d) => ({ value: d.id, label: d.name })))} />;
  return (
    <div>
      <PageTitle>Power consumption status</PageTitle>
      <Panel>
        <Tabs tabs={[{ key: 'monthly', label: 'Monthly' }, { key: 'tenday', label: '10-day' }, { key: 'weekly', label: 'Weekly' }]} active={tab} onChange={setTab} />
        <div className="row" style={{ marginBottom: 8 }}>
          {tab === 'tenday' ? (
            <div className="row">
              <span className="small muted">Stations:</span>
              <label className="field-inline"><input type="checkbox" checked={!stations.length} onChange={() => setStations([])} /> All</label>
              {opts.stations.map((s) => (
                <label key={s.id} className="field-inline">
                  <input type="checkbox" checked={stations.indexOf(s.id) >= 0}
                    onChange={(e) => setStations(e.target.checked ? stations.concat(s.id) : stations.filter((x) => x !== s.id))} />
                  {s.name}
                </label>
              ))}
            </div>
          ) : deptSel}
        </div>
        <ConsumptionChart data={data} />
      </Panel>
    </div>
  );
}

const TYPE_ICON = { substation: '⚡', transformer: '🔌', pump: '💧', building: '🏢', dryer: '🏭' };

export function PowerSystem() {
  const [d, setD] = useState(null);
  const [sel, setSel] = useState(null);
  useEffect(() => {
    const load = () => api('/power/system').then(setD).catch(notifyError);
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (!d) return <Loading />;
  const byId = {};
  d.stations.forEach((s) => { byId[s.id] = s; });
  const s = sel && byId[sel];
  return (
    <div>
      <PageTitle right={<span className="small muted">Load {Math.round(d.totals.load_kw)} / {Math.round(d.totals.capacity_kw)} kW · faults {d.totals.faults}</span>}>
        Power system status
      </PageTitle>
      <div className="grid g-side-r">
        <Panel title="Power system diagram">
          <svg viewBox="0 0 1100 700" className="farm-map" role="img" aria-label="Power system diagram">
            <rect x="40" y="40" width="460" height="560" rx="10" fill="#dfeedd" />
            <rect x="560" y="40" width="440" height="560" rx="10" fill="#f4ecd4" />
            <text x="60" y="64" className="sub">Rice block</text>
            <text x="580" y="64" className="sub">Wheat block</text>
            {d.lines.map((l) => {
              const a = byId[l.from_station];
              const b = byId[l.to_station];
              const ok = l.status === 'normal';
              return (
                <g key={l.id}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ok ? '#2f9e44' : '#d64545'} strokeWidth={l.voltage_kv > 1 ? 5 : 3}
                    className={ok ? 'flow' : 'pulse'} />
                  <text x={(a.x + b.x) / 2 + 6} y={(a.y + b.y) / 2 - 6} className="sub">{l.voltage_kv} kV</text>
                </g>
              );
            })}
            {d.stations.map((st) => {
              const ok = st.status === 'normal';
              return (
                <g key={st.id} transform={`translate(${st.x}, ${st.y})`} onClick={() => setSel(st.id)} style={{ cursor: 'pointer' }}>
                  <rect x="-26" y="-20" width="52" height="40" rx="8" fill={ok ? '#2f9e44' : '#d64545'} stroke={sel === st.id ? '#13311e' : '#fff'} strokeWidth="3"
                    className={ok ? '' : 'pulse'} />
                  <text y="7" textAnchor="middle" style={{ fontSize: 18 }}>{TYPE_ICON[st.type] || '•'}</text>
                  <text y="36" textAnchor="middle" className="sub">{st.name.length > 24 ? st.name.slice(0, 24) + '…' : st.name}</text>
                </g>
              );
            })}
            <g transform="translate(20, 640)">
              <rect width="280" height="40" rx="6" fill="#fff" stroke="#c9d3cb" />
              <rect x="12" y="13" width="14" height="14" rx="3" fill="#2f9e44" /><text x="32" y="25" style={{ fontSize: 12 }}>Normal</text>
              <rect x="110" y="13" width="14" height="14" rx="3" fill="#d64545" /><text x="130" y="25" style={{ fontSize: 12 }}>Abnormal / fault</text>
            </g>
          </svg>
        </Panel>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Station details">
            {s ? (
              <div className="grid" style={{ gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
                <span className="muted">Name</span><span>{s.name}</span>
                <span className="muted">Type</span><span>{s.type}</span>
                <span className="muted">Department</span><span>{s.department_name}</span>
                <span className="muted">Status</span><span><StatusPill status={s.status} /></span>
                <span className="muted">Load / capacity</span><span>{s.load_kw} / {s.capacity_kw} kW ({s.utilisation}%)</span>
                <span className="muted">Energy today</span><span>{s.kwh_today} kWh</span>
              </div>
            ) : <span className="small muted">Click a node in the diagram.</span>}
          </Panel>
          <Panel title="Distribution analysis (load transfer proposals)">
            <DataTable rows={d.proposals} empty="No transfers needed" columns={[
              { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'kw', label: 'kW', align: 'right' }, { key: 'reason', label: 'Reason' }]} />
          </Panel>
          <Panel title="Utilisation">
            <DataTable rows={d.stations} rowKey={(r) => r.id} onRowClick={(r) => setSel(r.id)} selectedKey={sel} columns={[
              { key: 'name', label: 'Station' }, { key: 'utilisation', label: 'Load %', align: 'right' },
              { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> }]} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
