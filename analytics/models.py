# -*- coding: utf-8 -*-
"""Domain models used by MES and CPS. Every public function takes a dict and returns a JSON-serialisable dict."""
import math
import random

from mathlib import BPNet, mean, pls1, rmse, simplex, std


# ============================================================================ growth (leaf / tiller)
def _gdd_series(temps, base):
    acc, out = 0.0, []
    for t in temps:
        acc += max(0.0, t - base)
        out.append(acc)
    return out


def _tiller(das, tm, r, d0):
    return tm / (1.0 + math.exp(-r * (das - d0)))


def fit_field(f):
    """Self-learning step: calibrate leaf & tiller parameters to the field's own survey data."""
    cv = f["cultivar"]
    gdd = _gdd_series(f["past_temps"], cv["base_temp"])
    surveys = [s for s in f.get("surveys", []) if 0 < s["das"] <= len(gdd)]
    # leaf: leaf = min(maxL, k * GDD / phyllochron); least squares through origin for k
    xs, ys = [], []
    for s in surveys:
        if s["leaf"] < cv["max_leaves"] * 0.98:
            xs.append(gdd[s["das"] - 1] / cv["phyllochron"])
            ys.append(s["leaf"])
    k = (sum(x * y for x, y in zip(xs, ys)) / sum(x * x for x in xs)) if xs and sum(x * x for x in xs) > 0 else 1.0
    k = max(0.6, min(1.4, k))
    # tiller: grid search on (r, d0), closed-form Tm
    best = None
    tsurv = [(s["das"], s["tiller"]) for s in surveys]
    if tsurv:
        for r in [0.04 + 0.01 * i for i in range(13)]:
            for d0 in range(15, 61, 2):
                g = [1.0 / (1.0 + math.exp(-r * (d - d0))) for d, _ in tsurv]
                den = sum(v * v for v in g)
                if den <= 0:
                    continue
                tm = sum(v * y for v, (_, y) in zip(g, tsurv)) / den
                err = sum((tm * v - y) ** 2 for v, (_, y) in zip(g, tsurv))
                if best is None or err < best[0]:
                    best = (err, tm, r, d0)
    if best is None:
        best = (0.0, cv["max_tillers"], 0.09, 35)
    _, tm, r, d0 = best
    leaf_fit = [min(cv["max_leaves"], k * gdd[s["das"] - 1] / cv["phyllochron"]) for s in surveys]
    till_fit = [_tiller(s["das"], tm, r, d0) for s in surveys]
    return {
        "leaf_k": round(k, 4), "tm": round(tm, 3), "r": round(r, 3), "d0": d0,
        "rmse_leaf": round(rmse(leaf_fit, [s["leaf"] for s in surveys]), 3),
        "rmse_tiller": round(rmse(till_fit, [s["tiller"] for s in surveys]), 3),
        "samples": len(surveys), "gdd_today": gdd[-1] if gdd else 0.0,
    }


def _project(f, p, future_temps, horizon, adj=None):
    """Projects leaf & tiller numbers day by day after today. adj = optional modifiers (CPS response measures)."""
    adj = adj or {}
    cv = f["cultivar"]
    g = p["gdd_today"]
    das0 = f["das_today"]
    out = []
    ramp_days = float(adj.get("ramp_days", 14.0))  # measures and stresses act gradually, not overnight

    def phased(key, day):
        f = adj.get(key, 1.0)
        return 1.0 + (f - 1.0) * min(1.0, day / ramp_days) if ramp_days > 0 else f

    for day in range(1, horizon + 1):
        tm = p["tm"] * phased("tiller_factor", day)
        k = p["leaf_k"] * phased("leaf_factor", day)
        t = future_temps[day - 1] if day - 1 < len(future_temps) else (future_temps[-1] if future_temps else 15.0)
        t += adj.get("temp_shift", 0.0)
        g += max(0.0, t - cv["base_temp"]) * adj.get("gdd_factor", 1.0)
        das = das0 + day
        leaf = min(cv["max_leaves"], k * g / cv["phyllochron"])
        till = _tiller(das, tm, p["r"], p["d0"])
        mat = cv.get("maturity_days", 130)
        if das > mat * 0.6:
            till *= max(0.6, 1 - 0.15 * (das - mat * 0.6) / (mat * 0.4))
        till *= phased("pest_factor", day)
        out.append({"day": day, "das": das, "leaf": round(leaf, 2), "tiller": round(till, 2)})
    return out


