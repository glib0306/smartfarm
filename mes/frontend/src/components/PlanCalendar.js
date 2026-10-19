// Production plan in calendar form: a month calendar for short plans, a month-by-process calendar for the annual plan.
import React from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function parse(s) { const p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function uniqueProcesses(tasks) {
  const map = new Map();
  tasks.forEach((t) => {
    const k = t.crop + '|' + t.process;
    const cur = map.get(k);
    if (!cur) map.set(k, { crop: t.crop, process: t.process, start: t.start_date, end: t.end_date, qty: t.planned_qty });
    else {
      if (t.start_date < cur.start) cur.start = t.start_date;
      if (t.end_date > cur.end) cur.end = t.end_date;
      cur.qty += t.planned_qty;
    }
  });
  return Array.from(map.values()).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.crop < b.crop ? -1 : 1));
}

function YearCalendar({ start, tasks }) {
  const year = parse(start).getFullYear();
  const now = new Date();
  const rows = uniqueProcesses(tasks);
  return (
    <div className="table-wrap" style={{ maxHeight: 380 }}>
      <table className="gantt">
        <thead>
          <tr><th style={{ textAlign: 'left' }}>Process</th>{MONTHS.map((m) => <th key={m}>{m}</th>)}<th>ha</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.crop + r.process}>
              <td className="p">{r.crop === 'rice' ? '🌾 ' : '🌿 '}{r.process}</td>
              {MONTHS.map((m, i) => {
                const ms = ymd(new Date(year, i, 1));
                const me = ymd(new Date(year, i + 1, 0));
                const on = r.start <= me && r.end >= ms;
                const isNow = now.getFullYear() === year && now.getMonth() === i;
                return <td key={m} className={(on ? 'on-' + r.crop : '') + (isNow ? ' now' : '')} title={on ? `${r.process}: ${r.start} .. ${r.end}` : ''} />;
              })}
              <td>{Math.round(r.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthGrid({ year, month, start, end, tasks }) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const offset = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d));
  const today = ymd(new Date());
  const procs = uniqueProcesses(tasks);
  return (
    <div className="cal-month">
      <h4>{MONTHS[month]} {year}</h4>
      <div className="cal">
        {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
        {cells.map((c, i) => {
          if (!c) return <div key={'e' + i} />;
          const s = ymd(c);
          const inside = s >= start && s <= end;
          const active = inside ? procs.filter((p) => p.start <= s && p.end >= s) : [];
          return (
            <div key={s} className={'day' + (inside ? '' : ' out') + (s === today ? ' today' : '')}>
              <div className="n">{c.getDate()}</div>
              {active.slice(0, 3).map((p) => <span key={p.crop + p.process} className={'chip chip-' + p.crop} title={p.process}>{p.process}</span>)}
              {active.length > 3 && <span className="muted">+{active.length - 3} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PlanCalendar({ start, end, tasks }) {
  const s = parse(start);
  const e = parse(end);
  const days = Math.round((e - s) / 86400000) + 1;
  if (days > 62) return <YearCalendar start={start} tasks={tasks} />;
  const months = [];
  for (let d = new Date(s.getFullYear(), s.getMonth(), 1); d <= e; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push([d.getFullYear(), d.getMonth()]);
  }
  return (
    <div>
      {months.map(([y, m]) => <MonthGrid key={y + '-' + m} year={y} month={m} start={start} end={end} tasks={tasks} />)}
      <div className="legend-row"><span style={{ '--c': '#2f9e6f' }}>Rice</span><span style={{ '--c': '#c9a227' }}>Wheat</span></div>
    </div>
  );
}
