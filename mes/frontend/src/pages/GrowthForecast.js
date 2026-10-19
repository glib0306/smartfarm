// Vegetation (growth) forecast: survey results, season-specific forecasts, date forecast by reaching index,
// nutritional status diagnosis and the farm growth-status map.
import React, { useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, post } from '../api';
import FarmMap, { STATUS_COLORS } from '../components/FarmMap';
import { DataTable, Loading, PageTitle, Panel, Select, StatusPill, Tabs, color, notify, notifyError } from '../components/ui';

const CROPS = [{ key: 'rice', label: 'Rice' }, { key: 'wheat', label: 'Wheat' }];

function useCultivars() {
  const [c, setC] = useState([]);
  useEffect(() => { api('/farm/cultivars').then(setC).catch(notifyError); }, []);
  return c;
}

function CropCultivar({ crop, setCrop, cultivar, setCultivar, cultivars, allowAll }) {
  const opts = cultivars.filter((c) => c.crop === crop).map((c) => ({ value: c.id, label: c.name }));
  return (
    <div className="row">
      <Select label="Crop" value={crop} onChange={(v) => { setCrop(v); setCultivar(''); }} options={CROPS.map((c) => ({ value: c.key, label: c.label }))} />
      <Select label="Cultivar" value={cultivar} onChange={setCultivar} options={(allowAll ? [{ value: '', label: 'All' }] : []).concat(opts)} />
    </div>
  );
}

// ---------------------------------------------------------------- left: growth survey results
function SurveyResults({ cultivars }) {
  const [crop, setCrop] = useState('rice');
  const [cultivar, setCultivar] = useState('');
  const [index, setIndex] = useState('leaf_number');
  const [d, setD] = useState(null);
  useEffect(() => {
    api(`/quality/surveys?crop=${crop}&index=${index}${cultivar ? '&cultivar_id=' + cultivar : ''}`).then(setD).catch(notifyError);
  }, [crop, cultivar, index]);
  const opts = cultivars.filter((c) => c.crop === crop).map((c) => ({ value: c.id, label: c.name }));
  return (
    <Panel title="Growth Survey Results">
      <Tabs tabs={CROPS} active={crop} onChange={(k) => { setCrop(k); setCultivar(''); }} small />
      <div className="row" style={{ marginBottom: 8 }}>
        <Select label="Cultivar" value={cultivar} onChange={setCultivar} options={[{ value: '', label: 'All' }].concat(opts)} />
        <Select label="Index" value={index} onChange={setIndex} options={[
          { value: 'leaf_number', label: 'Leaf number' }, { value: 'tiller_number', label: 'Tiller number' },
          { value: 'plant_height', label: 'Plant height' }, { value: 'spad', label: 'SPAD' }]} />
      </div>
      {d ? <DataTable maxHeight={560} rowKey={(r) => r.soil_no} rows={d.rows} columns={[
        { key: 'soil_no', label: 'Soil no.' }, { key: 'cultivar_name', label: 'Cultivar' },
        { key: 'value', label: 'Growth index', align: 'right' }, { key: 'survey_date', label: 'Surveyed' }]} /> : <Loading />}
    </Panel>
  );
}

// ---------------------------------------------------------------- top right: season-specific growth forecast
function SeasonForecast({ cultivars }) {
  const [period, setPeriod] = useState('30');
  const [kind, setKind] = useState('leaf');
  const [crop, setCrop] = useState('rice');
  const [cultivar, setCultivar] = useState('');
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!cultivar && cultivars.length) { const c = cultivars.find((x) => x.crop === crop); if (c) setCultivar(String(c.id)); }
  }, [cultivars, crop, cultivar]);
  useEffect(() => {
    if (!cultivar) return;
    setD(null);
    api(`/quality/forecast?crop=${crop}&cultivar_id=${cultivar}&horizon=${period}`).then(setD).catch(notifyError);
  }, [crop, cultivar, period]);
  return (
    <Panel title="Season-specific Growth Forecast">
      <Tabs tabs={[{ key: '30', label: 'Monthly' }, { key: '10', label: '10-day' }, { key: '7', label: 'Weekly' }]} active={period} onChange={setPeriod} small />
      <Tabs tabs={[{ key: 'leaf', label: 'Leaf number prediction' }, { key: 'tiller', label: 'Tiller number prediction' }]} active={kind} onChange={setKind} small />
      <CropCultivar crop={crop} setCrop={setCrop} cultivar={cultivar} setCultivar={setCultivar} cultivars={cultivars} />
      {d ? (
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={d.rows} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#e3e8e4" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {d.soil_nos.map((s, i) => <Line key={s} dataKey={`${kind}_${s}`} name={s} stroke={color(i)} dot={false} strokeWidth={2} />)}
          </LineChart>
        </ResponsiveContainer>
      ) : <Loading text="Running growth model..." />}
    </Panel>
  );
}