def growth_forecast(data):
    horizon = int(data.get("horizon", 30))
    future = data.get("future_temps", [])
    fields_out, by_cv = [], {}
    for f in data["fields"]:
        p = fit_field(f)
        fields_out.append({"field_id": f["field_id"], "soil_no": f.get("soil_no"), "params": p,
                           "series": _project(f, p, future, horizon)})
        by_cv.setdefault(f["cultivar"]["id"], []).append(p)
    models = []
    for cid, ps in by_cv.items():
        models.append({"cultivar_id": cid, "samples": sum(x["samples"] for x in ps),
                       "rmse": round(mean([x["rmse_leaf"] + x["rmse_tiller"] for x in ps]) / 2.0, 4),
                       "params": {"leaf_k": round(mean([x["leaf_k"] for x in ps]), 4),
                                  "tm": round(mean([x["tm"] for x in ps]), 3),
                                  "r": round(mean([x["r"] for x in ps]), 3),
                                  "d0": round(mean([x["d0"] for x in ps]), 1)}})
    return {"fields": fields_out, "models": models}


def reach_date(data):
    """Days until the cultivar's mean leaf / tiller number reaches the target."""
    kind = data.get("kind", "leaf")
    target = float(data["target"])
    future = data.get("future_temps", [])
    max_days = int(data.get("max_days", 150))
    series_all = []
    for f in data["fields"]:
        p = fit_field(f)
        series_all.append(_project(f, p, future, max_days))
    if not series_all:
        return {"series": [], "reached_day": None}
    current = mean([fit_field(f)["gdd_today"] for f in data["fields"]])  # noqa (kept for transparency)
    out, reached = [], None
    for i in range(max_days):
        v = mean([s[i][kind] for s in series_all])
        out.append({"day": i + 1, "value": round(v, 2)})
        if v >= target:
            reached = i + 1
            break
    return {"series": out, "reached_day": reached, "max_value": out[-1]["value"] if out else None,
            "gdd_today": round(current, 1)}


