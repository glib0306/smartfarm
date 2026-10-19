// MES home: pie charts of visitors/operators and equipment, real-time farm map with equipment and people per field.
import React, { useEffect, useState } from 'react';
import { Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import FarmMap from '../components/FarmMap';
import { Loading, Panel, notifyError, SERIES } from '../components/ui';

const EQ_COLORS = { operating: '#2f9e44', idle: '#e0a100', repair: '#d64545' };

function Donut({ data, colors }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2}
          label={({ value }) => value} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={d.name} fill={colors ? colors[d.name] || SERIES[i % SERIES.length] : SERIES[i % SERIES.length]} />)}
        </Pie>
        <Tooltip />
        <Legend verticalAlign="bottom" height={30} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export default function Home() {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api('/farm/home').then((r) => alive && setD(r)).catch(notifyError);
    load();
    const t = setInterval(load, 5000); // near real-time monitoring
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!d) return <Loading />;
  const people = d.people.map((p) => ({ name: p.kind === 'visitor' ? 'Visitors' : 'Operators', value: p.n }));
  const eqStatus = d.equipment_status.map((e) => ({ name: e.status, value: e.n }));
  const eqType = d.equipment_types.map((e) => ({ name: e.type, value: e.n }));
  const totalPeople = people.reduce((a, p) => a + p.value, 0);
  return (
    <div className="grid">
      <div className="grid g3">
        <Panel title={`People on the farm today (${totalPeople})`}><Donut data={people} colors={{ Operators: SERIES[0], Visitors: SERIES[1] }} /></Panel>
        <Panel title={`Equipment by status (${d.equipment.length})`}><Donut data={eqStatus} colors={EQ_COLORS} /></Panel>
        <Panel title="Equipment by type">
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={eqType} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip />
              <Bar dataKey="value" name="Units" fill={SERIES[0]} label={{ position: 'right', fontSize: 11 }} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <Panel title="Farm monitoring (real time)" extra={<span className="small muted">Updated {new Date(d.time).toLocaleTimeString()}</span>}>
        <FarmMap fields={d.fields}
          fillFor={(f) => f.cultivar_color}
          labelFor={(f) => [f.soil_no, f.cultivar_name.replace(/ \(.*\)/, ''), `👤 ${f.workers} working${f.visitors ? ` · ${f.visitors} visitor` : ''}`]}
          legend={[{ color: '#2f9e44', label: 'Operating', shape: 'circle' }, { color: '#e0a100', label: 'Idle', shape: 'circle' },
            { color: '#d64545', label: 'Under repair', shape: 'circle' }, { color: '#2e7d32', label: 'Rice field' }, { color: '#f9a825', label: 'Wheat field' }]}>
          {d.equipment.map((e) => (
            <g key={e.id} transform={`translate(${e.x}, ${e.y})`}>
              <circle r="7" fill={EQ_COLORS[e.status]} stroke="#fff" strokeWidth="2" className={e.status === 'operating' ? 'pulse' : ''}>
                <title>{e.designation} ({e.equipment_no}) — {e.status}</title>
              </circle>
            </g>
          ))}
        </FarmMap>
      </Panel>
    </div>
  );
}