// ---------------------------------------------------------------- right middle: date forecast by reaching index
function ReachForecast({ cultivars }) {
  const [kind, setKind] = useState('leaf');
  const [crop, setCrop] = useState('rice');
  const [cultivar, setCultivar] = useState('');
  const [target, setTarget] = useState(14);
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!cultivar && cultivars.length) { const c = cultivars.find((x) => x.crop === crop); if (c) setCultivar(String(c.id)); }
  }, [cultivars, crop, cultivar]);
  async function run() {
    setBusy(true);
    try {
      const r = await post('/quality/reach', { crop, cultivar_id: cultivar, kind, target: Number(target) });
      setD(r);
      notify(r.reached_date ? `Target reached on ${r.reached_date} (${r.reached_day} days).` : 'Target is not reached within 150 days.', r.reached_date ? 'success' : 'warning');
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  }
  return (
    <Panel title="Date Forecast by Reaching Index">
      <Tabs tabs={[{ key: 'leaf', label: 'Leaf number' }, { key: 'tiller', label: 'Tiller number' }]} active={kind} onChange={(k) => { setKind(k); setD(null); }} small />
      <div className="row">
        <CropCultivar crop={crop} setCrop={setCrop} cultivar={cultivar} setCultivar={setCultivar} cultivars={cultivars} />
        <label className="field-inline">Target <input type="number" step="0.5" className="cell" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={busy || !cultivar} onClick={run}>Prediction</button>
      </div>
      {d && (
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={d.series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#e3e8e4" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
            <Tooltip />
            <ReferenceLine y={Number(target)} stroke="#d64545" strokeDasharray="4 4" label={{ value: 'target', fontSize: 11, fill: '#d64545' }} />
            <Line dataKey="value" name={kind === 'leaf' ? 'Leaf number' : 'Tiller number'} stroke={color(0)} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- lower right: nutritional status diagnosis
function Nutrition() {
  const [crop, setCrop] = useState('rice');
  const [field, setField] = useState('');
  const [d, setD] = useState(null);
  useEffect(() => {
    api(`/quality/nutrition?crop=${crop}${field ? '&field_id=' + field : ''}`).then(setD).catch(notifyError);
  }, [crop, field]);
  return (
    <Panel title="Nutritional Status Diagnosis">
      <Tabs tabs={[{ key: 'rice', label: 'Rice (paddy)' }, { key: 'wheat', label: 'Wheat' }]} active={crop} onChange={(k) => { setCrop(k); setField(''); }} small />
      {!d ? <Loading /> : (
        <>
          <div className="row">
            <Select label="Soil no." value={field || d.field_id} onChange={setField} options={d.fields.map((f) => ({ value: f.id, label: f.soil_no }))} />
            {d.field && <span className="small">{d.field.cultivar_name}</span>}
          </div>
          {d.latest && (
            <DataTable rows={[d.latest]} columns={[
              { key: 'diag_date', label: 'Last diagnosis' }, { key: 'n_pct', label: 'N %', align: 'right' },
              { key: 'p_pct', label: 'P %', align: 'right' }, { key: 'k_pct', label: 'K %', align: 'right' },
              { key: 'spad', label: 'SPAD', align: 'right' }, { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> }]} />
          )}
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={d.history} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#e3e8e4" />
              <XAxis dataKey="diag_date" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="a" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="b" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="a" dataKey="n_pct" name="N %" stroke={color(0)} dot={false} />
              <Line yAxisId="a" dataKey="k_pct" name="K %" stroke={color(1)} dot={false} />
              <Line yAxisId="a" dataKey="p_pct" name="P %" stroke={color(2)} dot={false} />
              <Line yAxisId="b" dataKey="spad" name="SPAD" stroke={color(3)} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- centre: growth map
function GrowthMap() {
  const [fields, setFields] = useState(null);
  const [sel, setSel] = useState(null);
  useEffect(() => { api('/quality/map').then(setFields).catch(notifyError); }, []);
  if (!fields) return <Panel title="Farm growth status"><Loading /></Panel>;
  const f = fields.find((x) => x.id === sel);
  return (
    <Panel title="Farm growth status" extra={<button className="btn" onClick={async () => {
      try { const r = await post('/quality/retrain'); notify('Growth model re-trained (self-learning) for ' + r.models.length + ' cultivars.'); } catch (e) { notifyError(e); }
    }}>Re-train model</button>}>
      <FarmMap fields={fields} selectedId={sel} onFieldClick={(x) => setSel(x.id)}
        fillFor={(x) => STATUS_COLORS[x.status || 'normal']}
        labelFor={(x) => [x.soil_no, x.growth_stage || '']}
        legend={[{ color: STATUS_COLORS.normal, label: 'Growing normally' }, { color: STATUS_COLORS.abnormal, label: 'Abnormal' },
          { color: STATUS_COLORS.harvest, label: 'Reaching harvest' }]} />
      {f ? (
        <DataTable rows={[f]} columns={[
          { key: 'soil_no', label: 'Soil no.' }, { key: 'cultivar_name', label: 'Cultivar' }, { key: 'growth_stage', label: 'Stage' },
          { key: 'status', label: 'Growth', render: (r) => <StatusPill status={r.status || 'normal'} /> },
          { key: 'leaf_number', label: 'Leaves', align: 'right' }, { key: 'tiller_number', label: 'Tillers', align: 'right' },
          { key: 'plant_height', label: 'Height cm', align: 'right' }, { key: 'survey_spad', label: 'SPAD', align: 'right' },
          { key: 'n_pct', label: 'N %', align: 'right' }, { key: 'p_pct', label: 'P %', align: 'right' }, { key: 'k_pct', label: 'K %', align: 'right' },
          { key: 'nutrient_status', label: 'Nutrition', render: (r) => <StatusPill status={r.nutrient_status || '-'} /> }]} />
      ) : <div className="small muted">Click a field to see its nutritional status and growth parameters.</div>}
    </Panel>
  );
}

export default function GrowthForecast() {
  const cultivars = useCultivars();
  return (
    <div>
      <PageTitle>Vegetation forecast</PageTitle>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(240px, 290px) minmax(0, 1.5fr) minmax(320px, 420px)' }}>
        <SurveyResults cultivars={cultivars} />
        <GrowthMap />
        <div className="grid" style={{ alignContent: 'start' }}>
          <SeasonForecast cultivars={cultivars} />
          <ReachForecast cultivars={cultivars} />
          <Nutrition />
        </div>
      </div>
    </div>
  );
}