# ============================================================================ production plan optimisation (LP)
def optimize_plan(data):
    tasks = data["tasks"]
    prices = data.get("prices", {})
    p_lab = float(prices.get("labor_md", 12))
    p_mach = float(prices.get("machine_h", 25))
    cap = data.get("equipment_capacity", {})
    rev_ha = data.get("revenue_per_ha", {"rice": 9990.0, "wheat": 5720.0})
    yld_ha = data.get("yield_per_ha", {"rice": 7.4, "wheat": 5.2})
    nproc = data.get("process_count", {"rice": 11, "wheat": 10})
    variants_cfg = data.get("variants") or [
        {"name": "Variant 1 - mechanised", "capacity_factor": 1.0},
        {"name": "Variant 2 - balanced", "capacity_factor": 0.55},
        {"name": "Variant 3 - labour-intensive", "capacity_factor": 0.2},
    ]
    eq_types = sorted(set(t["norm"]["equipment_type"] for t in tasks
                          if t["norm"].get("equipment_type") and float(t["norm"].get("machine_h") or 0) > 0))
    results = []
    for vc in variants_cfg:
        n = len(tasks)
        c, A, b = [], [], []
        for t in tasks:
            nm = t["norm"]
            saving = (float(nm["labor_manual"]) - float(nm["labor_mech"])) * p_lab - float(nm["machine_h"]) * p_mach
            # timeliness bonus: mechanised operations finish inside the agronomic window
            saving += 0.02 * rev_ha.get(t["crop"], 0) / max(1, nproc.get(t["crop"], 10))
            c.append(saving if nm.get("equipment_type") and float(nm["machine_h"]) > 0 else 0.0)
        for i, t in enumerate(tasks):  # m_i <= planned area
            row = [0.0] * n
            row[i] = 1.0
            A.append(row)
            b.append(float(t["planned_qty"]))
        for et in eq_types:  # machine-hour capacity per equipment type
            row = [float(t["norm"]["machine_h"]) if t["norm"].get("equipment_type") == et else 0.0 for t in tasks]
            A.append(row)
            b.append(max(0.0, float(cap.get(et, 0.0)) * float(vc["capacity_factor"])))
        x, obj = simplex(c, A, b) if n else ([], 0.0)
        res, lab_cost, eq_cost, mat_cost, labor_total, area_total, mech_total = {}, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
        revenue, yld = 0.0, 0.0
        task_out = []
        for i, t in enumerate(tasks):
            nm = t["norm"]
            a = float(t["planned_qty"])
            m = min(a, max(0.0, x[i]))
            labor = (a - m) * float(nm["labor_manual"]) + m * float(nm["labor_mech"])
            key = (t["process"], "labor", "Workers", "man-day")
            res[key] = res.get(key, 0.0) + labor
            lab_cost += labor * p_lab
            labor_total += labor
            if m > 0 and nm.get("equipment_type"):
                h = m * float(nm["machine_h"])
                key = (t["process"], "equipment", nm["equipment_type"], "h")
                res[key] = res.get(key, 0.0) + h
                eq_cost += h * p_mach
            if nm.get("material") and float(nm.get("material_per_ha") or 0) > 0:
                q = a * float(nm["material_per_ha"])
                key = (t["process"], "material", nm["material"], nm.get("material_unit") or "")
                res[key] = res.get(key, 0.0) + q
                mat_cost += q * float(nm.get("material_price") or 0)
            ratio = m / a if a > 0 else 0.0
            share = a / max(1, nproc.get(t["crop"], 10))
            revenue += share * rev_ha.get(t["crop"], 0) * (0.97 + 0.04 * ratio)
            yld += share * yld_ha.get(t["crop"], 0) * (0.97 + 0.04 * ratio)
            area_total += a
            mech_total += m
            task_out.append({"index": i, "mech_ha": round(m, 2)})
        resources = []
        for (proc, rt, name, unit), qv in sorted(res.items()):
            price = p_lab if rt == "labor" else (p_mach if rt == "equipment" else 0.0)
            if rt == "material":
                for t in tasks:
                    if t["process"] == proc and t["norm"].get("material") == name:
                        price = float(t["norm"].get("material_price") or 0)
                        break
            resources.append({"process": proc, "resource_type": rt, "name": name, "quantity": round(qv, 2),
                              "unit": unit, "cost": round(qv * price, 2)})
        total = lab_cost + eq_cost + mat_cost
        results.append({
            "name": vc["name"], "mech_ratio": round(mech_total / area_total, 3) if area_total else 0.0,
            "tasks": task_out, "resources": resources, "labor_md": round(labor_total, 1),
            "cost": {"labor": round(lab_cost, 2), "equipment": round(eq_cost, 2), "material": round(mat_cost, 2),
                     "total": round(total, 2)},
            "revenue": round(revenue, 2), "yield_t": round(yld, 2),
            "efficiency": round(revenue / total, 3) if total > 0 else 0.0, "lp_objective": round(obj, 2),
        })
    return {"variants": results}


