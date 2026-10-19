// Header (date/time centred on every page) and permission-filtered navigation.
import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

export const NAV = [
  { key: 'home', label: 'Home', path: '/' },
  { label: 'Production management', children: [
    { key: 'layout', label: 'Variety layout plan', path: '/layout' },
    { key: 'annual', label: 'Annual production plan', path: '/plans/annual' },
    { key: 'monthly', label: 'Monthly production plan', path: '/plans/monthly' },
    { key: 'fifteen', label: '15-day production plan', path: '/plans/fifteen' },
    { key: 'five', label: '5-day production plan', path: '/plans/five' },
    { key: 'weather', label: 'Weather', path: '/weather' },
    { key: 'fulfilment', label: 'Fulfilment of plan', path: '/fulfilment' }
  ] },
  { label: 'Power management', children: [
    { key: 'power_consumption', label: 'Power consumption', path: '/power/consumption' },
    { key: 'power_system', label: 'Power system status', path: '/power/system' }
  ] },
  { label: 'Quality control', children: [
    { key: 'growth', label: 'Growth forecast', path: '/quality/growth' },
    { key: 'pest', label: 'Pest monitoring', path: '/quality/pests' }
  ] },
  { key: 'equipment', label: 'Equipment management', path: '/equipment' },
  { key: 'machinery_map', label: 'Harvest & machinery map', path: '/machinery-map' },
  { key: 'irrigation', label: 'Irrigation system', path: '/irrigation' },
  { key: 'diary', label: 'Production daily information', path: '/diary' },
  { key: 'decision', label: 'Decision support (ERP)', path: '/decision' },
  { key: 'admin', label: 'Authorization management', path: '/admin' }
];

export function allowed(user, key) {
  return !!user && (user.role === 'admin' || (user.permissions || []).indexOf(key) >= 0);
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

export function Header({ user, onLogout }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return (
    <header className="header">
      <div className="brand">Seed Farm MES · Smart Integrated Manufacturing System</div>
      <div className="clock" aria-live="off">
        <div className="date">{now.getFullYear()}-{pad(now.getMonth() + 1)}-{pad(now.getDate())} {days[now.getDay()]}</div>
        <div className="time">{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</div>
      </div>
      <div className="user">
        <span>{user.full_name} · {user.department_name}</span>
        <NavLink to="/edit-requests">Ratification</NavLink>
        <button onClick={onLogout}>Log out</button>
      </div>
    </header>
  );
}

export function Nav({ user }) {
  const loc = useLocation();
  const initial = {};
  NAV.forEach((n, i) => { if (n.children) initial[i] = n.children.some((c) => loc.pathname === c.path) || i === 1; });
  const [open, setOpen] = useState(initial);
  return (
    <nav className="nav" aria-label="Main navigation">
      {NAV.map((n, i) => {
        if (!n.children) {
          return allowed(user, n.key) ? <NavLink key={n.key} to={n.path} exact={n.path === '/'}>{n.label}</NavLink> : null;
        }
        const kids = n.children.filter((c) => allowed(user, c.key));
        if (!kids.length) return null;
        return (
          <div key={n.label}>
            <button className="group" onClick={() => setOpen({ ...open, [i]: !open[i] })} aria-expanded={!!open[i]}>
              {n.label}<span>{open[i] ? '▾' : '▸'}</span>
            </button>
            {open[i] && <div className="children">{kids.map((c) => <NavLink key={c.key} to={c.path}>{c.label}</NavLink>)}</div>}
          </div>
        );
      })}
    </nav>
  );
}
