// Production diary: daily plan and performance per farmer for third-level departments.
import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, post } from '../api';
import { DataTable, Loading, PageTitle, Panel, Warning, notify, notifyError, SERIES } from '../components/ui';

export default function Diary() {
  const [d, setD] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => api('/diary').then((r) => { setD(r); setRows(r.rows || []); }).catch(notifyError);
  useEffect(() => { load(); }, []);
  if (!d) return <Loading />;
  if (!d.approved) {
    return (<div><PageTitle>Production diary</PageTitle><Warning>{d.message}</Warning></div>);
  }
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  async function save() {
    setBusy(true);
    try { const r = await post('/diary', { rows }); notify(r.message); load(); } catch (e) { notifyError(e); } finally { setBusy(false); }
  }
  const totalPlan = rows.reduce((a, r) => a + (Number(r.plan_qty) || 0), 0);
  const totalExec = rows.reduce((a, r) => a + (Number(r.exec_qty) || 0), 0);
  return (
    <div>
      <PageTitle right={<button className="btn btn-primary" disabled={busy} onClick={save}>Save daily report</button>}>Production diary</PageTitle>
      <div className="info-box">
        {d.department} · {d.date} · approved 5-day plan “{d.plan.variant_name}” ({d.plan.period_start} .. {d.plan.period_end}),
        total {d.plan.total_planned.toFixed(2)} ha. The date is taken from the server automatically.
      </div>
      <div className="grid g2">
        <Panel title={`Daily plan and performance — ${d.date}`}>
          <DataTable rowKey={(r) => r.farmer_id} rows={rows} columns={[
            { key: 'full_name', label: 'Farmer' },
            { key: 'plan_qty', label: 'Plan (ha)', render: (r) => <input type="number" step="0.01" min="0" className="cell" value={r.plan_qty}
              onChange={(e) => set(rows.indexOf(r), 'plan_qty', e.target.value)} aria-label={'Plan of ' + r.full_name} /> },
            { key: 'exec_qty', label: 'Performance (ha)', render: (r) => <input type="number" step="0.01" min="0" className="cell" value={r.exec_qty}
              onChange={(e) => set(rows.indexOf(r), 'exec_qty', e.target.value)} aria-label={'Performance of ' + r.full_name} /> },
            { key: 'saved', label: '', render: (r) => (r.saved ? <span className="small muted">saved</span> : '') }]} />
          <div className="row small" style={{ marginTop: 8 }}>
            <b>Total</b> plan {totalPlan.toFixed(2)} ha · performance {totalExec.toFixed(2)} ha
            ({totalPlan ? Math.round(100 * totalExec / totalPlan) : 0}%)
          </div>
        </Panel>
        <Panel title="5-day plan execution">
          <DataTable rowKey={(t) => t.process} rows={d.plan.tasks} columns={[
            { key: 'process', label: 'Process' }, { key: 'planned_qty', label: 'Planned ha', align: 'right' },
            { key: 'executed_qty', label: 'Executed ha', align: 'right' }]} />
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d.history} margin={{ top: 12, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#e3e8e4" vertical={false} />
              <XAxis dataKey="report_date" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="plan_qty" name="Plan" fill={SERIES[0]} />
              <Bar dataKey="exec_qty" name="Performance" fill={SERIES[2]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}