# ============================================================================ resource redistribution (transport LP)
def allocate(data):
    """Redistribute a resource (manpower, equipment hours, water ...) from units with surplus to units with deficit.
    maximise sum (benefit - transfer_cost_ij) x_ij  s.t. sum_j x_ij <= surplus_i, sum_i x_ij <= deficit_j"""
    units = data["units"]  # [{id, name, available, required}]
    benefit = float(data.get("benefit", 100.0))
    sup = [(u, max(0.0, u["available"] - u["required"])) for u in units]
    dem = [(u, max(0.0, u["required"] - u["available"])) for u in units]
    S = [s for s in sup if s[1] > 1e-9]
    D = [d for d in dem if d[1] > 1e-9]
    if not S or not D:
        return {"transfers": [], "balance": _balance(units, [])}
    dist = data.get("distance", {})
    pairs = [(i, j) for i in range(len(S)) for j in range(len(D))]
    c = [benefit - float(dist.get("%s-%s" % (S[i][0]["id"], D[j][0]["id"]), 1.0)) for i, j in pairs]
    A, b = [], []
    for i in range(len(S)):
        A.append([1.0 if p[0] == i else 0.0 for p in pairs])
        b.append(S[i][1])
    for j in range(len(D)):
        A.append([1.0 if p[1] == j else 0.0 for p in pairs])
        b.append(D[j][1])
    x, _ = simplex(c, A, b)
    tr = []
    for k, (i, j) in enumerate(pairs):
        if x[k] > 1e-6:
            tr.append({"from_id": S[i][0]["id"], "from": S[i][0]["name"], "to_id": D[j][0]["id"], "to": D[j][0]["name"],
                       "quantity": round(x[k], 2)})
    return {"transfers": tr, "balance": _balance(units, tr)}


def _balance(units, tr):
    out = []
    for u in units:
        after = u["available"] - sum(t["quantity"] for t in tr if t["from_id"] == u["id"]) + \
                sum(t["quantity"] for t in tr if t["to_id"] == u["id"])
        out.append({"id": u["id"], "name": u["name"], "available": round(u["available"], 2),
                    "required": round(u["required"], 2), "after": round(after, 2)})
    return out


# ============================================================================ yield prediction (BP neural net)
FEATURES = ["n_applied", "avg_temp", "rainfall", "max_tillers", "spad", "grade", "potential_yield"]


def yield_bpnn(data):
    hist = data["history"]
    saved = data.get("saved")
    retrain = data.get("retrain", True) or not saved
    history_loss = []
    if retrain:
        X = [[float(h[k]) for k in FEATURES] for h in hist]
        y = [float(h["yield_t_ha"]) for h in hist]
        net = BPNet(len(FEATURES), 8)
        history_loss = net.fit(X, y, epochs=int(data.get("epochs", 150)))
        err = rmse([net.predict(x) for x in X], y)
    else:
        net = BPNet.from_dict(saved)
        err = data.get("saved_rmse")
    preds = []
    for c in data.get("current", []):
        preds.append({"field_id": c["field_id"], "soil_no": c.get("soil_no"), "crop": c.get("crop"),
                      "area_ha": c.get("area_ha"),
                      "yield_t_ha": round(net.predict([float(c[k]) for k in FEATURES]), 3)})
    return {"model": net.to_dict(), "rmse": round(err, 4) if err is not None else None, "samples": len(hist),
            "loss": history_loss, "predictions": preds, "features": FEATURES}


