// Tabbed view of plan variants: calendar, labour & equipment, materials, economic efficiency, and the
// submission (annual -> ERP) or approval buttons.
import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { post } from '../api';
import PlanCalendar from './PlanCalendar';
import { DataTable, Panel, StatusPill, Tabs, fmt, notify, notifyError, SERIES } from './ui';

function laborEquipmentRows(plan) {
  const map = new Map();
  plan.resources.forEach((r) => {
    if (r.resource_type === 'material') return;
    const row = map.get(r.process) || { process: r.process, labor: 0, equipment: [] };
    if (r.resource_type === 'labor') row.labor += r.quantity;
    else row.equipment.push(r);
    map.set(r.process, row);
  });
  return Array.from(map.values());
}

function materialRows(plan) {
  const map = new Map();
  plan.resources.filter((r) => r.resource_type === 'material').forEach((r) => {
    const k = r.name + '|' + r.unit;
    const row = map.get(k) || { name: r.name, unit: r.unit, quantity: 0, cost: 0, processes: [] };
    row.quantity += r.quantity;
    row.cost += r.cost;
    if (row.processes.indexOf(r.process) < 0) row.processes.push(r.process);
    map.set(k, row);
  });
  return Array.from(map.values());
}

function LaborEquipment({ plan }) {
  const rows = laborEquipmentRows(plan);
  const labor = rows.reduce((a, r) => a + r.labor, 0);
  return (
    <>
      <DataTable rowKey={(r) => r.process} rows={rows} maxHeight={300} columns={[
        { key: 'process', label: 'Process' },
        { key: 'labor', label: 'Labour (man-day)', align: 'right', render: (r) => fmt(r.labor, 1) },
        { key: 'eq', label: 'Equipment', render: (r) => r.equipment.map((e) => e.name).join(', ') || '-' },
        { key: 'h', label: 'Machine hours', align: 'right', render: (r) => fmt(r.equipment.reduce((a, e) => a + e.quantity, 0), 1) }
      ]} />
      <div className="row small muted" style={{ marginTop: 6 }}>
        Total labour {fmt(labor, 1)} man-day · Mechanisation ratio {Math.round(plan.mech_ratio * 100)}%
      </div>
    </>
  );
}

function Materials({ plan }) {
  return (
    <DataTable rowKey={(r) => r.name + r.unit} rows={materialRows(plan)} maxHeight={300} columns={[
      { key: 'name', label: 'Material' },
      { key: 'quantity', label: 'Quantity', align: 'right', render: (r) => fmt(r.quantity, 1) },
      { key: 'unit', label: 'Unit' },
      { key: 'cost', label: 'Cost', align: 'right', render: (r) => fmt(r.cost, 0) }
    ]} />
  );
}

function Economics({ plans, current }) {
  const data = plans.map((p) => ({
    name: 'V' + p.variant_no, Labour: Math.round(p.cost_breakdown.labor), Equipment: Math.round(p.cost_breakdown.equipment),
    Materials: Math.round(p.cost_breakdown.material), Revenue: Math.round(p.expected_revenue), Efficiency: p.efficiency
  }));
  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="#e3e8e4" vertical={false} />
          <XAxis dataKey="name" />
          <YAxis yAxisId="c" tickFormatter={(v) => (v / 1000).toFixed(0) + 'k'} />
          <YAxis yAxisId="e" orientation="right" domain={[0, 'auto']} />
          <Tooltip formatter={(v, n) => (n === 'Efficiency' ? v : v.toLocaleString())} />
          <Legend />
          <Bar yAxisId="c" dataKey="Labour" stackId="c" fill={SERIES[0]} />
          <Bar yAxisId="c" dataKey="Equipment" stackId="c" fill={SERIES[1]} />
          <Bar yAxisId="c" dataKey="Materials" stackId="c" fill={SERIES[2]} />
          <Bar yAxisId="c" dataKey="Revenue" fill={SERIES[4]} />
          <Line yAxisId="e" dataKey="Efficiency" stroke={SERIES[3]} strokeWidth={2} dot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="small muted">Selected: {current.variant_name} — revenue / cost = {current.efficiency}</div>
    </div>
  );
}

