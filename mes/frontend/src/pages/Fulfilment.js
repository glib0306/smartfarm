// Fulfilment of plan: farm-scale performance gauge, % per department, plan vs result per department (5-day / 15-day / monthly).
import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { Loading, PageTitle, Panel, Select, Tabs, notifyError, SERIES } from '../components/ui';

function Gauge({ pct, label }) {
  const v = Math.max(0, Math.min(120, pct));
  const angle = Math.PI * (v / 120);
  const r = 90;
  const x = 110 - r * Math.cos(angle);
  const y = 110 - r * Math.sin(angle);
  const color = pct >= 95 ? '#2f9e44' : pct >= 80 ? '#e0a100' : '#d64545';
  return (
    <svg viewBox="0 0 220 130" width="100%" style={{ maxWidth: 380 }} role="img" aria-label={`${label} ${pct}%`}>
      <path d="M20 110 A90 90 0 0 1 200 110" fill="none" stroke="#e3e8e4" strokeWidth="18" />
      <path d={`M20 110 A90 90 0 0 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth="18" />
      <line x1="110" y1="110" x2={110 + 90 * Math.cos(Math.PI * (1 - 100 / 120))} y2={110 - 90 * Math.sin(Math.PI * (1 - 100 / 120))} stroke="#1d2a22" strokeDasharray="3 3" />
      <text x="110" y="95" textAnchor="middle" style={{ fontSize: 30, fontWeight: 600 }}>{pct}%</text>
      <text x="110" y="124" textAnchor="middle" style={{ fontSize: 11 }} fill="#4c5d52">{label}</text>
    </svg>
  );
}

function PlanVsResult({ block }) {
  if (!block) return <div className="muted">No approved plan for this department in the selected period.</div>;
  return (
    <div>
      <div className="small muted">{block.period[0]} .. {block.period[1]}</div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={block.rows} margin={{ top: 10, right: 10, left: 0, bottom: 60 }}>
          <CartesianGrid stroke="#e3e8e4" vertical={false} />
          <XAxis dataKey="process" interval={0} angle={-25} textAnchor="end" height={70} tick={{ fontSize: 11 }} />
          <YAxis unit=" ha" />
          <Tooltip />
          <Legend verticalAlign="top" />
          <Bar dataKey="planned" name="Plan" fill={SERIES[0]} />
          <Bar dataKey="executed" name="Result" fill={SERIES[2]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Fulfilment() {
  const [sum, setSum] = useState(null);
  const [deps, setDeps] = useState([]);
  const [dep, setDep] = useState('5');
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('five');
  useEffect(() => {
    api('/fulfilment/summary').then(setSum).catch(notifyError);
    api('/fulfilment/departments').then(setDeps).catch(notifyError);
  }, []);
  useEffect(() => { setDetail(null); api('/fulfilment/department/' + dep).then(setDetail).catch(notifyError); }, [dep]);
  if (!sum) return <Loading />;
  return (
    <div>
      <PageTitle>Fulfilment of plan</PageTitle>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <div className="grid">
        <Panel title="Plan execution by department (%)">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={sum.departments} layout="vertical" margin={{ left: 40, right: 20 }}>
              <CartesianGrid stroke="#e3e8e4" horizontal={false} />
              <XAxis type="number" unit="%" domain={[0, (max) => Math.max(110, Math.ceil(max / 10) * 10)]} />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => v + '%'} />
              <Bar dataKey="pct" name="Execution">
                {sum.departments.map((d) => <Cell key={d.id} fill={d.pct >= 95 ? '#2f9e44' : d.pct >= 80 ? '#e0a100' : '#d64545'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Plan and result by department"
          extra={<Select label="Department" value={dep} onChange={setDep} options={deps.map((d) => ({ value: d.id, label: d.name }))} />}>
          <Tabs tabs={[{ key: 'five', label: '5-day plan' }, { key: 'fifteen', label: '15-day plan' }, { key: 'monthly', label: 'Monthly plan' }]}
            active={tab} onChange={setTab} small />
          {detail ? <PlanVsResult block={detail[tab]} /> : <Loading />}
        </Panel>
        </div>
        <Panel title="Farm-scale production performance" extra={<span className="small muted">{sum.month[0]} .. {sum.date}</span>}>
          <div className="grid" style={{ justifyItems: 'center' }}>
            <Gauge pct={sum.farm.pct} label="Executed vs planned to date" />
            <Gauge pct={sum.farm.month_pct} label="Progress of monthly plan" />
          </div>
          <div className="small muted">Executed {sum.farm.executed} ha of {sum.farm.planned_to_date} ha due to date;
            monthly plan {sum.farm.month_planned} ha ({sum.farm.monthly_plan || 'no approved monthly plan'}).</div>
        </Panel>
      </div>
    </div>
  );
}
