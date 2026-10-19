// Annual / monthly / 15-day / 5-day production plan pages (tab structure of plan variants).
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import PlanView from '../components/PlanView';
import { Loading, PageTitle, Select, Warning, notifyError } from '../components/ui';

function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function usePlan(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api(path).then(setData).catch((e) => { setError(e.message); notifyError(e); });
  }, [path]);
  useEffect(() => { setData(null); load(); }, [load]);
  return [data, load, error];
}

function Body({ data, error, layout, reload, children }) {
  if (error) return <Warning>{error}</Warning>;
  if (!data) return <Loading text="Loading plans (variants are generated and optimised on first visit)..." />;
  return (
    <>
      {children}
      {data.warning && <Warning>{data.warning}</Warning>}
      {data.warning_split && <Warning>{data.warning_split}</Warning>}
      {data.info && !data.warning && <div className="info-box">{data.info}</div>}
      {data.parent && (
        <div className="small muted" style={{ marginBottom: 8 }}>
          Based on the approved {data.parent.plan_type} plan “{data.parent.variant_name}” ({data.parent.period_start} .. {data.parent.period_end})
          and material consumption norms. Plan period {data.period.start} .. {data.period.end}{data.days ? ` (${data.days} days)` : ''}.
        </div>
      )}
      {data.plans && data.plans.length > 0 && <PlanView data={data} layout={layout} onReload={reload} />}
    </>
  );
}

export function AnnualPlan() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, reload, error] = usePlan('/plans/annual?year=' + year);
  const years = [year - 1, year, year + 1].map((y) => ({ value: y, label: String(y) }));
  return (
    <div>
      <PageTitle right={<Select label="Year" value={year} onChange={(v) => setYear(parseInt(v, 10))} options={years} />}>Annual production plan</PageTitle>
      <Body data={data} error={error} layout="annual" reload={reload}>
        {data && data.submitted_id && <div className="info-box">A plan of {year} has been submitted to ERP. Monthly production orders are issued from it.</div>}
      </Body>
    </div>
  );
}

export function MonthlyPlan() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [data, reload, error] = usePlan('/plans/monthly?date=' + month + '-01');
  return (
    <div>
      <PageTitle right={<label className="field-inline">Month <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>}>
        Monthly production plan
      </PageTitle>
      <Body data={data} error={error} layout="monthly" reload={reload} />
    </div>
  );
}

export function FifteenPlan() {
  const [date, setDate] = useState(today());
  const [dept, setDept] = useState('');
  const [split, setSplit] = useState('');
  const q = '/plans/fifteen?date=' + date + (dept ? '&department_id=' + dept : '') + (split ? '&split=' + split : '');
  const [data, reload, error] = usePlan(q);
  const deps = (data && data.departments) || [];
  return (
    <div>
      <PageTitle right={
        <div className="row">
          {deps.length > 0 && <Select label="Department" value={dept || (data && data.department_id)} onChange={setDept}
            options={deps.map((d) => ({ value: d.id, label: d.name }))} />}
          <label className="field-inline">Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <Select label="First period ends on day" value={split} onChange={setSplit}
            options={[{ value: '', label: 'default' }, { value: 14, label: '14' }, { value: 15, label: '15' }, { value: 16, label: '16' }]} />
        </div>}>
        15-day production plan
      </PageTitle>
      <Body data={data} error={error} layout="fifteen" reload={reload} />
    </div>
  );
}

export function FivePlan() {
  const [date, setDate] = useState(today());
  const [dept, setDept] = useState('');
  const [data, reload, error] = usePlan('/plans/five?date=' + date + (dept ? '&department_id=' + dept : ''));
  const deps = (data && data.departments) || [];
  return (
    <div>
      <PageTitle right={
        <div className="row">
          {deps.length > 0 && <Select label="Department" value={dept || (data && data.department_id)} onChange={setDept}
            options={deps.map((d) => ({ value: d.id, label: d.name }))} />}
          <label className="field-inline">Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>}>
        5-day production plan
      </PageTitle>
      <Body data={data} error={error} layout="five" reload={reload} />
    </div>
  );
}
