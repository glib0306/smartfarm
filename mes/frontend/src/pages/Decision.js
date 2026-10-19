// Decision support: BP neural network yield prediction, PLS soil fertility & water holding analysis,
// LP resource redistribution, and providing the optimised solutions to ERP.
import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, post } from '../api';
import FarmMap from '../components/FarmMap';
import { DataTable, Loading, PageTitle, Panel, Select, Tabs, notify, notifyError, SERIES } from '../components/ui';

async function toErp(kind, data) {
  try { const r = await post('/decision/submit', { kind, data }); notify(r.message); } catch (e) { notifyError(e); }
}

function yieldColor(v) {
  const t = Math.max(0, Math.min(1, (v - 3.5) / 5));
  const r = Math.round(230 - t * 180);
  const g = Math.round(200 - t * 40);
  const b = Math.round(120 - t * 60);
  return `rgb(${r},${g},${b})`;
}

function YieldTab({ fields }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = (retrain) => { setBusy(true); api('/decision/yield' + (retrain ? '?retrain=1' : '')).then(setD).catch(notifyError).finally(() => setBusy(false)); };
  useEffect(() => { load(false); }, []);
  if (!d) return <Loading text="Training BP neural network..." />;
  const pred = {};
  d.predictions.forEach((p) => { pred[p.field_id] = p.yield_t_ha; });
  return (
    <div className="grid g2">
      <Panel title="Predicted seed yield by field (t/ha)" extra={
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => load(true)}>Re-train (self-learning)</button>
          <button className="btn btn-primary" onClick={() => toErp('yield_prediction', { totals: d.totals, fields: d.predictions })}>Provide to ERP</button>
        </div>}>
        <FarmMap fields={fields} fillFor={(f) => yieldColor(pred[f.id] || 0)} labelFor={(f) => [f.soil_no, (pred[f.id] || 0).toFixed(2) + ' t/ha']}
          legend={[{ color: yieldColor(4), label: '≈ 4 t/ha' }, { color: yieldColor(6), label: '≈ 6 t/ha' }, { color: yieldColor(8), label: '≈ 8 t/ha' }]} />
      </Panel>
      <div className="grid" style={{ alignContent: 'start' }}>
        <Panel title="Model">
          <div className="grid g3">
            <div className="kpi"><span className="v">{d.rmse}</span><span className="l">RMSE t/ha (training)</span></div>
            <div className="kpi"><span className="v">{d.samples}</span><span className="l">Training samples</span></div>
            {d.totals.map((t) => <div key={t.crop} className="kpi"><span className="v">{t.tonnes} t</span><span className="l">Expected {t.crop} seed</span></div>)}
          </div>
          <div className="small muted">BP neural network (7-8-1) · trained {String(d.trained_at).slice(0, 19)} {d.retrained ? '(just now)' : '(stored model)'}</div>
          {d.loss && d.loss.length > 0 && (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={d.loss}><CartesianGrid stroke="#e3e8e4" /><XAxis dataKey="epoch" /><YAxis /><Tooltip />
                <Line dataKey="mse" name="Training MSE" stroke={SERIES[0]} dot={false} /></LineChart>
            </ResponsiveContainer>
          )}
        </Panel>
        <Panel title="Predictions">
          <DataTable maxHeight={300} rowKey={(r) => r.field_id} rows={d.predictions} columns={[
            { key: 'soil_no', label: 'Soil no.' }, { key: 'crop', label: 'Crop' }, { key: 'area_ha', label: 'ha', align: 'right' },
            { key: 'yield_t_ha', label: 't/ha', align: 'right' }]} />
        </Panel>
      </div>
    </div>
  );
}

