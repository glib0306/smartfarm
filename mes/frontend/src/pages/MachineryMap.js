// Harvest & machinery map (react-leaflet, offline): crop harvest conditions per field, real-time machinery
// operation status, and shortest / fastest machinery routes between two points over the farm road network.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { LayerGroup, LayersControl, MapContainer, Marker, Pane, Polyline, Rectangle, ScaleControl, Tooltip, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api, post } from '../api';
import { DataTable, Loading, PageTitle, Panel, Select, StatusPill, Tabs, fmt, notifyError } from '../components/ui';

const MAP_W = 1100;
const MAP_H = 700;
const LIVE_MS = 3000;

const READINESS = [
  { key: 'growing', label: 'Growing', color: '#9ccc9c' },
  { key: 'approaching', label: 'Approaching maturity', color: '#d4dc6a' },
  { key: 'ready', label: 'Ready to harvest', color: '#f2c230' },
  { key: 'harvesting', label: 'Harvesting', color: '#e07b39' },
  { key: 'harvested', label: 'Harvested', color: '#b9ada0' }
];
const READY_COLOR = READINESS.reduce((a, r) => ({ ...a, [r.key]: r.color }), {});
const STATUS_COLOR = { operating: '#2f9e44', idle: '#e0a100', repair: '#d64545' };
const ROAD_STYLE = {
  main: { weight: 7, color: '#bfb6a3' }, headland: { weight: 5, color: '#cfc6b2' }, service: { weight: 6, color: '#bfb6a3' },
  farm: { weight: 4, color: '#d6cdb9' }, lane: { weight: 2.5, color: '#ddd5c3' }
};
const STATE_STYLE = { muddy: { color: '#8a6d4f', dashArray: '6 6' }, rutted: { color: '#c9a227' }, closed: { color: '#d64545', dashArray: '4 8' } };

function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m'; }
function fmtTime(s) {
  if (s < 60) return Math.round(s) + ' s';
  const min = Math.floor(s / 60);
  return min >= 60 ? Math.floor(min / 60) + ' h ' + (min % 60) + ' min' : min + ' min ' + Math.round(s % 60) + ' s';
}

// Leaflet CRS.Simple with metres as map units: farm map (x right, y down, 1 unit = mpu metres) -> [lat, lng].
function useProjection(mpu) {
  return useMemo(() => {
    const ll = (x, y) => [(MAP_H - y) * mpu, x * mpu];
    return {
      ll,
      pts: (points) => points.map((p) => ll(p[0], p[1])),
      rect: (x, y, w, h) => [ll(x, y + h), ll(x + w, y)],
      toXY: (latlng) => ({ x: Math.round(latlng.lng / mpu * 10) / 10, y: Math.round((MAP_H - latlng.lat / mpu) * 10) / 10 }),
      bounds: [[0, 0], [MAP_H * mpu, MAP_W * mpu]]
    };
  }, [mpu]);
}

const iconCache = {};
function machineIcon(m, selected) {
  const moving = m.speed_kmh > 0.5;
  const small = m.status !== 'operating';
  const heading = Math.round((m.heading || 0) / 15) * 15;
  const key = [m.status, m.code, selected, moving, heading].join('|');
  if (!iconCache[key]) {
    const size = small && !selected ? 20 : 28;
    iconCache[key] = L.divIcon({
      className: '',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      html: '<div class="mm-icon mm-' + m.status + (selected ? ' sel' : small ? ' small' : '') + '">' +
        (moving ? '<i class="mm-arrow" style="transform: rotate(' + heading + 'deg)"></i>' : '') +
        '<b>' + (m.code || '?') + '</b></div>'
    });
  }
  return iconCache[key];
}

const FACILITY_ICON = L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div class="mm-facility"></div>' });

const endIcons = {};
function endIcon(letter) {
  if (!endIcons[letter]) endIcons[letter] = L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: '<div class="mm-pin">' + letter + '</div>' });
  return endIcons[letter];
}

function MapClicks({ onClick }) {
  useMapEvents({ click: onClick });
  return null;
}