# ============================================================================ soil fertility (PLS) & water holding
def fertility(data):
    fields = data["fields"]
    names = ["grade", "water_holding_capacity", "organic_matter", "ph"]
    X = [[float(f[k]) for k in names] for f in fields]
    y = [float(f["mean_yield_index"]) for f in fields]
    model = pls1(X, y, 2)
    et0 = float(data.get("et0_mm_day", 3.0))
    root = float(data.get("root_depth_m", 0.4))
    out = []
    for f, x in zip(fields, X):
        idx = model["predict"](x)
        taw = float(f["water_holding_capacity"]) * root  # total available water in root zone (mm)
        raw = taw * 0.5  # readily available water
        days = raw / et0 if et0 > 0 else None
        rec = []
        if float(f["organic_matter"]) < 2.0:
            rec.append("Apply %.0f t/ha organic manure / compost" % ((2.5 - float(f["organic_matter"])) * 12))
        if float(f["ph"]) < 6.0:
            rec.append("Apply lime %.1f t/ha to raise pH" % ((6.3 - float(f["ph"])) * 2.0))
        if float(f["ph"]) > 7.0:
            rec.append("Use acid-forming fertiliser (ammonium sulphate)")
        if taw < 55:
            rec.append("Low water holding: irrigate every %d days, add green manure" % max(2, int(days or 3)))
        if int(f["grade"]) >= 4:
            rec.append("Deep ploughing + subsoil drainage; schedule land levelling")
        out.append({"field_id": f["field_id"], "soil_no": f["soil_no"], "grade": f["grade"],
                    "fertility_index": round(idx, 3), "taw_mm": round(taw, 1), "raw_mm": round(raw, 1),
                    "irrigation_interval_days": round(days, 1) if days else None,
                    "recommendations": rec or ["Maintain current practice"]})
    out.sort(key=lambda r: r["fertility_index"])
    return {"variables": names, "coefficients": [round(v, 4) for v in model["coef_std"]],
            "vip": [round(v, 3) for v in model["vip"]], "rmse": round(model["rmse"], 4), "fields": out}


# ============================================================================ pests & diseases
def pest_spread(data):
    """Deterministic expected-value spread model on the field grid (4-neighbourhood)."""
    days = int(data.get("days", 21))
    temps = data.get("temps", [])
    fields = {f["field_id"]: f for f in data["fields"]}
    pos = {(f["row"], f["col"]): f["field_id"] for f in data["fields"]}
    K = 1000.0
    state = {}  # field_id -> {pest -> intensity}
    meta = {}
    for inf in data["infestations"]:
        meta[inf["pest_name"]] = inf
        state.setdefault(inf["field_id"], {})
        state[inf["field_id"]][inf["pest_name"]] = min(K, max(1.0, float(inf["individuals"])))
    measures = set(data.get("controlled", []))  # field ids where control measures are applied
    daily = []
    for day in range(1, days + 1):
        t = temps[day - 1] if day - 1 < len(temps) else (temps[-1] if temps else 18.0)
        new = {}
        for fid, pests in state.items():
            for pname, I in pests.items():
                m = meta[pname]
                tf = math.exp(-((t - float(m["optimum_temp"])) / 8.0) ** 2)
                r = float(m["growth_rate"]) * tf
                if fid in measures:
                    r -= 0.25
                I2 = max(0.0, I + r * I * (1 - I / K))
                new.setdefault(fid, {})[pname] = max(new.get(fid, {}).get(pname, 0.0), I2)
                if I2 > 0.4 * K and fid not in measures:
                    f = fields[fid]
                    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nb = pos.get((f["row"] + dr, f["col"] + dc))
                        if nb and fields[nb]["crop"] == fields[fid]["crop"]:
                            seed = K * float(m["spread_prob"]) * (I2 / K) * 0.06
                            cur = new.setdefault(nb, {}).get(pname, state.get(nb, {}).get(pname, 0.0))
                            new[nb][pname] = max(cur, cur + seed)
        state = new
        dam = 0.0
        pf, df = set(), set()
        for fid, pests in state.items():
            for pname, I in pests.items():
                if I < 5:
                    continue
                dam += float(fields[fid]["area_ha"]) * (I / K) * 0.35
                (pf if meta[pname]["category"] == "pest" else df).add(fid)
        daily.append({"day": day, "infected_fields": len(pf | df), "pest_fields": len(pf), "disease_fields": len(df),
                      "damaged_area_ha": round(dam, 2)})
    final = []
    for fid, pests in state.items():
        for pname, I in pests.items():
            if I < 5:
                continue
            final.append({"field_id": fid, "soil_no": fields[fid].get("soil_no"), "pest_name": pname,
                          "category": meta[pname]["category"], "individuals": int(I),
                          "damaged_area_m2": round(float(fields[fid]["area_ha"]) * 10000 * (I / K) * 0.35, 1),
                          "probability": round(min(1.0, I / (0.3 * K)), 2)})
    final.sort(key=lambda r: -r["individuals"])
    return {"daily": daily, "final": final}


