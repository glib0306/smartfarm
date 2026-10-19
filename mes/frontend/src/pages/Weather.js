// Weather: micro-meteorological sensors, ACS meteorological data, forecast and soil sensor data.
import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { DataTable, Loading, PageTitle, Panel, notifyError } from '../components/ui';

export function WeatherIcon({ kind, size = 72 }) {
  const s = size;
  if (kind === 'sunny') {
    return (
      <svg width={s} height={s} viewBox="0 0 64 64" aria-label="sunny">
        <circle cx="32" cy="32" r="12" fill="#f5b400" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <line key={a} x1="32" y1="8" x2="32" y2="15" stroke="#f5b400" strokeWidth="4" strokeLinecap="round" transform={`rotate(${a} 32 32)`} />
        ))}
      </svg>
    );
  }
  const cloud = <path d="M18 44h28a10 10 0 0 0 0-20 14 14 0 0 0-27-2A11 11 0 0 0 18 44z" fill="#9aa8b5" />;
  if (kind === 'cloudy') return <svg width={s} height={s} viewBox="0 0 64 64" aria-label="cloudy">{cloud}</svg>;
  if (kind === 'rain') {
    return (
      <svg width={s} height={s} viewBox="0 0 64 64" aria-label="rain">
        {cloud}
        {[22, 32, 42].map((x) => <path key={x} d={`M${x} 49 q-3 6 0 8 q3 -2 0 -8z`} fill="#2a78d6" />)}
      </svg>
    );
  }
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" aria-label="snow">
      {cloud}
      {[22, 32, 42].map((x) => (
        <g key={x} stroke="#5aa0e6" strokeWidth="2" strokeLinecap="round">
          <line x1={x} y1="48" x2={x} y2="58" /><line x1={x - 4} y1="51" x2={x + 4} y2="55" /><line x1={x - 4} y1="55" x2={x + 4} y2="51" />
        </g>
      ))}
    </svg>
  );
}

export default function Weather() {
  const [d, setD] = useState(null);
  useEffect(() => {
    const load = () => api('/farm/weather').then(setD).catch(notifyError);
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  if (!d) return <Loading />;
  const t = d.today;
  return (
    <div>
      <PageTitle right={<span className="small muted">Rain last 30 d: {d.analysis.rain_30d} mm · GDD(10 °C) last 30 d: {d.analysis.gdd10_30d}</span>}>Weather</PageTitle>
      {d.alerts.length > 0 && (
        <div className="warning-box">{d.alerts.slice(0, 6).map((a, i) => <div key={i}>• {a.text}</div>)}{d.alerts.length > 6 && <div>… {d.alerts.length - 6} more</div>}</div>
      )}
      <div className="grid g2">
        <Panel title="Micrometeorological Climate">
          <DataTable rowKey={(r) => r.sensor_no} rows={d.micro} columns={[
            { key: 'sensor_no', label: 'Sensor no.' }, { key: 'location', label: 'Location' },
            { key: 'measured_at', label: 'Measured at' },
            { key: 'temperature', label: 'Temp °C', align: 'right' }, { key: 'humidity', label: 'Humidity %', align: 'right' },
            { key: 'wind_speed', label: 'Wind m/s', align: 'right' }, { key: 'rainfall', label: 'Rain mm', align: 'right' },
            { key: 'solar_radiation', label: 'Solar W/m²', align: 'right' }
          ]} />
        </Panel>
        <Panel title="Meteorological Data" extra={<span className="small muted">ACS · {t && t.obs_date}</span>}>
          {t ? (
            <div className="weather-now">
              <WeatherIcon kind={t.conditions} size={110} />
              <div>
                <div className="big">{t.t_avg} °C</div>
                <div className="temps">
                  <span className="muted">Maximum</span><span>{t.t_max} °C</span>
                  <span className="muted">Minimum</span><span>{t.t_min} °C</span>
                  <span className="muted">Average</span><span>{t.t_avg} °C</span>
                  <span className="muted">Humidity</span><span>{t.humidity} %</span>
                  <span className="muted">Rainfall</span><span>{t.rainfall} mm</span>
                  <span className="muted">Conditions</span><span style={{ textTransform: 'capitalize' }}>{t.conditions}</span>
                </div>
              </div>
            </div>
          ) : <span className="muted">No ACS data</span>}
        </Panel>
        <Panel title="Weather Forecast Data">
          <DataTable rowKey={(r) => r.forecast_date} rows={d.forecast} columns={[
            { key: 'forecast_date', label: 'Date' },
            { key: 'conditions', label: '', render: (r) => <WeatherIcon kind={r.conditions} size={22} /> },
            { key: 't_max', label: 'Max °C', align: 'right' }, { key: 't_min', label: 'Min °C', align: 'right' },
            { key: 't_avg', label: 'Avg °C', align: 'right' }, { key: 'humidity', label: 'Humidity %', align: 'right' }
          ]} />
        </Panel>
        <Panel title="Soil and water">
          <DataTable rowKey={(r) => r.soil_no} rows={d.soil} columns={[
            { key: 'soil_no', label: 'Soil no.' }, { key: 'water_level_cm', label: 'Water level cm', align: 'right' },
            { key: 'moisture_pct', label: 'Soil moisture %', align: 'right' }, { key: 'soil_temp', label: 'Soil temp °C', align: 'right' },
            { key: 'water_temp', label: 'Water temp °C', align: 'right' }
          ]} />
        </Panel>
      </div>
    </div>
  );
}