// ---------------------------------------------------------------- side panel: harvest
function HarvestPanel({ map, field, setFieldId, live }) {
  const s = map.summary;
  const count = (k) => (s.by_readiness.find((b) => b.readiness === k) || { fields: 0, area_ha: 0 });
  const crop = field ? map.crop_types.find((c) => c.code === field.crop) : null;
  const hv = field && field.harvest;
  const inField = field ? live.filter((m) => m.field_id === field.id && m.status === 'operating') : [];
  return (
    <div className="mm-side">
      <div className="mm-kpis">
        <div className="kpi"><span className="v">{count('ready').fields}</span><span className="l">fields ready</span></div>
        <div className="kpi"><span className="v">{count('harvesting').fields}</span><span className="l">being harvested</span></div>
        <div className="kpi"><span className="v">{fmt(s.harvested_ha)}</span><span className="l">ha harvested</span></div>
        <div className="kpi"><span className="v">{fmt(s.ready_t, 0)}</span><span className="l">t still to harvest</span></div>
      </div>
      {map.rain_forecast.length > 0 && (
        <div className="warning-box">Rain forecast on {map.rain_forecast.map((r) => r.forecast_date).join(', ')}: harvest ready fields first.</div>
      )}
      <h4 className="mm-h">Harvest priority</h4>
      <DataTable maxHeight={190} rows={map.priority} rowKey={(r) => r.field_id} onRowClick={(r) => setFieldId(r.field_id)}
        selectedKey={field ? field.id : undefined} empty="No field is ready yet" columns={[
          { key: 'soil_no', label: 'Field' },
          { key: 'readiness', label: 'State', render: (r) => <span className="mm-dot" style={{ '--c': READY_COLOR[r.readiness] }}>{r.readiness}</span> },
          { key: 'remaining_t', label: 'Left (t)', align: 'right' },
          { key: 'reasons', label: 'Why', render: (r) => <span className="small">{r.reasons.join('; ')}</span> }]} />
      {field ? (
        <>
          <h4 className="mm-h">Field {field.soil_no} · {field.cultivar_name}</h4>
          {hv ? (
            <dl className="mm-dl">
              <dt>Condition</dt><dd><span className="mm-dot" style={{ '--c': READY_COLOR[hv.readiness] }}>{hv.readiness}</span></dd>
              <dt>Area · grade</dt><dd>{field.area_ha} ha · {field.grade}</dd>
              <dt>Maturity</dt><dd>{hv.maturity_pct}%</dd>
              <dt>Grain moisture</dt><dd>{hv.grain_moisture_pct === null ? 'not measurable yet' : hv.grain_moisture_pct + '%'}
                {crop && <span className="muted"> (harvest at {crop.harvest_moisture_min}–{crop.harvest_moisture_max}%, store at {crop.storage_moisture}%)</span>}</dd>
              <dt>Lodging</dt><dd className={hv.lodging_pct >= 10 ? 'bad' : ''}>{hv.lodging_pct}%</dd>
              <dt>Expected yield</dt><dd>{hv.expected_yield_t_ha} t/ha · {fmt(hv.expected_yield_t_ha * field.area_ha, 1)} t</dd>
              <dt>Harvested</dt><dd>{hv.harvested_pct}%</dd>
              <dt>Harvest date</dt><dd>{hv.est_harvest_date || '-'}</dd>
              {hv.notes && <><dt>Note</dt><dd>{hv.notes}</dd></>}
              <dt>Machines here</dt><dd>{inField.length ? inField.map((m) => m.designation).join(', ') : 'none'}</dd>
            </dl>
          ) : <p className="muted">No harvest assessment for this field.</p>}
          {hv && (
            <DataTable maxHeight={180} rows={field.history.slice().reverse()} rowKey={(r) => r.assessed_on} columns={[
              { key: 'assessed_on', label: 'Date' }, { key: 'maturity_pct', label: 'Maturity %', align: 'right' },
              { key: 'grain_moisture_pct', label: 'Moisture %', align: 'right' }, { key: 'harvested_pct', label: 'Harvested %', align: 'right' },
              { key: 'readiness', label: 'State' }]} />
          )}
        </>
      ) : <p className="muted small">Click a field on the map for its harvest condition.</p>}
      <h4 className="mm-h">Crop types</h4>
      <DataTable maxHeight={180} rows={map.crop_types} rowKey={(r) => r.code} columns={[
        { key: 'name', label: 'Crop', render: (r) => <span className="mm-dot" style={{ '--c': r.color }}>{r.name}</span> },
        { key: 'harvest_moisture_max', label: 'Harvest ≤ %', align: 'right' }, { key: 'storage_moisture', label: 'Store %', align: 'right' },
        { key: 'typical_yield_t_ha', label: 't/ha', align: 'right' }, { key: 'planted', label: 'On farm', render: (r) => (r.planted ? 'yes' : '-') }]} />
    </div>
  );
}

