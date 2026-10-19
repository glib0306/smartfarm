// Small shared UI building blocks: notifications, tabs, panels, tables, modal, select helpers.
import React, { useEffect, useState } from 'react';

// ---------------------------------------------------------------- notifications
const listeners = new Set();
export function notify(text, kind = 'success') {
  const n = { id: Date.now() + Math.random(), text, kind };
  listeners.forEach((l) => l(n));
}
export function notifyError(e) { notify(e.message || String(e), e.warning ? 'warning' : 'error'); }

export function Notifier() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const l = (n) => {
      setItems((s) => [...s, n]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== n.id)), n.kind === 'success' ? 4000 : 7000);
    };
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return (
    <div className="notifier">
      {items.map((n) => (
        <div key={n.id} className={'toast toast-' + n.kind} onClick={() => setItems((s) => s.filter((x) => x.id !== n.id))}>
          <strong>{n.kind === 'warning' ? 'Warning' : n.kind === 'error' ? 'Error' : 'Notice'}</strong>
          <span>{n.text}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- layout primitives
export function Panel({ title, extra, children, className = '', style }) {
  return (
    <section className={'panel ' + className} style={style}>
      {(title || extra) && (
        <header className="panel-head">
          <h3>{title}</h3>
          <div className="panel-extra">{extra}</div>
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Tabs({ tabs, active, onChange, small }) {
  return (
    <div className={'tabs' + (small ? ' tabs-small' : '')} role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={active === t.key}
          className={'tab' + (active === t.key ? ' active' : '')} onClick={() => onChange(t.key)}>
          {t.label}{t.badge ? <span className="badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function PageTitle({ children, right }) {
  return (
    <div className="page-title">
      <h2>{children}</h2>
      <div>{right}</div>
    </div>
  );
}

export function Warning({ children }) {
  return <div className="warning-box" role="alert">{children}</div>;
}

export function Loading({ text = 'Loading...' }) {
  return <div className="loading">{text}</div>;
}

export function DataTable({ columns, rows, empty = 'No data', rowKey, onRowClick, selectedKey, maxHeight }) {
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={{ textAlign: c.align || 'left' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="empty">{empty}</td></tr>}
          {rows.map((r, i) => {
            const k = rowKey ? rowKey(r) : i;
            return (
              <tr key={k} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={(onRowClick ? 'clickable ' : '') + (selectedKey !== undefined && selectedKey === k ? 'selected' : '')}>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align || 'left' }}>{c.render ? c.render(r) : fmt(r[c.key])}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function fmt(v, digits = 2) {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: digits });
  return String(v);
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={'modal' + (wide ? ' modal-wide' : '')} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-head"><h3>{title}</h3><button className="btn-icon" onClick={onClose} aria-label="Close">×</button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Select({ label, value, onChange, options, style }) {
  return (
    <label className="field-inline" style={style}>
      {label && <span>{label}</span>}
      <select value={value === null || value === undefined ? '' : value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function StatusPill({ status }) {
  return <span className={'pill pill-' + status}>{status}</span>;
}

// Series palette (validated categorical order) shared by all charts.
export const SERIES = ['#2a78d6', '#e07b39', '#2f9e6f', '#c94f7c', '#7b61c9', '#c9a227', '#3fa7b5', '#8a6d4f',
  '#d1495b', '#5c8a2e', '#4d6fa8', '#b8735a'];
export const color = (i) => SERIES[i % SERIES.length];