# ============================================================================ CPS: plan scenario simulation (Monte Carlo)
def scenario_yield(data):
    runs = int(data.get("runs", 300))
    rnd = random.Random(int(data.get("seed", 42)))
    plan = data["plan"]
    mech = float(plan.get("mech_ratio", 0.5))
    cost = float(plan.get("cost", 0))
    share = float(plan.get("revenue_share", 1.0))  # part of the season's revenue attributable to this plan
    prices = data.get("prices", {"rice": 1350.0, "wheat": 1100.0})
    fields = data["fields"]
    t_sd = float(data.get("temp_sd", 1.2))
    by_crop_runs = {}
    profits = []
    for _ in range(runs):
        dt = rnd.gauss(0, t_sd)
        rain = rnd.gauss(1.0, 0.12)
        pest = 1 - abs(rnd.gauss(0, 0.04))
        tot_rev, by_crop = 0.0, {}
        for f in fields:
            opt_t = 22.0 if f["crop"] == "rice" else 11.0
            base = float(f["potential_yield"]) * (1 - 0.06 * (int(f["grade"]) - 1))
            growth = min(1.1, float(f.get("tiller_ratio", 1.0)))
            y = base * (1 - 0.03 * abs(dt)) * min(1.05, rain) * pest * (0.9 + 0.1 * growth) * (0.97 + 0.04 * mech)
            y *= rnd.uniform(0.97, 1.03)
            prod = y * float(f["area_ha"])
            by_crop[f["crop"]] = by_crop.get(f["crop"], 0.0) + prod
            tot_rev += prod * prices.get(f["crop"], 1000.0)
        for k, v in by_crop.items():
            by_crop_runs.setdefault(k, []).append(v)
        profits.append(tot_rev * share - cost)

    def pct(v, p):
        s = sorted(v)
        return s[min(len(s) - 1, int(p * len(s)))]

    yields = [{"crop": k, "p10": round(pct(v, 0.1), 1), "p50": round(pct(v, 0.5), 1), "p90": round(pct(v, 0.9), 1),
               "mean": round(mean(v), 1)} for k, v in sorted(by_crop_runs.items())]
    lo, hi = min(profits), max(profits)
    bins = 12
    width = (hi - lo) / bins if hi > lo else 1.0
    hist = [0] * bins
    for p in profits:
        hist[min(bins - 1, int((p - lo) / width))] += 1
    histogram = [{"from": round(lo + i * width), "to": round(lo + (i + 1) * width), "count": hist[i]}
                 for i in range(bins)]
    return {"yields": yields, "profit": {"mean": round(mean(profits)), "sd": round(std(profits)),
                                         "p10": round(pct(profits, 0.1)), "p90": round(pct(profits, 0.9)),
                                         "histogram": histogram}, "runs": runs}


# ============================================================================ CPS: response measures
MEASURES = {
    "none": {},
    "n_topdress": {"tiller_factor": 1.10, "leaf_factor": 1.02, "yield": 1.06, "label": "N top-dressing 40 kg/ha"},
    "irrigation": {"tiller_factor": 1.05, "gdd_factor": 1.0, "yield": 1.04, "label": "Supplementary irrigation 30 mm"},
    "pest_control": {"pest_factor": 1.0, "yield": 1.05, "label": "Integrated pest control"},
    "cold_protection": {"temp_shift": 1.5, "yield": 1.03, "label": "Deep-water / mulch cold protection"},
}


