// Irrigation system: canals and pumps on the farm map with live pump operation.
import React, { useEffect, useState } from 'react';
import { api, post } from '../api';
import FarmMap from '../components/FarmMap';
import { DataTable, Loading, PageTitle, Panel, StatusPill, notify, notifyError } from '../components/ui';

const PUMP_COLORS = { running: '#2f9e44', stopped: '#8a9a8f', fault: '#d64545' };

function moistureColor(f) {
  if (f.crop === 'rice') {
    const wl = f.water_level_cm || 0;
    return wl < 3 ? '#b9dcf2' : wl < 6 ? '#7fbde6' : '#4a9bd6';
  }
  const m = f.moisture_pct || 0;
  return m < 28 ? '#e8d9a8' : m < 35 ? '#cfe3a6' : '#9fcf8a';
}

export default function Irrigation() {
  const [d, setD] = useState(null);
  const load = () => api('/farm/irrigation').then(setD).catch(notifyError);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  if (!d) return <Loading />;
  const running = {};
  d.pumps.forEach((p) => { running[p.id] = p.status === 'running'; });
  async function toggle(p) {
    try { await post('/farm/irrigation/pumps/' + p.id + '/toggle'); notify(p.name + (p.status === 'running' ? ' stopped' : ' started')); load(); } catch (e) { notifyError(e); }
  }
  return (
    <div>
      <PageTitle right={<span className="small muted">{d.summary.running} pumps running · {d.summary.total_flow_m3h} m³/h · {d.summary.power_kw} kW</span>}>
        Irrigation system
      </PageTitle>
      <div className="grid g-side-r">
        <Panel title="Irrigation network">
          <FarmMap fields={d.fields} fillFor={moistureColor}
            labelFor={(f) => [f.soil_no, f.crop === 'rice' ? `water ${f.water_level_cm ?? '-'} cm` : `moisture ${f.moisture_pct ?? '-'} %`]}
            legend={[{ color: '#4a9bd6', label: 'Canal (flowing)' }, { color: '#9fb3c1', label: 'Canal (no flow)' }, { color: '#8a6d4f', label: 'Drain' },
              { color: PUMP_COLORS.running, label: 'Pump running', shape: 'circle' }, { color: PUMP_COLORS.stopped, label: 'Pump stopped', shape: 'circle' },
              { color: PUMP_COLORS.fault, label: 'Pump fault', shape: 'circle' }]}>
            {d.canals.map((c) => {
              const pts = c.points.split(';').map((p) => p.split(',').join(' ')).join(' L ');
              const flowing = c.pump_id ? running[c.pump_id] : false;
              const stroke = c.canal_type === 'drain' ? '#8a6d4f' : flowing ? '#4a9bd6' : '#9fb3c1';
              return (
                <path key={c.id} d={'M ' + pts} fill="none" stroke={stroke} strokeWidth={c.canal_type === 'main' ? 8 : c.canal_type === 'drain' ? 5 : 3}
                  className={flowing ? 'flow' : ''} opacity={c.canal_type === 'branch' ? 0.8 : 1}>
                  <title>{c.name} ({c.capacity_m3h} m³/h)</title>
                </path>
              );
            })}
            {d.pumps.map((p) => (
              <g key={p.id} transform={`translate(${p.x}, ${p.y})`} onClick={() => toggle(p)} style={{ cursor: 'pointer' }}>
                <circle r="13" fill={PUMP_COLORS[p.status]} stroke="#fff" strokeWidth="3" className={p.status === 'fault' ? 'pulse' : ''} />
                {p.status === 'running' && (
                  <g>
                    <path d="M0 -8 L3 0 L0 8 L-3 0 Z" fill="#fff">
                      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1.2s" repeatCount="indefinite" />
                    </path>
                  </g>
                )}
                <title>{p.name} — {p.status} (click to start / stop)</title>
                <text x="18" y="4" className="lbl">{p.name.split(' (')[0]}</text>
              </g>
            ))}
          </FarmMap>
        </Panel>
        <Panel title="Pumps">
          <DataTable rowKey={(r) => r.id} rows={d.pumps} columns={[
            { key: 'name', label: 'Pump' }, { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'flow_m3h', label: 'Flow m³/h', align: 'right' }, { key: 'power_kw', label: 'kW', align: 'right' },
            { key: 'a', label: '', render: (r) => (
              <button className="btn" disabled={r.status === 'fault'} onClick={() => toggle(r)}>{r.status === 'running' ? 'Stop' : 'Start'}</button>) }]} />
        </Panel>
      </div>
    </div>
  );
}
