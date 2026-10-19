// CPS: simulation of production plan performance, growth by growth stage (3D), response measures and
// disease & pest infestation, all driven by MES data in the shared database.
import React, { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, ErrorBar, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, getToken, post, setToken } from './api';
import CropScene from './components/CropScene';
import FarmMap, { STATUS_COLORS } from './components/FarmMap';
import { DataTable, Loading, Notifier, Panel, Select, Tabs, color, notifyError, SERIES } from './components/ui';

function pad(n) { return (n < 10 ? '0' : '') + n; }

function Header({ user, onLogout }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <header className="header">
      <div className="brand">Seed Farm CPS · Cyber-Physical Simulation</div>
      <div className="clock">
        <div className="date">{now.getFullYear()}-{pad(now.getMonth() + 1)}-{pad(now.getDate())}</div>
        <div className="time">{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</div>
      </div>
      <div className="user"><span>{user.full_name}</span><button onClick={onLogout}>Log out</button></div>
    </header>
  );
}

function Login({ onLogin }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    try { const r = await post('/auth/login', { username: u, password: p }); setToken(r.token); onLogin(r.user); } catch (x) { setErr(x.message); }
  }
  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>Seed Farm CPS</h1>
        <div className="small muted">Uses the same accounts as MES</div>
        <label>Username<input type="text" value={u} onChange={(e) => setU(e.target.value)} autoFocus required /></label>
        <label>Password<input type="password" value={p} onChange={(e) => setP(e.target.value)} required /></label>
        {err && <div className="error-text">{err}</div>}
        <button className="btn btn-primary" type="submit">Log in</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- production plan simulation
