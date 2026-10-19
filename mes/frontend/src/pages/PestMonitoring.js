// Insect (pest) monitoring: editable pest history, cultivation technical measures reported to ERP,
// damage spread prediction and pest / disease map.
import React, { useEffect, useState } from 'react';
import { Area, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart } from 'recharts';
import { api, del, post, put } from '../api';
import FarmMap, { STATUS_COLORS } from '../components/FarmMap';
import { DataTable, Loading, Modal, PageTitle, Panel, StatusPill, notify, notifyError, color } from '../components/ui';

function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function ResourceTables({ s }) {
  const cols = [{ key: 'name', label: 'Item' }, { key: 'quantity', label: 'Quantity', align: 'right' }, { key: 'unit', label: 'Unit' }];
  return (
    <div className="grid g3">
      <div><h4>Labour</h4><DataTable rows={s.labor} columns={cols} /></div>
      <div><h4>Equipment</h4><DataTable rows={s.equipment} columns={cols} /></div>
      <div><h4>Materials</h4><DataTable rows={s.materials} columns={cols} /></div>
    </div>
  );
}

function PestHistory({ rows, catalog, fields, onChanged }) {
  const [edit, setEdit] = useState({});
  const [adding, setAdding] = useState(null);
  const setCell = (id, k, v) => setEdit({ ...edit, [id]: { ...(edit[id] || {}), [k]: v } });
  const val = (r, k) => (edit[r.id] && edit[r.id][k] !== undefined ? edit[r.id][k] : r[k]);
  async function save(r) {
    try {
      const res = await put('/quality/pests/' + r.id, edit[r.id] || {});
      notify(res.message, res.applied ? 'success' : 'warning');
      setEdit({ ...edit, [r.id]: undefined });
      onChanged();
    } catch (e) { notifyError(e); }
  }
  async function remove(r) {
    try { await del('/quality/pests/' + r.id); notify('Record deleted'); onChanged(); } catch (e) { notifyError(e); }
  }
  async function add() {
    try {
      const c = catalog.find((x) => x.name === adding.pest_name);
      await post('/quality/pests', { ...adding, image_url: adding.image_url || (c ? '/images/pests/' + c.name.toLowerCase().replace(/ /g, '_') + '.svg' : '') });
      notify('Pest record added');
      setAdding(null);
      onChanged();
    } catch (e) { notifyError(e); }
  }
  const pestOpts = (fieldId) => {
    const f = fields.find((x) => String(x.id) === String(fieldId));
    return catalog.filter((c) => !f || c.crop === f.crop);
  };
  return (
    <>
      <DataTable maxHeight={330} rowKey={(r) => r.id} rows={rows} columns={[
        { key: 'soil_no', label: 'Field no.' },
        { key: 'pest_name', label: 'Pest name', render: (r) => (
          <select value={val(r, 'pest_name')} onChange={(e) => setCell(r.id, 'pest_name', e.target.value)}>
            {pestOpts(r.field_id).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>) },
        { key: 'occurred_on', label: 'Date', render: (r) => <input type="date" value={String(val(r, 'occurred_on')).slice(0, 10)} onChange={(e) => setCell(r.id, 'occurred_on', e.target.value)} /> },
        { key: 'location_desc', label: 'Location', render: (r) => <input type="text" className="cell" value={val(r, 'location_desc') || ''} onChange={(e) => setCell(r.id, 'location_desc', e.target.value)} /> },
        { key: 'image_url', label: 'Image', render: (r) => (r.image_url ? <img src={r.image_url} alt={r.pest_name} width="28" height="28" /> : '-') },
        { key: 'individuals', label: 'Individuals', render: (r) => <input type="number" className="cell" value={val(r, 'individuals')} onChange={(e) => setCell(r.id, 'individuals', e.target.value)} /> },
        { key: 'damaged_area_m2', label: 'Damaged m²', render: (r) => <input type="number" className="cell" value={val(r, 'damaged_area_m2')} onChange={(e) => setCell(r.id, 'damaged_area_m2', e.target.value)} /> },
        { key: 'a', label: '', render: (r) => (
          <span className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="btn" disabled={!edit[r.id]} onClick={() => save(r)} title={Number(r.editable_today) ? 'Save' : 'Earlier date: requires joint ratification'}>
              {Number(r.editable_today) ? 'Save' : 'Request edit'}</button>
            {Number(r.editable_today) ? <button className="btn btn-danger" onClick={() => remove(r)}>Delete</button> : null}
          </span>) }
      ]} />
      {adding ? (
        <div className="row" style={{ marginTop: 8 }}>
          <select value={adding.field_id} onChange={(e) => setAdding({ ...adding, field_id: e.target.value, pest_name: '' })}>
            <option value="">Field…</option>{fields.map((f) => <option key={f.id} value={f.id}>{f.soil_no} ({f.crop})</option>)}
          </select>
          <select value={adding.pest_name} onChange={(e) => setAdding({ ...adding, pest_name: e.target.value })}>
            <option value="">Pest…</option>{pestOpts(adding.field_id).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          <input type="date" value={adding.occurred_on} onChange={(e) => setAdding({ ...adding, occurred_on: e.target.value })} />
          <input type="text" placeholder="Location" className="cell" value={adding.location_desc} onChange={(e) => setAdding({ ...adding, location_desc: e.target.value })} />
          <input type="number" placeholder="Individuals" className="cell" value={adding.individuals} onChange={(e) => setAdding({ ...adding, individuals: e.target.value })} />
          <input type="number" placeholder="Damaged m²" className="cell" value={adding.damaged_area_m2} onChange={(e) => setAdding({ ...adding, damaged_area_m2: e.target.value })} />
          <button className="btn btn-primary" disabled={!adding.field_id || !adding.pest_name} onClick={add}>Add</button>
          <button className="btn" onClick={() => setAdding(null)}>Cancel</button>
        </div>
      ) : (
        <button className="btn" style={{ marginTop: 8 }} onClick={() => setAdding({ field_id: '', pest_name: '', occurred_on: today(), location_desc: '', individuals: '', damaged_area_m2: '' })}>
          + Add record</button>
      )}
      <div className="small muted" style={{ marginTop: 4 }}>Only records stored today are edited directly; older records need joint ratification by the person who entered them and a manager.</div>
    </>
  );
}

export default function PestMonitoring() {
  const [data, setData] = useState(null);
  const [map, setMap] = useState(null);
  const [fields, setFields] = useState([]);
  const [pred, setPred] = useState(null);
  const [measures, setMeasures] = useState(null);
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => {
    api('/quality/pests').then(setData).catch(notifyError);
    api('/quality/pest-map').then(setMap).catch(notifyError);
  };
  useEffect(() => { load(); api('/farm/fields').then(setFields).catch(notifyError); }, []);

  async function prepare() {
    setBusy(true);
    try {
      const existing = await api('/quality/measures');
      setMeasures(existing.submitted ? existing : await post('/quality/measures/prepare'));
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  }
  async function submit(cancel) {
    try {
      const r = await post(cancel ? '/quality/measures/cancel' : '/quality/measures/submit');
      notify(r.message);
      setMeasures(await api('/quality/measures'));
    } catch (e) { notifyError(e); }
  }
  async function predict() {
    setBusy(true);
    try { setPred(await post('/quality/pests/predict', { days: 21 })); } catch (e) { notifyError(e); } finally { setBusy(false); }
  }

  if (!data || !map) return <Loading />;
  const f = map.find((x) => x.id === sel);
  const chartData = pred ? pred.daily : Array.from({ length: 21 }, (_, i) => ({ day: i + 1 }));
  return (
    <div>
      <PageTitle right={
        <div className="row">
          <button className="btn btn-primary" disabled={busy} onClick={prepare}>Establish cultivation technical measures</button>
          <button className="btn" disabled={busy} onClick={predict}>Damage prediction</button>
        </div>}>Insect monitoring</PageTitle>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.45fr) minmax(0, 1fr)' }}>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Pest History">
            <PestHistory rows={data.rows} catalog={data.catalog} fields={fields} onChanged={load} />
          </Panel>
          <Panel title="Predicted spread of damage (21 days)">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#e3e8e4" />
                <XAxis dataKey="day" label={{ value: 'day', position: 'insideBottomRight', offset: -2, fontSize: 11 }} />
                <YAxis yAxisId="a" />
                <YAxis yAxisId="b" orientation="right" unit=" ha" />
                <Tooltip />
                <Legend />
                <Area yAxisId="a" dataKey="disease_fields" name="Fields with disease" stackId="1" fill="#d64545" stroke="#d64545" fillOpacity={0.35} />
                <Area yAxisId="a" dataKey="pest_fields" name="Fields with pests" stackId="1" fill="#f2c230" stroke="#c9a227" fillOpacity={0.45} />
                <Line yAxisId="b" dataKey="damaged_area_ha" name="Damaged area" stroke={color(4)} dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
            {!pred && <div className="small muted">Press “Damage prediction” to simulate the spread.</div>}
          </Panel>
        </div>
        <Panel title="Pest and disease map">
          <FarmMap fields={map} selectedId={sel} onFieldClick={(x) => setSel(x.id)}
            fillFor={(x) => STATUS_COLORS[x.state]}
            labelFor={(x) => [x.soil_no].concat(x.pests.slice(0, 2).map((p) => p.pest_name))}
            legend={[{ color: STATUS_COLORS.normal, label: 'Normal' }, { color: STATUS_COLORS.disease, label: 'Disease' }, { color: STATUS_COLORS.pest, label: 'Pests' }]} />
          {f ? (f.pests.length ? (
            <DataTable rows={f.pests} rowKey={(p) => p.id} columns={[
              { key: 'pest_name', label: `${f.soil_no} · pest name` },
              { key: 'category', label: 'Type', render: (p) => <StatusPill status={p.category === 'disease' ? 'fault' : 'idle'} /> },
              { key: 'image_url', label: 'Damage image', render: (p) => (p.image_url ? <img src={p.image_url} alt={p.pest_name} width="56" height="56" /> : '-') },
              { key: 'individuals', label: 'Individuals', align: 'right' },
              { key: 'damaged_area_m2', label: 'Damaged area m²', align: 'right' },
              { key: 'occurred_on', label: 'Date' }]} />
          ) : <div className="small muted">{f.soil_no}: no pests or diseases in the last 30 days.</div>)
            : <div className="small muted">Click a field to see pest name, damage image, individuals and damaged area.</div>}
        </Panel>
      </div>
      {measures && (
        <Modal wide title="Cultivation technical measures" onClose={() => setMeasures(null)} footer={
          <>
            {measures.submitted
              ? <button className="btn btn-danger" onClick={() => submit(true)}>Cancel submission</button>
              : <button className="btn btn-primary" onClick={() => submit(false)}>Submit to ERP</button>}
            <button className="btn" onClick={() => setMeasures(null)}>Close</button>
          </>}>
          {measures.submitted && <div className="info-box">Submitted to ERP.</div>}
          <DataTable maxHeight={260} rowKey={(m) => m.id} rows={measures.measures} columns={[
            { key: 'measure', label: 'Measure' }, { key: 'labor_md', label: 'Labour md', align: 'right' },
            { key: 'equipment', label: 'Equipment' }, { key: 'equipment_h', label: 'h', align: 'right' },
            { key: 'material', label: 'Material' }, { key: 'material_qty', label: 'Qty', align: 'right' }, { key: 'material_unit', label: 'Unit' }]} />
          <div style={{ height: 12 }} />
          <ResourceTables s={measures} />
        </Modal>
      )}
    </div>
  );
}
