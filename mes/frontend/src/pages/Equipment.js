// Equipment management: non-editable equipment table and equipment positions on the farm map.
import React, { useEffect, useState } from 'react';
import { api } from '../api';
import FarmMap from '../components/FarmMap';
import { DataTable, Loading, PageTitle, Panel, StatusPill, notifyError } from '../components/ui';

const EQ_COLORS = { operating: '#2f9e44', idle: '#e0a100', repair: '#d64545' };

export default function Equipment() {
  const [d, setD] = useState(null);
  const [sel, setSel] = useState(null);
  useEffect(() => { api('/farm/equipment').then(setD).catch(notifyError); }, []);
  if (!d) return <Loading />;
  return (
    <div>
      <PageTitle>Equipment management</PageTitle>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.25fr)' }}>
        <Panel title={`Equipment (${d.equipment.length})`}>
          <DataTable maxHeight={640} rowKey={(r) => r.id} rows={d.equipment} onRowClick={(r) => setSel(r.id)} selectedKey={sel} columns={[
            { key: 'designation', label: 'Designation' }, { key: 'equipment_no', label: 'No.' },
            { key: 'status', label: 'Operating status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'range_desc', label: 'Range' }, { key: 'reason', label: 'Reason for not operating' }]} />
        </Panel>
        <Panel title="Equipment location">
          <FarmMap fields={d.fields} fillFor={() => '#cfe3c6'} labelFor={(f) => [f.soil_no]}
            legend={[{ color: EQ_COLORS.operating, label: 'Operating', shape: 'circle' }, { color: EQ_COLORS.idle, label: 'Idle', shape: 'circle' },
              { color: EQ_COLORS.repair, label: 'Under repair', shape: 'circle' }]}>
            {d.equipment.map((e) => (
              <g key={e.id} transform={`translate(${e.x}, ${e.y})`} onClick={() => setSel(e.id)} style={{ cursor: 'pointer' }}>
                <circle r={sel === e.id ? 11 : 7} fill={EQ_COLORS[e.status]} stroke={sel === e.id ? '#13311e' : '#fff'} strokeWidth="2">
                  <title>{e.designation} ({e.equipment_no}) — {e.status}</title>
                </circle>
                {sel === e.id && <text x="14" y="4" className="lbl">{e.designation}</text>}
              </g>
            ))}
          </FarmMap>
        </Panel>
      </div>
    </div>
  );
}
