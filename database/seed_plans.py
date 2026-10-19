# -*- coding: utf-8 -*-
# Executed inside generate_sql.py (shares its namespace).
# Seeds: ERP ratification of annual Variant A, approved monthly / 15-day / 5-day plan chain for the
# previous and current month (dates absolute, anchored at generation day), and daily production reports.
# Plan derivation uses analytics.models.derive_plan - the same routine the MES backend calls.

NORM_MAP = {}
for n in norms:
    NORM_MAP[n[0] + "|" + n[2]] = {"labor_manual": n[5], "labor_mech": n[6], "machine_h": n[7], "equipment_type": n[8],
                                   "material": n[9], "material_per_ha": n[10], "material_unit": n[11],
                                   "material_price": n[12]}
EQ_COUNT = {}
for e in equipment:
    if e[4] != "repair":
        EQ_COUNT[e[2]] = EQ_COUNT.get(e[2], 0) + 1
TOTAL_AREA = sum(m["area"] for m in field_meta.values())
CHILDREN = {1: [2, 3, 4], 2: [5, 6], 3: [7, 8], 4: [9, 10]}


def dept_share(dep):
    teams = [dep] if dep >= 5 else (CHILDREN.get(dep, []) if dep > 1 else list(range(5, 11)))
    a = sum(m["area"] for m in field_meta.values() if m["dep"] in teams)
    return a / TOTAL_AREA if TOTAL_AREA else 0


def capacity(days, share):
    return {k: v * 10 * days * 0.8 * share for k, v in EQ_COUNT.items()}


def month_bounds(day):
    first = day.replace(day=1)
    nxt = (first + datetime.timedelta(days=32)).replace(day=1)
    return first, nxt - datetime.timedelta(days=1)


def fifteen_periods(first, last, split=15):
    return [(first, first.replace(day=split)), (first.replace(day=split + 1), last)]


def five_periods(s, e):
    return [(s, s + datetime.timedelta(days=4)), (s + datetime.timedelta(days=5), s + datetime.timedelta(days=9)),
            (s + datetime.timedelta(days=10), e)]


seed_plans, seed_tasks, seed_res, seed_five = [], [], [], []
next_pid = [pid]


def make_plan(ptype, parent_id, dep, parent_tasks, ps, pe, dep_ids, approve_idx=1):
    days = (pe - ps).days + 1
    res = derive_plan({"parent_tasks": parent_tasks, "period_start": ps.isoformat(), "period_end": pe.isoformat(),
                       "department_ids": dep_ids, "norms": NORM_MAP,
                       "equipment_capacity": capacity(days, dept_share(dep)),
                       "prices": {"labor_md": 12, "machine_h": 25},
                       "revenue_per_ha": {"rice": 9990.0, "wheat": 5720.0}, "yield_per_ha": {"rice": 7.4, "wheat": 5.2},
                       "process_count": {"rice": 11, "wheat": 10}})
    approved = None
    for vi, v in enumerate(res["variants"]):
        next_pid[0] += 1
        plan_id = next_pid[0]
        st = "approved" if vi == approve_idx else "draft"
        seed_plans.append((plan_id, ptype, parent_id, dep, vi + 1, v["name"], ps.isoformat(), pe.isoformat(), st,
                           2 if st == "approved" else None,
                           (datetime.datetime.combine(ps, datetime.time(8)) - datetime.timedelta(days=1)).isoformat(" ")
                           if st == "approved" else None, v["mech_ratio"], v["yield_t"], v["cost"]["total"],
                           v["revenue"], v["efficiency"],
                           (datetime.datetime.combine(ps, datetime.time(7)) - datetime.timedelta(days=2)).isoformat(" ")))
        tlist = []
        for t in res["tasks"]:
            rec = [plan_id, t["crop"], t["process"], t["department_id"], t["start_date"], t["end_date"], t["planned_qty"], 0.0]
            seed_tasks.append(rec)
            tlist.append(rec)
        for r in v["resources"]:
            seed_res.append((plan_id, r["process"], r["resource_type"], r["name"], r["quantity"], r["unit"], r["cost"]))
        if st == "approved":
            approved = (plan_id, [dict(crop=x[1], process=x[2], department_id=x[3], start_date=x[4], end_date=x[5],
                                       planned_qty=x[6]) for x in tlist], tlist)
    return approved


reports = []
first_cur, last_cur = month_bounds(TODAY)
first_prev, last_prev = month_bounds(first_cur - datetime.timedelta(days=1))
for (mf, ml) in [(first_prev, last_prev), (first_cur, last_cur)]:
    monthly = make_plan("monthly", 1, 1, annual_a_tasks, mf, ml, None)
    if not monthly:
        continue
    for (fs, fe) in fifteen_periods(mf, ml):
        if fs > TODAY:
            continue
        for div in (2, 3):
            fif = make_plan("fifteen", monthly[0], div, monthly[1], fs, fe, CHILDREN[div])
            if not fif:
                continue
            for (vs, ve) in five_periods(fs, fe):
                if vs > TODAY:
                    continue
                for team in CHILDREN[div]:
                    five = make_plan("five", fif[0], team, fif[1], vs, ve, [team])
                    if not five:
                        continue
                    # daily reports of every farmer until yesterday
                    total_plan = sum(x[6] for x in five[2])
                    days = (ve - vs).days + 1
                    fl = farmers[team]
                    exec_sum = 0.0
                    day = vs
                    while day <= ve and day < TODAY:
                        for f_id in fl:
                            pq = round(total_plan / days / len(fl), 2)
                            eq_ = round(pq * random.uniform(0.72, 1.12), 2)
                            exec_sum += eq_
                            ts = datetime.datetime.combine(day, datetime.time(18)).isoformat(" ")
                            reports.append((team, f_id, day.isoformat(), five[0], pq, eq_, team_leaders[team], ts, ts))
                        day += datetime.timedelta(days=1)
                    for rec in five[2]:
                        rec[7] = round(exec_sum * rec[6] / total_plan, 2) if total_plan else 0.0

insert("production_plans", ["id", "plan_type", "parent_id", "department_id", "variant_no", "variant_name",
                            "period_start", "period_end", "status", "status_by", "status_at", "mech_ratio",
                            "expected_yield_t", "expected_cost", "expected_revenue", "efficiency", "created_at"],
       seed_plans)
insert("plan_tasks", ["plan_id", "crop", "process", "department_id", "start_date", "end_date", "planned_qty",
                      "executed_qty"], [tuple(t) for t in seed_tasks], chunk=400)
insert("plan_resources", ["plan_id", "process", "resource_type", "name", "quantity", "unit", "cost"], seed_res, chunk=400)
insert("daily_reports", ["department_id", "farmer_id", "report_date", "five_plan_id", "plan_qty", "exec_qty",
                         "created_by", "created_at", "updated_at"], reports, chunk=400)

erp_payload = {"plan_id": 1, "plan_type": "annual", "variant": "Variant A - balanced", "ratified": True,
               "note": "Annual production plan ratified by ERP (virtual seed record)"}
insert("erp_submissions", ["ref_type", "ref_id", "payload", "status", "submitted_by", "submitted_at"],
       [("plan", 1, json.dumps(erp_payload), "submitted", 2, dt(-20, 10))])
print("seeded %d plans, %d tasks, %d daily reports" % (len(seed_plans), len(seed_tasks), len(reports)))
