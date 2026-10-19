# -*- coding: utf-8 -*-
"""Smoke test for all analytics commands:  python selftest.py"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from models import COMMANDS  # noqa: E402
from mathlib import simplex  # noqa: E402

x, obj = simplex([3, 5], [[1, 0], [0, 2], [3, 2]], [4, 12, 18])
assert abs(obj - 36) < 1e-6 and abs(x[0] - 2) < 1e-6 and abs(x[1] - 6) < 1e-6, (x, obj)

cv = {"id": 1, "base_temp": 10, "phyllochron": 80, "max_leaves": 14, "max_tillers": 22, "maturity_days": 120}
temps = [18 + 3 * math.sin(i / 5.0) for i in range(80)]
surveys = []
g = 0
for i, t in enumerate(temps):
    g += max(0, t - 10)
    if i % 5 == 4:
        surveys.append({"das": i + 1, "leaf": min(14, g / 80), "tiller": 22 / (1 + math.exp(-0.09 * (i + 1 - 35)))})
field = {"field_id": 1, "soil_no": "F-01", "cultivar": cv, "das_today": 80, "past_temps": temps, "surveys": surveys}
r = COMMANDS["growth_forecast"]({"fields": [field], "future_temps": [15] * 30, "horizon": 30})
assert len(r["fields"][0]["series"]) == 30
print("growth", r["fields"][0]["params"])
print("reach", COMMANDS["reach_date"]({"fields": [field], "target": 13.9, "kind": "leaf", "future_temps": [15] * 30})["reached_day"])

norm = {"labor_manual": 25, "labor_mech": 3, "machine_h": 5, "equipment_type": "Rice transplanter",
        "material": "Trays", "material_per_ha": 220, "material_unit": "pcs", "material_price": 0.3}
tasks = [{"crop": "rice", "process": "Transplanting", "planned_qty": 40, "norm": norm},
         {"crop": "rice", "process": "Transplanting", "planned_qty": 30, "norm": norm}]
r = COMMANDS["optimize_plan"]({"tasks": tasks, "equipment_capacity": {"Rice transplanter": 200}})
print("optimize", [(v["name"], v["mech_ratio"], v["efficiency"]) for v in r["variants"]])

r = COMMANDS["allocate"]({"units": [{"id": 1, "name": "A", "available": 30, "required": 10},
                                    {"id": 2, "name": "B", "available": 5, "required": 25}]})
print("allocate", r["transfers"])

rnd = random.Random(1)
hist = []
for _ in range(120):
    h = {"n_applied": rnd.uniform(80, 200), "avg_temp": rnd.uniform(19, 25), "rainfall": rnd.uniform(500, 1200),
         "max_tillers": rnd.uniform(16, 26), "spad": rnd.uniform(32, 45), "grade": rnd.randint(1, 5),
         "potential_yield": 7.5}
    h["yield_t_ha"] = 7.5 * (1 - 0.06 * (h["grade"] - 1)) * (1 - ((h["n_applied"] - 150) / 300.0) ** 2)
    hist.append(h)
cur = dict(hist[0])
cur["field_id"] = 1
r = COMMANDS["yield_bpnn"]({"history": hist, "current": [cur], "epochs": 60})
print("bpnn rmse", r["rmse"], "pred", r["predictions"][0]["yield_t_ha"], "true", round(hist[0]["yield_t_ha"], 3))

fl = [{"field_id": i, "soil_no": "F-%02d" % i, "grade": rnd.randint(1, 5), "water_holding_capacity": rnd.uniform(100, 220),
       "organic_matter": rnd.uniform(1.2, 3.4), "ph": rnd.uniform(5.5, 7.3)} for i in range(1, 20)]
for f in fl:
    f["mean_yield_index"] = 1 - 0.06 * f["grade"] + 0.05 * f["organic_matter"] + rnd.uniform(-0.02, 0.02)
r = COMMANDS["fertility"]({"fields": fl})
print("pls vip", r["vip"], "rmse", r["rmse"])

grid = [{"field_id": rr * 4 + c + 1, "soil_no": "F", "row": rr, "col": c, "crop": "rice", "area_ha": 3} for rr in range(3) for c in range(4)]
r = COMMANDS["pest_spread"]({"fields": grid, "days": 21, "temps": [25] * 21, "infestations": [
    {"field_id": 1, "pest_name": "Rice blast", "category": "disease", "individuals": 200, "growth_rate": 0.18,
     "spread_prob": 0.12, "optimum_temp": 25}]})
print("pest", r["daily"][-1])

r = COMMANDS["scenario_yield"]({"plan": {"mech_ratio": 0.6, "cost": 50000}, "fields": [
    {"crop": "rice", "potential_yield": 7.5, "grade": 2, "area_ha": 3}, {"crop": "wheat", "potential_yield": 5.2, "grade": 3, "area_ha": 3}]})
print("scenario", r["yields"], r["profit"]["mean"])

r = COMMANDS["response"]({"fields": [field], "future_temps": [15] * 45, "measures": ["n_topdress", "pest_control"],
                          "stress": {"pest_loss": 0.05, "water_stress": 0.04}, "potential_yield": 7.2})
print("response", r["yield_base"], r["yield_measure"], r["series"][-1])
print("ALL OK")
