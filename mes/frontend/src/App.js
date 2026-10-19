import React, { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Redirect, Route, Switch } from 'react-router-dom';
import { api, setToken, getToken } from './api';
import { Header, Nav, allowed } from './components/Shell';
import { Notifier, Loading } from './components/ui';
import Login from './pages/Login';
import Home from './pages/Home';
import VarietyLayout from './pages/VarietyLayout';
import { AnnualPlan, MonthlyPlan, FifteenPlan, FivePlan } from './pages/PlanPages';
import Weather from './pages/Weather';
import Fulfilment from './pages/Fulfilment';
import GrowthForecast from './pages/GrowthForecast';
import PestMonitoring from './pages/PestMonitoring';
import { PowerConsumption, PowerSystem } from './pages/Power';
import Equipment from './pages/Equipment';
import MachineryMap from './pages/MachineryMap';
import Irrigation from './pages/Irrigation';
import Diary from './pages/Diary';
import Admin from './pages/Admin';
import Decision from './pages/Decision';
import EditRequests from './pages/EditRequests';

const ROUTES = [
  { path: '/', key: 'home', component: Home, exact: true },
  { path: '/layout', key: 'layout', component: VarietyLayout },
  { path: '/plans/annual', key: 'annual', component: AnnualPlan },
  { path: '/plans/monthly', key: 'monthly', component: MonthlyPlan },
  { path: '/plans/fifteen', key: 'fifteen', component: FifteenPlan },
  { path: '/plans/five', key: 'five', component: FivePlan },
  { path: '/weather', key: 'weather', component: Weather },
  { path: '/fulfilment', key: 'fulfilment', component: Fulfilment },
  { path: '/quality/growth', key: 'growth', component: GrowthForecast },
  { path: '/quality/pests', key: 'pest', component: PestMonitoring },
  { path: '/power/consumption', key: 'power_consumption', component: PowerConsumption },
  { path: '/power/system', key: 'power_system', component: PowerSystem },
  { path: '/equipment', key: 'equipment', component: Equipment },
  { path: '/machinery-map', key: 'machinery_map', component: MachineryMap },
  { path: '/irrigation', key: 'irrigation', component: Irrigation },
  { path: '/diary', key: 'diary', component: Diary },
  { path: '/decision', key: 'decision', component: Decision },
  { path: '/admin', key: 'admin', component: Admin }
];

function NoAccess() {
  return <div className="warning-box">Your identifier does not have permission for this page.</div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(!!getToken());

  const logout = useCallback(() => { setToken(''); setUser(null); }, []);

  useEffect(() => {
    window.addEventListener('mes-logout', logout);
    if (getToken()) {
      api('/auth/me').then((r) => setUser(r.user)).catch(() => setToken('')).finally(() => setChecking(false));
    }
    return () => window.removeEventListener('mes-logout', logout);
  }, [logout]);

  if (checking) return <Loading text="Connecting to MES server..." />;
  if (!user) return (<><Login onLogin={(u) => setUser(u)} /><Notifier /></>);

  const firstAllowed = ROUTES.find((r) => allowed(user, r.key));
  return (
    <BrowserRouter>
      <div className="app">
        <Header user={user} onLogout={logout} />
        <Nav user={user} />
        <main className="main">
          <Switch>
            {ROUTES.map((r) => (
              <Route key={r.path} path={r.path} exact={r.exact}
                render={() => (allowed(user, r.key) ? <r.component user={user} />
                  : (r.path === '/' && firstAllowed ? <Redirect to={firstAllowed.path} /> : <NoAccess />))} />
            ))}
            <Route path="/edit-requests" render={() => <EditRequests user={user} />} />
            <Route render={() => <Redirect to="/" />} />
          </Switch>
        </main>
      </div>
      <Notifier />
    </BrowserRouter>
  );
}