function PlanSimulation() {
  const [plans, setPlans] = useState(null);
  const [id, setId] = useState('');
  const [sim, setSim] = useState(null);
  useEffect(() => {
    api('/plans').then((p) => { setPlans(p); const a = p.find((x) => x.status !== 'draft') || p[0]; if (a) setId(String(a.id)); }).catch(notifyError);
  }, []);
  useEffect(() => { if (!id) return; setSim(null); api('/plan-sim/' + id).then(setSim).catch(notifyError); }, [id]);
  if (!plans) return <Loading />;
  const yields = sim ? sim.yields.map((y) => ({ crop: y.crop, mean: y.mean, p50: y.p50, err: [y.p50 - y.p10, y.p90 - y.p50], p10: y.p10, p90: y.p90 })) : [];
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <Select label="Production plan (MES scenario)" value={id} onChange={setId} style={{ maxWidth: '100%' }}
          options={plans.map((p) => ({ value: p.id, label: p.label }))} />
      </div>
      {!sim ? <Loading text="Running Monte-Carlo simulation..." /> : (
        <div className="grid g2">
          <Panel title="Expected yield of the selected plan" extra={<span className="small muted">{sim.runs} weather / pest scenarios</span>}>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={yields} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e3e8e4" vertical={false} />
                <XAxis dataKey="crop" />
                <YAxis unit=" t" />
                <Tooltip formatter={(v, n) => (Array.isArray(v) ? v.join(' / ') : v + ' t')} />
                <Legend />
                <Bar dataKey="p50" name="Median seed yield (P10–P90)" fill={SERIES[2]}>
                  <ErrorBar dataKey="err" width={10} strokeWidth={2} stroke="#1d2a22" />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
            <DataTable rows={sim.yields} rowKey={(r) => r.crop} columns={[
              { key: 'crop', label: 'Crop' }, { key: 'p10', label: 'P10 t', align: 'right' }, { key: 'p50', label: 'P50 t', align: 'right' },
              { key: 'p90', label: 'P90 t', align: 'right' }, { key: 'mean', label: 'Mean t', align: 'right' }]} />
            <h4>Yield of all variants of this plan period</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={sim.compare}><CartesianGrid stroke="#e3e8e4" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis unit=" t" />
                <Tooltip /><Bar dataKey="yield_t" name="Expected yield" fill={SERIES[0]} /></BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Economic profit" extra={<span className="small muted">cost {sim.plan.expected_cost.toLocaleString()} · revenue share {sim.plan.revenue_share}</span>}>
            <div className="grid g3" style={{ marginBottom: 8 }}>
              <div className="kpi"><span className="v">{sim.profit.mean.toLocaleString()}</span><span className="l">Mean profit</span></div>
              <div className="kpi"><span className="v">{sim.profit.p10.toLocaleString()}</span><span className="l">P10 (bad year)</span></div>
              <div className="kpi"><span className="v">{sim.profit.p90.toLocaleString()}</span><span className="l">P90 (good year)</span></div>
            </div>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={sim.profit.histogram.map((h) => ({ ...h, label: Math.round((h.from + h.to) / 2000) + 'k' }))}>
                <CartesianGrid stroke="#e3e8e4" vertical={false} /><XAxis dataKey="label" /><YAxis />
                <Tooltip formatter={(v) => v + ' scenarios'} labelFormatter={(l) => 'Profit ≈ ' + l} />
                <Bar dataKey="count" name="Scenarios" fill={SERIES[4]} />
              </BarChart>
            </ResponsiveContainer>
            <h4>Profit of all variants (mean with P10–P90)</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={sim.compare.map((c) => ({ ...c, err: [c.profit_mean - c.profit_p10, c.profit_p90 - c.profit_mean] }))}>
                <CartesianGrid stroke="#e3e8e4" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => Math.round(v / 1000) + 'k'} /><Tooltip formatter={(v) => (Array.isArray(v) ? '' : v.toLocaleString())} />
                <Bar dataKey="profit_mean" name="Mean profit" fill={SERIES[1]}><ErrorBar dataKey="err" width={8} stroke="#1d2a22" /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- growth simulation by growth stage (3D)
function GrowthSimulation() {
  const [d, setD] = useState(null);
  const [week, setWeek] = useState(0);
  useEffect(() => { api('/growth-sim?weeks=8').then(setD).catch(notifyError); }, []);
  if (!d) return <Loading text="Loading MES growth predictions..." />;
  const info = (crop) => {
    const s = d.crops[crop] && d.crops[crop][week];
    if (!s) return null;
    return (
      <div className="row small" style={{ marginTop: 6 }}>
        <b>{s.stage}</b><span>DAS {s.das}</span><span>leaves {s.leaf}</span><span>tillers {s.tiller}</span><span>height {s.height_cm} cm</span>
        <span>ripeness {Math.round(s.ripeness * 100)}%</span>
      </div>
    );
  };
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <label className="field-inline">Week
          <input type="range" min="0" max={d.weeks} value={week} onChange={(e) => setWeek(Number(e.target.value))} style={{ width: 280 }} />
        </label>
        <b>{week === 0 ? 'Current (last survey)' : `+${week} week${week > 1 ? 's' : ''}`}</b>
        <div className="row">{Array.from({ length: d.weeks + 1 }, (_, i) => (
          <button key={i} className={'btn' + (i === week ? ' btn-primary' : '')} onClick={() => setWeek(i)}>{i === 0 ? 'Now' : 'W' + i}</button>))}</div>
      </div>
      <div className="grid g2">
        {['rice', 'wheat'].map((crop) => (
          <Panel key={crop} title={`${crop === 'rice' ? 'Rice' : 'Wheat'} — 3D growth simulation (MES prediction)`} extra={<span className="small muted">drag to rotate · wheel to zoom</span>}>
            {d.crops[crop] ? <CropScene crop={crop} state={d.crops[crop][week]} /> : <div className="muted">No {crop} fields</div>}
            {info(crop)}
            {d.crops[crop] && (
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={d.crops[crop]} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="#e3e8e4" /><XAxis dataKey="week" tickFormatter={(w) => 'W' + w} /><YAxis />
                  <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line dataKey="leaf" name="Leaves" stroke={color(0)} dot={false} />
                  <Line dataKey="tiller" name="Tillers" stroke={color(1)} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- response measures for the crop growth period
function ResponseSimulation() {
  const [cultivars, setCultivars] = useState([]);
  const [crop, setCrop] = useState('rice');
  const [cultivar, setCultivar] = useState('');
  const [measures, setMeasures] = useState(['n_topdress']);
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/cultivars').then(setCultivars).catch(notifyError); }, []);
  const run = useCallback(() => {
    setBusy(true);
    post('/response', { crop, cultivar_id: cultivar || null, measures, horizon: 45 }).then(setD).catch(notifyError).finally(() => setBusy(false));
  }, [crop, cultivar, measures]);
  useEffect(() => { run(); }, [run]);
  const all = d ? d.measures : [{ key: 'n_topdress', label: 'N top-dressing' }, { key: 'irrigation', label: 'Irrigation' },
    { key: 'pest_control', label: 'Pest control' }, { key: 'cold_protection', label: 'Cold protection' }];
  return (
    <div className="grid g-side">
      <Panel title="Scenario">
        <div className="grid">
          <Select label="Crop" value={crop} onChange={(v) => { setCrop(v); setCultivar(''); }} options={[{ value: 'rice', label: 'Rice' }, { value: 'wheat', label: 'Wheat' }]} />
          <Select label="Cultivar" value={cultivar} onChange={setCultivar}
            options={[{ value: '', label: 'All' }].concat(cultivars.filter((c) => c.crop === crop).map((c) => ({ value: c.id, label: c.name })))} />
          <div><b className="small">Response measures</b>
            {all.map((m) => (
              <label key={m.key} className="field-inline" style={{ display: 'flex' }}>
                <input type="checkbox" checked={measures.indexOf(m.key) >= 0}
                  onChange={(e) => setMeasures(e.target.checked ? measures.concat(m.key) : measures.filter((x) => x !== m.key))} /> {m.label}
              </label>
            ))}
          </div>
          {busy && <span className="small muted">Simulating…</span>}
          {d && (
            <div className="grid" style={{ gridTemplateColumns: 'auto 1fr', gap: '4px 10px' }}>
              <span className="muted small">Soil moisture</span><span className="small">{d.inputs.soil_moisture.toFixed(1)} %</span>
              <span className="muted small">Paddy water</span><span className="small">{d.inputs.water_level_cm.toFixed(1)} cm</span>
              <span className="muted small">Pest damage (30 d)</span><span className="small">{Math.round(d.inputs.damaged_m2)} m²</span>
              <span className="muted small">Min forecast temp</span><span className="small">{d.inputs.min_forecast_temp} °C</span>
              <span className="muted small">Water stress</span><span className="small">{(d.stress.water_stress * 100).toFixed(1)} %</span>
              <span className="muted small">Pest loss</span><span className="small">{(d.stress.pest_loss * 100).toFixed(1)} %</span>
            </div>
          )}
        </div>
      </Panel>
      {d ? (
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="grid g3">
            <Panel><div className="kpi"><span className="v">{d.yield_base} t/ha</span><span className="l">Expected yield without measures</span></div></Panel>
            <Panel><div className="kpi"><span className="v">{d.yield_measure} t/ha</span><span className="l">Expected yield with measures</span></div></Panel>
            <Panel><div className="kpi"><span className="v">{(((d.yield_measure - d.yield_base) / d.yield_base) * 100).toFixed(1)} %</span><span className="l">Effect of measures</span></div></Panel>
          </div>
          <Panel title="Predicted tiller number for the next 45 days">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={d.series}><CartesianGrid stroke="#e3e8e4" /><XAxis dataKey="day" /><YAxis domain={['auto', 'auto']} /><Tooltip /><Legend />
                <Line dataKey="tiller_base" name="Without measures" stroke={color(1)} dot={false} strokeDasharray="5 4" />
                <Line dataKey="tiller_measure" name="With measures" stroke={color(2)} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Predicted leaf number for the next 45 days">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={d.series}><CartesianGrid stroke="#e3e8e4" /><XAxis dataKey="day" /><YAxis domain={['auto', 'auto']} /><Tooltip /><Legend />
                <Line dataKey="leaf_base" name="Without measures" stroke={color(1)} dot={false} strokeDasharray="5 4" />
                <Line dataKey="leaf_measure" name="With measures" stroke={color(0)} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      ) : <Loading />}
    </div>
  );
}

// ---------------------------------------------------------------- disease & pest infestation simulation
function PestSimulation() {
  const [days, setDays] = useState(21);
  const [d, setD] = useState(null);
  const [sel, setSel] = useState(null);
  useEffect(() => { setD(null); api('/pest-sim?days=' + days).then(setD).catch(notifyError); }, [days]);
  const f = d && d.fields.find((x) => x.id === sel);
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <Select label="Simulation horizon" value={days} onChange={(v) => setDays(Number(v))}
          options={[7, 14, 21, 30, 45].map((n) => ({ value: n, label: n + ' days' }))} />
      </div>
      {!d ? <Loading text="Simulating infestation spread..." /> : (
        <div className="grid g-side-r">
          <Panel title={`Expected infestation after ${d.days} days`}>
            <FarmMap fields={d.fields} selectedId={sel} onFieldClick={(x) => setSel(x.id)}
              fillFor={(x) => STATUS_COLORS[x.state]}
              labelFor={(x) => [x.soil_no].concat(x.expected.slice(0, 2).map((e) => e.pest_name))}
              legend={[{ color: STATUS_COLORS.normal, label: 'Normal' }, { color: STATUS_COLORS.disease, label: 'Disease expected' },
                { color: STATUS_COLORS.pest, label: 'Pests expected' }]} />
          </Panel>
          <div className="grid" style={{ alignContent: 'start' }}>
            <Panel title="Field details">
              {f ? (f.expected.length ? (
                <DataTable rows={f.expected} rowKey={(e) => e.pest_name} columns={[
                  { key: 'pest_name', label: f.soil_no + ' · expected pest' }, { key: 'individuals', label: 'Individuals', align: 'right' },
                  { key: 'damaged_area_m2', label: 'Damaged m²', align: 'right' }, { key: 'probability', label: 'Prob.', align: 'right' }]} />
              ) : <span className="small muted">{f.soil_no}: no infestation expected.</span>) : <span className="small muted">Click a field.</span>}
            </Panel>
            <Panel title="Spread over time">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={d.daily}><CartesianGrid stroke="#e3e8e4" /><XAxis dataKey="day" /><YAxis /><Tooltip /><Legend />
                  <Line dataKey="disease_fields" name="Disease fields" stroke="#d64545" dot={false} />
                  <Line dataKey="pest_fields" name="Pest fields" stroke="#c9a227" dot={false} />
                  <Line dataKey="damaged_area_ha" name="Damaged ha" stroke={color(4)} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(!!getToken());
  const [tab, setTab] = useState('plan');
  const logout = useCallback(() => { setToken(''); setUser(null); }, []);
  useEffect(() => {
    window.addEventListener('cps-logout', logout);
    if (getToken()) api('/auth/me').then((r) => setUser(r.user)).catch(() => setToken('')).finally(() => setChecking(false));
    return () => window.removeEventListener('cps-logout', logout);
  }, [logout]);
  if (checking) return <Loading text="Connecting to CPS server..." />;
  if (!user) return (<><Login onLogin={setUser} /><Notifier /></>);
  return (
    <div className="app" style={{ gridTemplateColumns: '1fr' }}>
      <Header user={user} onLogout={logout} />
      <main className="main">
        <Tabs tabs={[{ key: 'plan', label: 'Production plan simulation' }, { key: 'growth', label: 'Growth simulation by growth stage' },
          { key: 'response', label: 'Response measures simulation' }, { key: 'pest', label: 'Disease and pest infestation simulation' }]}
        active={tab} onChange={setTab} />
        {tab === 'plan' && <PlanSimulation />}
        {tab === 'growth' && <GrowthSimulation />}
        {tab === 'response' && <ResponseSimulation />}
        {tab === 'pest' && <PestSimulation />}
      </main>
      <Notifier />
    </div>
  );
}