def response(data):
    horizon = int(data.get("horizon", 45))
    future = data.get("future_temps", [])
    selected = data.get("measures", [])
    stress = data.get("stress", {})  # derived from meteorological & soil data
    base_adj = {"pest_factor": 1 - float(stress.get("pest_loss", 0.0)),
                "tiller_factor": 1 - float(stress.get("water_stress", 0.0)),
                "temp_shift": 0.0}
    meas_adj = dict(base_adj)
    yfac_base = (1 - float(stress.get("pest_loss", 0))) * (1 - float(stress.get("water_stress", 0)))
    yfac = yfac_base
    for m in selected:
        cfg = MEASURES.get(m, {})
        if m == "pest_control":
            meas_adj["pest_factor"] = 1.0
            yfac /= max(0.01, 1 - float(stress.get("pest_loss", 0)))
        elif m == "irrigation":
            meas_adj["tiller_factor"] = meas_adj["tiller_factor"] / max(0.01, 1 - float(stress.get("water_stress", 0)))
            yfac /= max(0.01, 1 - float(stress.get("water_stress", 0)))
        else:
            for k in ("tiller_factor", "leaf_factor", "gdd_factor"):
                if k in cfg:
                    meas_adj[k] = meas_adj.get(k, 1.0) * cfg[k]
            meas_adj["temp_shift"] += cfg.get("temp_shift", 0.0)
            yfac *= cfg.get("yield", 1.0)
    base_series, meas_series = [], []
    for f in data["fields"]:
        p = fit_field(f)
        base_series.append(_project(f, p, future, horizon, base_adj))
        meas_series.append(_project(f, p, future, horizon, meas_adj))
    out = []
    for i in range(horizon):
        out.append({"day": i + 1,
                    "leaf_base": round(mean([s[i]["leaf"] for s in base_series]), 2),
                    "leaf_measure": round(mean([s[i]["leaf"] for s in meas_series]), 2),
                    "tiller_base": round(mean([s[i]["tiller"] for s in base_series]), 2),
                    "tiller_measure": round(mean([s[i]["tiller"] for s in meas_series]), 2)})
    py = float(data.get("potential_yield", 7.0))
    return {"series": out, "yield_base": round(py * yfac_base, 2), "yield_measure": round(py * yfac, 2),
            "measures": [{"key": k, "label": v.get("label", k)} for k, v in MEASURES.items() if k != "none"]}


COMMANDS = {
    "growth_forecast": growth_forecast,
    "reach_date": reach_date,
    "optimize_plan": optimize_plan,
    "allocate": allocate,
    "yield_bpnn": yield_bpnn,
    "fertility": fertility,
    "pest_spread": pest_spread,
    "scenario_yield": scenario_yield,
    "response": response,
}


# ============================================================================ plan derivation (parent -> child period)
def _d(s):
    import datetime
    return datetime.date(*[int(v) for v in str(s)[:10].split("-")])


def derive_tasks(parent_tasks, period_start, period_end, department_ids=None):
    ps, pe = _d(period_start), _d(period_end)
    out = []
    for t in parent_tasks:
        if department_ids and t.get("department_id") not in department_ids:
            continue
        s, e = _d(t["start_date"]), _d(t["end_date"])
        a, b = max(s, ps), min(e, pe)
        if a > b:
            continue
        frac = ((b - a).days + 1) / float((e - s).days + 1)
        qty = round(float(t["planned_qty"]) * frac, 2)
        if qty <= 0:
            continue
        out.append({"crop": t["crop"], "process": t["process"], "department_id": t.get("department_id"),
                    "start_date": a.isoformat(), "end_date": b.isoformat(), "planned_qty": qty})
    return out


def derive_plan(data):
    tasks = derive_tasks(data["parent_tasks"], data["period_start"], data["period_end"], data.get("department_ids"))
    norms = data["norms"]
    opt_tasks = []
    for t in tasks:
        nt = dict(t)
        nt["norm"] = norms.get(t["crop"] + "|" + t["process"], {"labor_manual": 1, "labor_mech": 1, "machine_h": 0})
        opt_tasks.append(nt)
    payload = dict(data)
    payload["tasks"] = opt_tasks
    res = optimize_plan(payload) if opt_tasks else {"variants": []}
    return {"tasks": tasks, "variants": res["variants"]}


COMMANDS["derive_plan"] = derive_plan
