// SVG farm map: fields with soil numbers, roads/canals backdrop, overlays and a legend in the lower-left corner.
import React from 'react';

export const VIEW_W = 1100;
export const VIEW_H = 700;

export default function FarmMap({ fields, fillFor, labelFor, subFor, onFieldClick, selectedId, legend, children,
  onFieldDragOver, onFieldDrop, renderFieldExtra, height }) {
  return (
    <svg className="farm-map" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="Farm map" style={height ? { maxHeight: height } : undefined}>
      {/* backdrop: river, road and service area */}
      <rect x="0" y="0" width="14" height={VIEW_H} fill="#9cc7e6" />
      <rect x="512" y="40" width="36" height="560" fill="#d8d2c4" />
      <rect x="1005" y="20" width="90" height="660" rx="8" fill="#dfe5dc" />
      <text x="1050" y="16" textAnchor="middle" className="sub">Service area</text>
      {fields.map((f) => {
        const lines = labelFor ? [].concat(labelFor(f)) : [f.soil_no];
        return (
          <g key={f.id}
            onClick={onFieldClick ? () => onFieldClick(f) : undefined}
            onDragOver={onFieldDragOver ? (e) => { e.preventDefault(); onFieldDragOver(f, e); } : undefined}
            onDrop={onFieldDrop ? (e) => { e.preventDefault(); onFieldDrop(f, e); } : undefined}>
            <rect className={'field' + (selectedId === f.id ? ' selected' : '')} x={f.x} y={f.y} width={f.w} height={f.h} rx="4"
              fill={fillFor ? fillFor(f) : '#9ccc9c'}>
              <title>{f.soil_no}</title>
            </rect>
            <text x={f.x + 6} y={f.y + 15} className="lbl">{lines[0]}</text>
            {lines.slice(1).map((l, i) => <text key={i} x={f.x + 6} y={f.y + 30 + i * 13} className="sub">{l}</text>)}
            {subFor && <text x={f.x + f.w - 6} y={f.y + f.h - 6} textAnchor="end" className="sub">{subFor(f)}</text>}
            {renderFieldExtra && renderFieldExtra(f)}
          </g>
        );
      })}
      {children}
      {legend && legend.length > 0 && <Legend items={legend} />}
    </svg>
  );
}

// Legend drawn at the bottom-left of the map.
export function Legend({ items }) {
  const perRow = 4;
  const rows = Math.ceil(items.length / perRow);
  const h = rows * 20 + 12;
  return (
    <g transform={`translate(20, ${VIEW_H - h - 8})`}>
      <rect width={perRow * 118 + 12} height={h} rx="6" fill="#ffffff" opacity="0.93" stroke="#c9d3cb" />
      {items.map((it, i) => (
        <g key={i} transform={`translate(${10 + (i % perRow) * 118}, ${10 + Math.floor(i / perRow) * 20})`}>
          {it.shape === 'circle' ? <circle cx="7" cy="7" r="6" fill={it.color} /> : <rect width="14" height="14" rx="3" fill={it.color} />}
          <text x="20" y="11" style={{ fontSize: 11 }} fill="#1d2a22">{it.label}</text>
        </g>
      ))}
    </g>
  );
}

export const STATUS_COLORS = { normal: '#5cb85c', abnormal: '#d64545', harvest: '#f2c230', disease: '#d64545', pest: '#f2c230' };