// ---------------------------------------------------------------- side panel: machinery
function MachineryPanel({ live, types, machine, setMachineId, filter, setFilter, onRouteFrom }) {
  const rows = live.machines.filter((m) => (!filter.status || m.status === filter.status) && (!filter.type || m.type === filter.type));
  const type = machine ? types.find((t) => t.type === machine.type) : null;
  const gps = live.machines.filter((m) => m.live === 'gps').length;
  return (
    <div className="mm-side">
      <div className="mm-kpis">
        {['operating', 'idle', 'repair'].map((s) => (
          <button key={s} className={'kpi kpi-btn' + (filter.status === s ? ' on' : '')} onClick={() => setFilter({ ...filter, status: filter.status === s ? '' : s })}>
            <span className="v" style={{ color: STATUS_COLOR[s] }}>{live.status_counts[s] || 0}</span><span className="l">{s}</span>
          </button>
        ))}
        <div className="kpi"><span className="v">{gps}</span><span className="l">on live GPS</span></div>
      </div>
      <div className="row">
        <Select label="Type" value={filter.type} onChange={(v) => setFilter({ ...filter, type: v })}
          options={[{ value: '', label: 'All types' }].concat(types.map((t) => ({ value: t.type, label: t.type })))} />
        <span className="muted small">Updated {new Date(live.time).toLocaleTimeString()}</span>
      </div>
      {live.alerts.filter((a) => a.level === 'warning').map((a) => (
        <div key={a.text} className="warning-box mm-alert" onClick={() => setMachineId(a.equipment_id)}>{a.text}</div>
      ))}
      <DataTable maxHeight={260} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => setMachineId(r.id)} selectedKey={machine ? machine.id : undefined}
        columns={[
          { key: 'designation', label: 'Machine' }, { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
          { key: 'task', label: 'Task', render: (r) => (r.status === 'operating' ? r.task || '-' : r.reason || '-') },
          { key: 'soil_no', label: 'Field' }, { key: 'speed_kmh', label: 'km/h', align: 'right' },
          { key: 'fuel_pct', label: 'Fuel %', align: 'right' }]} />
      {machine ? (
        <>
          <h4 className="mm-h">{machine.designation} · {machine.equipment_no}</h4>
          <dl className="mm-dl">
            <dt>Type</dt><dd>{machine.type} ({machine.category})</dd>
            <dt>Status</dt><dd><StatusPill status={machine.status} /> {machine.status !== 'operating' && machine.reason}</dd>
            <dt>Task</dt><dd>{machine.task || '-'}{machine.soil_no ? ' · ' + machine.soil_no : ''}</dd>
            <dt>Position</dt><dd>{fmt(machine.x, 0)}, {fmt(machine.y, 0)} · heading {machine.heading}°</dd>
            <dt>Speed</dt><dd>{machine.speed_kmh} km/h</dd>
            <dt>Fuel</dt><dd className={machine.fuel_pct !== null && machine.fuel_pct < 20 ? 'bad' : ''}>{fmt(machine.fuel_pct)}%</dd>
            <dt>Engine hours</dt><dd>{fmt(machine.engine_hours, 1)}</dd>
            <dt>Signal</dt><dd>{{ gps: 'live GPS', sim: 'simulated from last report', parked: 'parked', stationary: 'stationary plant',
              'gps-stale': 'GPS lost ' + Math.round((machine.last_seen_s || 0) / 60) + ' min ago' }[machine.live]}</dd>
            {type && <><dt>Size</dt><dd>{type.width_m} m wide · {type.weight_t} t · {type.tracked ? 'tracked' : 'wheeled'}</dd>
              <dt>Speeds</dt><dd>road {type.road_speed_kmh} km/h · field {type.field_speed_kmh} km/h</dd></>}
          </dl>
          {machine.mobile ? <button className="btn btn-primary" onClick={() => onRouteFrom(machine)}>Route from this machine</button> : null}
        </>
      ) : <p className="muted small">Click a machine on the map or in the table for its live status.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- side panel: route
const KINDS = [{ value: 'point', label: 'Map point' }, { value: 'machine', label: 'Machine' }, { value: 'field', label: 'Field' }, { value: 'facility', label: 'Facility' }];

function Endpoint({ label, value, onChange, picking, onPick, machines, fields, facilities }) {
  const lists = {
    machine: machines.filter((m) => m.mobile).map((m) => ({ value: m.id, label: m.designation + ' (' + m.status + ')' })),
    field: fields.map((f) => ({ value: f.id, label: f.soil_no + ' · ' + f.crop + (f.harvest ? ' · ' + f.harvest.readiness : '') })),
    facility: facilities.map((f) => ({ value: f.id, label: f.name }))
  };
  return (
    <div className="mm-end">
      <strong>{label}</strong>
      <Select value={value.kind} onChange={(k) => onChange(k === 'point' ? { kind: k } : { kind: k, id: lists[k][0] && lists[k][0].value })} options={KINDS} />
      {value.kind === 'point' ? (
        <button className={'btn' + (picking ? ' btn-primary' : '')} onClick={onPick}>
          {picking ? 'Click the map…' : value.x !== undefined ? fmt(value.x, 0) + ', ' + fmt(value.y, 0) + ' · re-pick' : 'Pick on map'}
        </button>
      ) : (
        <Select value={value.id} onChange={(id) => onChange({ kind: value.kind, id: Number(id) })} options={lists[value.kind]} />
      )}
    </div>
  );
}

// Consecutive segments on the same road become one step; the surface states along it are listed.
function routeSteps(segments) {
  const steps = [];
  segments.forEach((s) => {
    const last = steps[steps.length - 1];
    const state = s.restricted || s.road_state;
    if (last && last.name === s.name) {
      last.length_m += s.length_m;
      last.time_s += s.time_s;
      if (last.states.indexOf(state) < 0) last.states.push(state);
      last.restricted = last.restricted || !!s.restricted;
    } else {
      steps.push({ name: s.name, length_m: s.length_m, time_s: s.time_s, states: [state], restricted: !!s.restricted });
    }
  });
  return steps;
}

function endpointBody(v) {
  if (v.kind === 'machine') return { equipment_id: v.id };
  if (v.kind === 'field') return { field_id: v.id };
  if (v.kind === 'facility') return { node_id: v.id };
  return v.x === undefined ? null : { x: v.x, y: v.y };
}

function RoutePanel({ map, live, form, setForm, picking, setPicking, route, setRoute }) {
  const [busy, setBusy] = useState(false);
  const mobileTypes = map.machine_types.filter((t) => t.mobile);
  const run = async () => {
    const from = endpointBody(form.from);
    const to = endpointBody(form.to);
    if (!from || !to) { notifyError(new Error('Choose both a start and an end point')); return; }
    const body = { from, to, optimize: form.optimize };
    if (form.vehicle === 'auto' && form.from.kind === 'machine') body.equipment_id = form.from.id;
    else if (form.vehicle !== 'auto') body.machine_type = form.vehicle;
    setBusy(true);
    try { setRoute(await post('/machinery/route', body)); } catch (e) { setRoute(null); notifyError(e); } finally { setBusy(false); }
  };
  const common = { machines: live.machines, fields: map.fields, facilities: map.facilities };
  return (
    <div className="mm-side">
      <Endpoint label="A · From" value={form.from} onChange={(v) => setForm({ ...form, from: v })} picking={picking === 'from'}
        onPick={() => setPicking(picking === 'from' ? null : 'from')} {...common} />
      <Endpoint label="B · To" value={form.to} onChange={(v) => setForm({ ...form, to: v })} picking={picking === 'to'}
        onPick={() => setPicking(picking === 'to' ? null : 'to')} {...common} />
      <div className="mm-end">
        <strong>Vehicle</strong>
        <Select value={form.vehicle} onChange={(v) => setForm({ ...form, vehicle: v })}
          options={[{ value: 'auto', label: form.from.kind === 'machine' ? 'The start machine' : 'Generic tractor' }]
            .concat(mobileTypes.map((t) => ({ value: t.type, label: t.type + ' (' + t.width_m + ' m, ' + t.weight_t + ' t)' })))} />
      </div>
      <div className="mm-end">
        <strong>Optimise</strong>
        <Tabs small active={form.optimize} onChange={(k) => setForm({ ...form, optimize: k })}
          tabs={[{ key: 'distance', label: 'Shortest distance' }, { key: 'time', label: 'Fastest time' }]} />
      </div>
      <div className="row">
        <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? 'Calculating…' : 'Find route'}</button>
        {route && <button className="btn" onClick={() => setRoute(null)}>Clear</button>}
      </div>
      {route && (
        <>
          <div className="mm-kpis">
            <div className="kpi"><span className="v">{fmtDist(route.distance_m)}</span><span className="l">route length</span></div>
            <div className="kpi"><span className="v">{fmtTime(route.time_s)}</span><span className="l">travel time</span></div>
            <div className="kpi"><span className="v">{fmtDist(route.straight_m)}</span><span className="l">straight line</span></div>
          </div>
          <p className="small">
            {route.from.label} → {route.to.label} for a <strong>{route.machine ? route.machine.designation : route.profile.type}</strong>
            {' '}({route.profile.width_m} m, {route.profile.weight_t} t).
          </p>
          {route.detour_m > 0 && (
            <div className="info-box">{fmtDist(route.detour_m)} longer than the unrestricted route: {route.blocked_edges.length} road
              {' '}sections are closed or too narrow/weak for this vehicle (dotted red on the map).</div>
          )}
          {route.muddy_m > 0 && <div className="warning-box">{fmtDist(route.muddy_m)} of the route is muddy.</div>}
          {route.restricted_m > 0 && <div className="warning-box">The first or last {fmtDist(route.restricted_m)} uses a lane that is
            {' '}too narrow or weak for this vehicle. Drive it only to reach the nearest junction.</div>}
          <DataTable maxHeight={260} rows={routeSteps(route.segments)} columns={[
            { key: 'name', label: 'Road' },
            { key: 'states', label: 'State', render: (r) => (r.restricted ? <span className="pill pill-repair">{r.states.join(', ')}</span> : r.states.join(', ')) },
            { key: 'length_m', label: 'Length', align: 'right', render: (r) => fmtDist(r.length_m) },
            { key: 'time_s', label: 'Time', align: 'right', render: (r) => fmtTime(r.time_s) }]} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function MachineryMap() {
  const [map, setMap] = useState(null);
  const [live, setLive] = useState(null);
  const [tab, setTab] = useState('harvest');
  const [fieldId, setFieldId] = useState(null);
  const [machineId, setMachineId] = useState(null);
  const [filter, setFilter] = useState({ status: '', type: '' });
  const [form, setForm] = useState({ from: { kind: 'point' }, to: { kind: 'facility', id: null }, vehicle: 'auto', optimize: 'distance' });
  const [picking, setPicking] = useState(null);
  const [route, setRoute] = useState(null);
  const proj = useProjection(map ? map.meters_per_unit : 2);

  useEffect(() => {
    api('/machinery/map').then((m) => {
      setMap(m);
      const plant = m.facilities.find((f) => f.name === 'Seed processing plant') || m.facilities[0];
      setForm((f) => ({ ...f, to: { kind: 'facility', id: plant ? plant.id : null } }));
    }).catch(notifyError);
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () => api('/machinery/live').then((r) => alive && setLive(r)).catch((e) => alive && notifyError(e));
    load();
    const t = setInterval(load, LIVE_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const onMapClick = useCallback((e) => {
    if (!picking) return;
    const p = proj.toXY(e.latlng);
    setForm((f) => ({ ...f, [picking]: { kind: 'point', x: p.x, y: p.y } }));
    setPicking(null);
  }, [picking, proj]);

  const nodeById = useMemo(() => {
    const o = {};
    if (map) map.roads.nodes.forEach((n) => { o[n.id] = n; });
    return o;
  }, [map]);
  const blocked = useMemo(() => new Set(route ? route.blocked_edges.map((b) => b.id) : []), [route]);

  if (!map || !live) return <Loading />;
  const field = map.fields.find((f) => f.id === fieldId) || null;
  const machine = live.machines.find((m) => m.id === machineId) || null;
  const shown = live.machines.filter((m) => (!filter.status || m.status === filter.status) && (!filter.type || m.type === filter.type));
  const onMachineClick = (m) => {
    if (picking && m.mobile) {
      setForm({ ...form, [picking]: { kind: 'machine', id: m.id } });
      setPicking(null);
      return;
    }
    setMachineId(m.id);
    setTab('machinery');
  };
  const routeFrom = (m) => {
    setForm({ ...form, from: { kind: 'machine', id: m.id }, vehicle: 'auto' });
    setRoute(null);
    setTab('route');
  };

  return (
    <div>
      <PageTitle right={<span className="mm-live"><i className="pulse" /> Live · every {LIVE_MS / 1000} s</span>}>Harvest & machinery map</PageTitle>
      <div className="grid g-side-r">
        <Panel title="Farm map" extra={(
          <div className="legend-row">
            {READINESS.map((r) => <span key={r.key} style={{ '--c': r.color }}>{r.label}</span>)}
          </div>
        )}>
          <div className={'mm-map' + (picking ? ' picking' : '')}>
            <MapContainer crs={L.CRS.Simple} bounds={proj.bounds} minZoom={-2} maxZoom={2} zoomSnap={0.25}
              maxBounds={[[-200, -200], [MAP_H * map.meters_per_unit + 200, MAP_W * map.meters_per_unit + 200]]}
              attributionControl={false} style={{ height: '100%', width: '100%' }}>
              <MapClicks onClick={onMapClick} />
              <ScaleControl position="bottomleft" imperial={false} />
              {/* backdrop: river, service area */}
              <Rectangle bounds={proj.rect(0, 0, 14, MAP_H)} pathOptions={{ stroke: false, fillColor: '#9cc7e6', fillOpacity: 1 }} interactive={false} />
              <Rectangle bounds={proj.rect(1005, 20, 90, 660)} pathOptions={{ stroke: false, fillColor: '#dfe5dc', fillOpacity: 1 }} interactive={false} />
              <LayersControl position="topright">
                <LayersControl.Overlay checked name="Harvest conditions">
                  <LayerGroup>
                    {map.fields.map((f) => {
                      const hv = f.harvest;
                      const c = hv ? READY_COLOR[hv.readiness] : '#cfe3c6';
                      return (
                        <React.Fragment key={f.id}>
                          <Rectangle bounds={proj.rect(f.x, f.y, f.w, f.h)}
                            pathOptions={{ color: f.id === fieldId ? '#13311e' : '#ffffff', weight: f.id === fieldId ? 3 : 1.5, fillColor: c, fillOpacity: 0.9 }}
                            eventHandlers={{ click: () => { if (!picking) { setFieldId(f.id); setTab('harvest'); } } }}>
                            <Tooltip direction="center" permanent className="mm-field-label">{f.soil_no}</Tooltip>
                          </Rectangle>
                          {hv && hv.readiness === 'harvesting' && (
                            <Rectangle bounds={proj.rect(f.x, f.y, f.w * hv.harvested_pct / 100, f.h)} interactive={false}
                              pathOptions={{ stroke: false, fillColor: READY_COLOR.harvested, fillOpacity: 0.95 }} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </LayerGroup>
                </LayersControl.Overlay>
                <LayersControl.Overlay checked name="Road network">
                  <LayerGroup>
                    {map.roads.edges.map((e) => {
                      const a = nodeById[e.from_node];
                      const b = nodeById[e.to_node];
                      const st = { ...(ROAD_STYLE[e.road_class] || ROAD_STYLE.lane), ...(STATE_STYLE[e.road_state] || {}) };
                      if (blocked.has(e.id)) Object.assign(st, { color: '#d64545', dashArray: '2 6', weight: 2 });
                      return (
                        <Polyline key={e.id} positions={[proj.ll(a.x, a.y), proj.ll(b.x, b.y)]} pathOptions={{ ...st, opacity: 0.95, lineCap: 'round' }}>
                          <Tooltip sticky>{e.name} · {e.surface}, {e.width_m} m, ≤ {e.max_weight_t} t, {e.speed_limit_kmh} km/h · {e.road_state}
                            {e.note ? ' · ' + e.note : ''}</Tooltip>
                        </Polyline>
                      );
                    })}
                    {map.facilities.map((n) => (
                      <Marker key={n.id} position={proj.ll(n.x, n.y)} icon={FACILITY_ICON}>
                        <Tooltip direction="left" permanent className="mm-facility-label">{n.name}</Tooltip>
                      </Marker>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>
                <LayersControl.Overlay checked name="Machinery (live)">
                  <LayerGroup>
                    {shown.filter((m) => m.trail.length > 1).map((m) => (
                      <Polyline key={'t' + m.id} positions={proj.pts(m.trail.concat([[m.x, m.y]]))} interactive={false}
                        pathOptions={{ color: m.color || '#2a78d6', weight: 2, opacity: 0.7, dashArray: '3 4' }} />
                    ))}
                    {shown.map((m) => (
                      <Marker key={m.id} position={proj.ll(m.x, m.y)} icon={machineIcon(m, m.id === machineId)} zIndexOffset={m.id === machineId ? 1000 : 0}
                        eventHandlers={{ click: () => onMachineClick(m) }}>
                        <Tooltip direction="top" offset={[0, -12]}>{m.designation} · {m.status}{m.status === 'operating' && m.task ? ' · ' + m.task : ''}
                          {m.speed_kmh > 0 ? ' · ' + m.speed_kmh + ' km/h' : ''}</Tooltip>
                      </Marker>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>
              </LayersControl>
              {route && (
                <>
                  <Polyline positions={proj.pts(route.points)} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} interactive={false} />
                  {route.segments.map((s, i) => (
                    <Polyline key={i} positions={proj.pts(s.points)} interactive={false}
                      pathOptions={{ color: s.restricted ? '#d64545' : '#2a78d6', weight: 5, dashArray: s.road_class === 'off-road' ? '6 6' : null }} />
                  ))}
                </>
              )}
              {/* route pins sit above the permanent facility labels (tooltip pane, z-index 650) */}
              <Pane name="route-pins" style={{ zIndex: 660 }}>
                {route ? (
                  <>
                    <Marker position={proj.ll(route.from.x, route.from.y)} icon={endIcon('A')} />
                    <Marker position={proj.ll(route.to.x, route.to.y)} icon={endIcon('B')} />
                  </>
                ) : (
                  <>
                    {form.from.kind === 'point' && form.from.x !== undefined && <Marker position={proj.ll(form.from.x, form.from.y)} icon={endIcon('A')} />}
                    {form.to.kind === 'point' && form.to.x !== undefined && <Marker position={proj.ll(form.to.x, form.to.y)} icon={endIcon('B')} />}
                  </>
                )}
              </Pane>
            </MapContainer>
          </div>
          <div className="legend-row mm-legend2">
            {Object.keys(STATUS_COLOR).map((s) => <span key={s} style={{ '--c': STATUS_COLOR[s] }}>Machine {s}</span>)}
            <span style={{ '--c': STATE_STYLE.muddy.color }}>Muddy road</span>
            <span style={{ '--c': STATE_STYLE.rutted.color }}>Rutted road</span>
            <span style={{ '--c': STATE_STYLE.closed.color }}>Closed / not passable</span>
            <span style={{ '--c': '#2a78d6' }}>Route</span>
          </div>
        </Panel>
        <Panel title={<Tabs small active={tab} onChange={setTab} tabs={[
          { key: 'harvest', label: 'Harvest' }, { key: 'machinery', label: 'Machinery', badge: live.status_counts.operating || null },
          { key: 'route', label: 'Shortest path' }]} />}>
          {tab === 'harvest' && <HarvestPanel map={map} field={field} setFieldId={setFieldId} live={live.machines} />}
          {tab === 'machinery' && <MachineryPanel live={live} types={map.machine_types} machine={machine} setMachineId={setMachineId}
            filter={filter} setFilter={setFilter} onRouteFrom={routeFrom} />}
          {tab === 'route' && <RoutePanel map={map} live={live} form={form} setForm={setForm} picking={picking} setPicking={setPicking}
            route={route} setRoute={setRoute} />}
        </Panel>
      </div>
    </div>
  );
}