function Summary({ plan }) {
  const data = [
    { name: 'Labour', v: Math.round(plan.cost_breakdown.labor) },
    { name: 'Equipment', v: Math.round(plan.cost_breakdown.equipment) },
    { name: 'Materials', v: Math.round(plan.cost_breakdown.material) }
  ];
  return (
    <div className="grid g2">
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="kpi"><span className="v">{fmt(plan.expected_yield_t, 0)} t</span><span className="l">Expected seed yield</span></div>
        <div className="kpi"><span className="v">{fmt(plan.expected_cost, 0)}</span><span className="l">Expected cost</span></div>
        <div className="kpi"><span className="v">{fmt(plan.expected_revenue, 0)}</span><span className="l">Expected revenue</span></div>
        <div className="kpi"><span className="v">{plan.efficiency}</span><span className="l">Economic efficiency</span></div>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={80} />
          <Tooltip formatter={(v) => v.toLocaleString()} />
          <Bar dataKey="v" name="Cost" fill={SERIES[0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PlanView({ data, layout, onReload }) {
  const plans = useMemo(() => data.plans || [], [data.plans]);
  const preferred = useMemo(() => {
    const a = plans.find((p) => p.status === 'approved' || p.status === 'submitted');
    return a ? a.id : plans[0] && plans[0].id;
  }, [plans]);
  const [active, setActive] = useState(preferred);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!plans.some((p) => p.id === active)) setActive(preferred); }, [plans, active, preferred]);
  const plan = plans.find((p) => p.id === active);
  if (!plan) return null;

  const isAnnual = layout === 'annual';
  const canAct = isAnnual ? data.can_submit : data.can_approve;
  async function act(path) {
    setBusy(true);
    try {
      const r = await post('/plans/' + plan.id + path);
      notify(r.message, r.message && r.message.indexOf('Warning') >= 0 ? 'warning' : 'success');
      onReload();
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  }

  let action = null;
  if (isAnnual) {
    action = plan.status === 'submitted'
      ? <button className="btn btn-danger" disabled={!canAct || busy} onClick={() => act('/cancel-submit')}>Cancel submission</button>
      : <button className="btn btn-primary" disabled={!canAct || busy} onClick={() => act('/submit')}>Submit to ERP</button>;
  } else {
    action = plan.status === 'approved'
      ? <button className="btn btn-danger" disabled={!canAct || busy} onClick={() => act('/cancel-approval')}>Cancel approval</button>
      : <button className="btn btn-primary" disabled={!canAct || busy} onClick={() => act('/approve')}>Approve</button>;
  }

  const tabs = plans.map((p) => ({ key: p.id, label: p.variant_name, badge: p.status !== 'draft' ? (p.status === 'submitted' ? 'submitted' : 'approved') : null }));
  const calendar = (
    <Panel title="Production plan (calendar)" extra={<span className="small muted">{plan.period_start} .. {plan.period_end}</span>}>
      <PlanCalendar start={plan.period_start} end={plan.period_end} tasks={plan.tasks} />
    </Panel>
  );
  const labor = <Panel title={layout === 'annual' || layout === 'monthly' ? 'Required labour and equipment' : 'Required manpower and equipment per process'}><LaborEquipment plan={plan} /></Panel>;
  const materials = <Panel title="Required materials"><Materials plan={plan} /></Panel>;

  let body;
  if (layout === 'fifteen') {
    body = (
      <div className="grid g2">
        {calendar}
        {materials}
        <div className="span2">{labor}</div>
      </div>
    );
  } else {
    body = (
      <div className="grid g2">
        {calendar}
        {materials}
        {labor}
        {layout === 'monthly'
          ? <Panel title="Economic efficiency of the variants"><Economics plans={plans} current={plan} /></Panel>
          : <Panel title="Plan summary"><Summary plan={plan} /></Panel>}
      </div>
    );
  }

  return (
    <div>
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="row small">
          <StatusPill status={plan.status} />
          {plan.status_at && <span className="muted">{plan.status} by {plan.status_by_name || '-'} at {plan.status_at}</span>}
          <span className="muted">Department: {plan.department_name}</span>
          <span className="muted">Mechanisation {Math.round(plan.mech_ratio * 100)}% · cost {fmt(plan.expected_cost, 0)} · efficiency {plan.efficiency}</span>
        </div>
        <div className="row">
          {!canAct && <span className="small muted">{isAnnual ? 'Submission' : 'Approval'} requires higher authority</span>}
          {action}
        </div>
      </div>
      {body}
    </div>
  );
}
