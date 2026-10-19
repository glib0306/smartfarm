import React, { useEffect, useState } from 'react';
import { api, setToken } from '../api';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', full_name: '', department_id: '' });
  const [deps, setDeps] = useState([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => { if (mode === 'register') api('/auth/departments').then(setDeps).catch(() => {}); }, [mode]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    try {
      if (mode === 'login') {
        const r = await api('/auth/login', { method: 'POST', body: { username: form.username, password: form.password } });
        setToken(r.token);
        onLogin(r.user);
      } else {
        const r = await api('/auth/register', { method: 'POST', body: form });
        setInfo(r.message);
        setMode('login');
      }
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>Seed Farm MES</h1>
        <div className="muted small">Smart Integrated Manufacturing System · offline</div>
        <label>Username<input type="text" value={form.username} onChange={set('username')} autoFocus required /></label>
        <label>Password<input type="password" value={form.password} onChange={set('password')} required /></label>
        {mode === 'register' && (
          <>
            <label>Full name<input type="text" value={form.full_name} onChange={set('full_name')} required /></label>
            <label>Department
              <select value={form.department_id} onChange={set('department_id')} required>
                <option value="">Select…</option>
                {deps.map((d) => <option key={d.id} value={d.id}>{'— '.repeat(d.level - 1)}{d.name}</option>)}
              </select>
            </label>
          </>
        )}
        {error && <div className="error-text">{error}</div>}
        {info && <div className="info-box">{info}</div>}
        <button className="btn btn-primary" type="submit">{mode === 'login' ? 'Log in' : 'Request account'}</button>
        <button className="btn" type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Request a new account' : 'Back to login'}
        </button>
        <div className="small muted">Demo accounts (password 1234): admin, director, rice_div, leader5</div>
      </form>
    </div>
  );
}