function FertilityTab() {
  const [d, setD] = useState(null);
  useEffect(() => { api('/decision/fertility').then(setD).catch(notifyError); }, []);
  if (!d) return <Loading text="Running PLS regression..." />;
  const vip = d.variables.map((v, i) => ({ name: v.replace(/_/g, ' '), VIP: d.vip[i], coef: d.coefficients[i] }));
  return (
    <div className="grid g2">
      <div className="grid" style={{ alignContent: 'start' }}>
        <Panel title="Partial least squares: what drives yield (VIP)" extra={
          <button className="btn btn-primary" onClick={() => toErp('soil_fertility', { grades: d.grades, fields: d.fields })}>Provide to ERP</button>}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={vip} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid stroke="#e3e8e4" horizontal={false} /><XAxis type="number" /><YAxis type="category" dataKey="name" width={150} />
              <Tooltip /><Bar dataKey="VIP" fill={SERIES[0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="small muted">PLS RMSE {d.rmse} · reference evapotranspiration {d.et0} mm/day</div>
        </Panel>
        <Panel title="Land grades">
          <DataTable rowKey={(g) => g.grade} rows={d.grades} columns={[
            { key: 'grade', label: 'Grade' }, { key: 'fields', label: 'Fields', align: 'right' },
            { key: 'whc', label: 'Water holding mm/m', align: 'right' }, { key: 'organic_matter', label: 'Organic matter %', align: 'right' },
            { key: 'yield_index', label: 'Yield index', align: 'right' }]} />
        </Panel>
      </div>
      <Panel title="Water holding capacity and soil fertility measures (lowest fertility first)">
        <DataTable maxHeight={620} rowKey={(r) => r.field_id} rows={d.fields} columns={[
          { key: 'soil_no', label: 'Soil no.' }, { key: 'grade', label: 'Grade', align: 'right' },
          { key: 'fertility_index', label: 'Fertility idx', align: 'right' }, { key: 'taw_mm', label: 'Avail. water mm', align: 'right' },
          { key: 'irrigation_interval_days', label: 'Irrig. interval d', align: 'right' },
          { key: 'recommendations', label: 'Measures', render: (r) => <span style={{ whiteSpace: 'normal' }}>{r.recommendations.join('; ')}</span> }]} />
      </Panel>
    </div>
  );
}

function AllocationTab() {
  const [res, setRes] = useState('labor');
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); api('/decision/allocation?resource=' + res).then(setD).catch(notifyError); }, [res]);
  return (
    <Panel title="Resource redistribution (linear programming)" extra={
      <div className="row">
        <Select label="Resource" value={res} onChange={setRes} options={[{ value: 'labor', label: 'Manpower' }, { value: 'equipment', label: 'Equipment' }, { value: 'water', label: 'Water' }]} />
        {d && <button className="btn btn-primary" onClick={() => toErp('allocation_' + res, d)}>Provide to ERP</button>}
      </div>}>
      {!d ? <Loading /> : (
        <div className="grid g2">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={d.balance} margin={{ top: 10 }}>
              <CartesianGrid stroke="#e3e8e4" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis unit={' ' + d.unit} width={90} />
              <Tooltip /><Legend />
              <Bar dataKey="available" name="Available" fill={SERIES[0]} />
              <Bar dataKey="required" name="Required (current 5-day plan)" fill={SERIES[1]} />
              <Bar dataKey="after" name="After redistribution" fill={SERIES[2]} />
            </BarChart>
          </ResponsiveContainer>
          <div>
            <h4>Optimal transfers</h4>
            <DataTable rows={d.transfers} empty="No surplus can cover a deficit — balance is already optimal or resources are short overall." columns={[
              { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'quantity', label: 'Quantity (' + d.unit + ')', align: 'right' }]} />
            {d.balance.some((b) => b.after < b.required) && (
              <div className="warning-box" style={{ marginTop: 10 }}>
                Remaining shortage: {d.balance.filter((b) => b.after < b.required).map((b) => `${b.name} ${Math.round(b.required - b.after)} ${d.unit}`).join(', ')}.
                Request additional resources from ERP.
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

export default function Decision() {
  const [tab, setTab] = useState('yield');
  const [fields, setFields] = useState([]);
  useEffect(() => { api('/farm/fields').then(setFields).catch(notifyError); }, []);
  return (
    <div>
      <PageTitle>Decision support and ERP optimisation</PageTitle>
      <Tabs tabs={[{ key: 'yield', label: 'Yield prediction (BPNN)' }, { key: 'soil', label: 'Soil fertility & water (PLS)' },
        { key: 'alloc', label: 'Resource redistribution (LP)' }]} active={tab} onChange={setTab} />
      {tab === 'yield' && <YieldTab fields={fields} />}
      {tab === 'soil' && <FertilityTab />}
      {tab === 'alloc' && <AllocationTab />}
    </div>
  );
}
