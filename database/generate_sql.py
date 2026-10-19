# -*- coding: utf-8 -*-
"""
Generates database/smartfarm.sql : schema + virtual data for the Seed Farm MES/CPS.
Compatible with Python 3.7+. No third-party packages.

All time-series dates are written as SQL expressions relative to CURDATE(),
so the data is always "current" on the day the file is imported.

    python generate_sql.py            -> writes smartfarm.sql next to this script
"""
import datetime
import hashlib
import json
import math
import sys
import os
import random

random.seed(20260407)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "analytics"))
from models import derive_plan  # noqa: E402  (same code the backend uses)
TODAY = datetime.date.today()
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "smartfarm.sql")
lines = []


def w(s=""):
    lines.append(s)


class Raw(object):
    def __init__(self, s):
        self.s = s


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, Raw):
        return v.s
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(round(v, 4))
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def d(offset):
    """date relative to today"""
    return Raw("DATE_ADD(CURDATE(), INTERVAL %d DAY)" % offset)


def dt(offset, hour=0, minute=0):
    return Raw("DATE_ADD(CURDATE(), INTERVAL %d MINUTE)" % (offset * 1440 + hour * 60 + minute))


def yd(day_of_year):
    """date inside the current year, day_of_year starting at 0 = Jan 1"""
    return Raw("DATE_ADD(MAKEDATE(YEAR(CURDATE()),1), INTERVAL %d DAY)" % day_of_year)


def insert(table, cols, rows, chunk=200):
    if not rows:
        return
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        w("INSERT INTO `%s` (%s) VALUES" % (table, ", ".join("`%s`" % c for c in cols)))
        w(",\n".join("(" + ", ".join(q(v) for v in r) + ")" for r in part) + ";")
    w()


def pwd_hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 10000, 32).hex()


with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql"), encoding="utf-8") as f:
    w(f.read())

# --------------------------------------------------------------------------- organisation
deps = [
    (1, "Seed Farm Headquarters", None, 1, None),
    (2, "Rice Seed Division", 1, 2, "rice"),
    (3, "Wheat Seed Division", 1, 2, "wheat"),
    (4, "Technical Support Division", 1, 2, None),
    (5, "Rice Work Team 1", 2, 3, "rice"),
    (6, "Rice Work Team 2", 2, 3, "rice"),
    (7, "Wheat Work Team 1", 3, 3, "wheat"),
    (8, "Wheat Work Team 2", 3, 3, "wheat"),
    (9, "Machinery Team", 4, 3, None),
    (10, "Irrigation & Power Team", 4, 3, None),
]
insert("departments", ["id", "name", "parent_id", "level", "crop"], deps)

ALL_MENUS = ["home", "layout", "annual", "monthly", "fifteen", "five", "weather", "fulfilment",
             "power_consumption", "power_system", "growth", "pest", "equipment", "machinery_map", "irrigation",
             "diary", "decision", "admin"]
users = []
perms = []
uid = [0]


def add_user(username, name, dep, role, menus, approved=1):
    uid[0] += 1
    salt = "%08x" % random.getrandbits(32)
    users.append((uid[0], username, pwd_hash("1234", salt), salt, name, dep, role, approved, dt(-200)))
    for m in menus:
        perms.append((uid[0], m))
    return uid[0]


common = ["home", "layout", "weather", "fulfilment", "growth", "pest", "equipment", "machinery_map", "irrigation",
          "power_consumption", "power_system"]
add_user("admin", "System Administrator", 1, "admin", ALL_MENUS)
add_user("director", "Farm Director", 1, "manager", common + ["annual", "monthly", "fifteen", "decision"])
add_user("planner", "Chief Planner", 1, "manager", common + ["annual", "monthly", "decision"])
add_user("rice_div", "Rice Division Head", 2, "manager", common + ["fifteen", "five"])
add_user("wheat_div", "Wheat Division Head", 3, "manager", common + ["fifteen", "five"])
add_user("tech_div", "Technical Division Head", 4, "manager", common + ["five"])
team_leaders = {}
farmers = {}
first = ["Kim", "Ri", "Pak", "Choe", "Jong", "Kang", "Han", "Yun", "Jang", "Song", "Hwang", "Ryu", "Mun", "So"]
given = ["Chol", "Song", "Hyok", "Myong", "Il", "Nam", "Gwang", "Su", "Jin", "Hui", "Ok", "Yong", "Bom", "Un"]
for dep in range(5, 11):
    lead = add_user("leader%d" % dep, "%s %s" % (random.choice(first), random.choice(given)), dep,
                    "manager", ["home", "layout", "weather", "fulfilment", "growth", "pest", "equipment",
                                "machinery_map", "irrigation", "diary", "five"])
    team_leaders[dep] = lead
    farmers[dep] = []
    for i in range(6):
        fid = add_user("farmer%d_%d" % (dep, i + 1), "%s %s" % (random.choice(first), random.choice(given)), dep,
                       "farmer", ["home", "weather", "growth", "pest"])
        farmers[dep].append(fid)
add_user("newcomer", "Pending Applicant", 7, "farmer", ["home"], approved=0)
insert("users", ["id", "username", "password_hash", "salt", "full_name", "department_id", "role", "approved",
                 "created_at"], users)
insert("user_permissions", ["user_id", "menu_key"], perms)

# --------------------------------------------------------------------------- cultivars & fields
cultivars = [
    (1, "rice", "Rice R-101 (early)", "#2e7d32", 120, 10.0, 50.0, 14.0, 22.0, 7.2, 1400.0),
    (2, "rice", "Rice R-205 (medium)", "#66bb6a", 135, 10.0, 54.0, 16.0, 24.0, 7.8, 1350.0),
    (3, "rice", "Rice R-310 (late)", "#a5d6a7", 150, 10.0, 58.0, 17.0, 26.0, 8.3, 1300.0),
    (4, "wheat", "Wheat W-11 (winter)", "#f9a825", 250, 0.0, 110.0, 12.0, 6.0, 5.2, 1100.0),
    (5, "wheat", "Wheat W-23 (winter)", "#ffcc80", 240, 0.0, 105.0, 11.0, 5.5, 5.6, 1150.0),
    (6, "wheat", "Wheat W-37 (spring)", "#8d6e63", 110, 0.0, 95.0, 9.0, 4.5, 4.6, 1050.0),
]
insert("cultivars", ["id", "crop", "name", "color", "maturity_days", "base_temp", "phyllochron", "max_leaves",
                     "max_tillers", "potential_yield", "seed_price"], cultivars)
cult = {c[0]: c for c in cultivars}

COLS, ROWS = 8, 6
FW, FH = 100, 78
fields = []
field_meta = {}
for r in range(ROWS):
    for c in range(COLS):
        fid = r * COLS + c + 1
        x = 60 + c * 112 + (36 if c >= 4 else 0)
        y = 50 + r * 92
        crop = "rice" if c < 4 else "wheat"
        if crop == "rice":
            dep = 5 if r < 3 else 6
            cv = [1, 2, 3][(r + c) % 3]
        else:
            dep = 7 if r < 3 else 8
            cv = [4, 5, 6][(r * 2 + c) % 3]
        grade = random.choice([1, 2, 2, 3, 3, 3, 4, 5])
        whc = round(random.uniform(120, 220) - grade * 8, 1)
        om = round(random.uniform(1.6, 3.4) - grade * 0.15, 2)
        ph = round(random.uniform(5.6, 7.2), 1)
        sow = -random.randint(68, 98) if crop == "rice" else -random.randint(30, 45)
        area = round(random.uniform(2.2, 4.2), 2)
        fields.append((fid, "F-%02d" % fid, crop, cv, dep, area, x, y, FW, FH, grade, whc, om, ph, d(sow)))
        field_meta[fid] = dict(crop=crop, cv=cv, dep=dep, sow=sow, grade=grade, area=area, x=x, y=y, row=r, col=c)
insert("fields", ["id", "soil_no", "crop", "cultivar_id", "department_id", "area_ha", "x", "y", "w", "h", "grade",
                  "water_holding_capacity", "organic_matter", "ph", "sowing_date"], fields)

# --------------------------------------------------------------------------- process norms
norms = [
    # crop, seq, process, sdoy, edoy, lab_man, lab_mech, mach_h, equip, material, per_ha, unit, price
    ("rice", 1, "Seed selection & treatment", 70, 90, 2.0, 0.8, 1.5, "Seed treater", "Seed disinfectant", 2.0, "kg", 18),
    ("rice", 2, "Nursery bed sowing", 90, 110, 6.0, 2.5, 3.0, "Nursery seeder", "Rice seed", 60, "kg", 1.4),
    ("rice", 3, "Land preparation & puddling", 110, 135, 8.0, 1.2, 6.0, "Tractor", "Diesel", 45, "L", 1.1),
    ("rice", 4, "Transplanting", 135, 160, 25.0, 3.0, 5.0, "Rice transplanter", "Seedling trays", 220, "pcs", 0.3),
    ("rice", 5, "Fertilising", 160, 210, 4.0, 1.0, 1.5, "Fertiliser spreader", "Urea", 250, "kg", 0.45),
    ("rice", 6, "Weeding", 165, 220, 12.0, 2.0, 2.5, "Power weeder", "Herbicide", 3.0, "L", 9),
    ("rice", 7, "Irrigation management", 135, 300, 6.0, 3.0, 2.0, "Water pump", "Electricity", 900, "kWh", 0.08),
    ("rice", 8, "Pest & disease control", 180, 290, 4.0, 0.8, 1.5, "Boom sprayer", "Pesticide", 2.5, "L", 14),
    ("rice", 9, "Roguing (seed purity)", 200, 280, 5.0, 5.0, 0.0, None, None, 0, None, 0),
    ("rice", 10, "Harvesting", 250, 300, 20.0, 1.5, 4.0, "Combine harvester", "Diesel", 35, "L", 1.1),
    ("rice", 11, "Drying & seed processing", 255, 320, 6.0, 1.5, 3.0, "Grain dryer", "Seed bags", 160, "pcs", 0.6),
    ("wheat", 1, "Harvest & seed processing (prev. season)", 160, 195, 18.0, 1.6, 4.0, "Combine harvester", "Diesel", 32, "L", 1.1),
    ("wheat", 2, "Land preparation", 255, 290, 6.0, 1.0, 5.0, "Tractor", "Diesel", 40, "L", 1.1),
    ("wheat", 3, "Seed treatment", 260, 290, 2.0, 0.8, 1.0, "Seed treater", "Seed disinfectant", 2.0, "kg", 18),
    ("wheat", 4, "Sowing", 270, 300, 8.0, 1.0, 3.0, "Grain drill", "Wheat seed", 220, "kg", 1.1),
    ("wheat", 5, "Basal fertilising", 270, 300, 3.0, 0.8, 1.2, "Fertiliser spreader", "Compound fertiliser", 300, "kg", 0.55),
    ("wheat", 6, "Overwintering management", 300, 364, 2.0, 1.0, 0.5, "Roller", None, 0, None, 0),
    ("wheat", 7, "Spring top-dressing", 60, 100, 3.0, 0.8, 1.2, "Fertiliser spreader", "Urea", 150, "kg", 0.45),
    ("wheat", 8, "Weeding", 80, 120, 8.0, 1.5, 2.0, "Boom sprayer", "Herbicide", 2.0, "L", 9),
    ("wheat", 9, "Pest & disease control", 100, 150, 3.0, 0.8, 1.5, "Boom sprayer", "Fungicide", 2.0, "L", 16),
    ("wheat", 10, "Roguing (seed purity)", 120, 155, 4.0, 4.0, 0.0, None, None, 0, None, 0),
]
insert("process_norms", ["crop", "seq", "process", "start_doy", "end_doy", "labor_manual", "labor_mech", "machine_h",
                         "equipment_type", "material", "material_per_ha", "material_unit", "material_price"], norms)

prices = [("labor_md", 12, "per man-day"), ("rice_seed_t", 1350, "per t"), ("wheat_seed_t", 1100, "per t"),
          ("machine_h", 25, "per machine-hour"), ("electricity_kwh", 0.08, "per kWh")]
insert("prices", ["item", "value", "unit"], prices)

# --------------------------------------------------------------------------- annual plans (2 variants, draft)
area_by = {}
for fid, m in field_meta.items():
    area_by[(m["crop"], m["dep"])] = area_by.get((m["crop"], m["dep"]), 0) + m["area"]

plans, tasks, resources = [], [], []
annual_a_tasks = []
pid = 0
for vno, (vname, mech) in enumerate([("Variant A - balanced", 0.55), ("Variant B - mechanised", 0.85)], 1):
    pid += 1
    cost = 0.0
    res_acc = {}
    for n in norms:
        crop, seq, proc, sdoy, edoy, lm, lme, mh, eq, mat, per, unit, mprice = n
        for (c2, dep), area in sorted(area_by.items()):
            if c2 != crop:
                continue
            tasks.append((pid, crop, proc, dep, yd(sdoy), yd(edoy), round(area, 2), 0.0))
            if pid == 1:
                y0 = datetime.date(TODAY.year, 1, 1)
                annual_a_tasks.append({"crop": crop, "process": proc, "department_id": dep,
                                       "start_date": (y0 + datetime.timedelta(days=sdoy)).isoformat(),
                                       "end_date": (y0 + datetime.timedelta(days=edoy)).isoformat(),
                                       "planned_qty": round(area, 2)})
            labor = area * (lm * (1 - mech) + lme * mech)
            key = (proc, "labor", "Workers", "man-day")
            res_acc[key] = res_acc.get(key, 0) + labor
            cost += labor * 12
            if eq and mh:
                key = (proc, "equipment", eq, "h")
                res_acc[key] = res_acc.get(key, 0) + area * mh * mech
                cost += area * mh * mech * 25
            if mat:
                key = (proc, "material", mat, unit)
                res_acc[key] = res_acc.get(key, 0) + area * per
                cost += area * per * mprice
    for (proc, rt, name, unit), qty in sorted(res_acc.items()):
        price = {"labor": 12, "equipment": 25}.get(rt, 0)
        if rt == "material":
            price = [n[12] for n in norms if n[2] == proc and n[9] == name][0]
        resources.append((pid, proc, rt, name, round(qty, 2), unit, round(qty * price, 2)))
    factor = 0.97 + 0.04 * mech
    yt = sum(area_by[k] * (7.4 if k[0] == "rice" else 5.2) for k in area_by) * factor
    rev = sum(area_by[k] * (7.4 * 1350 if k[0] == "rice" else 5.2 * 1100) for k in area_by) * factor
    plans.append((pid, "annual", None, 1, vno, vname, yd(0),
                  Raw("DATE_ADD(MAKEDATE(YEAR(CURDATE()),1), INTERVAL 1 YEAR) - INTERVAL 1 DAY"),
                  "submitted" if vno == 1 else "draft", 2 if vno == 1 else None, dt(-20, 10) if vno == 1 else None,
                  mech, round(yt, 2), round(cost, 2), round(rev, 2), round(rev / cost, 3), dt(-30)))
insert("production_plans", ["id", "plan_type", "parent_id", "department_id", "variant_no", "variant_name",
                            "period_start", "period_end", "status", "status_by", "status_at", "mech_ratio",
                            "expected_yield_t", "expected_cost", "expected_revenue", "efficiency", "created_at"], plans)
insert("plan_tasks", ["plan_id", "crop", "process", "department_id", "start_date", "end_date", "planned_qty",
                      "executed_qty"], tasks)
insert("plan_resources", ["plan_id", "process", "resource_type", "name", "quantity", "unit", "cost"], resources)

# --------------------------------------------------------------------------- weather
sensors = [(1, "MS-01", "North rice block", 250, 40), (2, "MS-02", "South rice block", 250, 590),
           (3, "MS-03", "North wheat block", 750, 40), (4, "MS-04", "South wheat block", 750, 590),
           (5, "MS-05", "Central road / ACS mast", 530, 320)]
insert("weather_sensors", ["id", "sensor_no", "location", "x", "y"], sensors)

daily, forecast, micro = [], [], []
for off in range(-150, 1):
    tavg = round(16.0 + (-off) * 0.06 + 2.5 * math.sin(off / 5.0) + random.uniform(-1.5, 1.5), 1)
    tmax = round(tavg + random.uniform(4, 8), 1)
    tmin = round(tavg - random.uniform(4, 7), 1)
    rain = 0.0
    r = random.random()
    if r < 0.18:
        cond, rain = "rain", round(random.uniform(2, 35), 1)
    elif r < 0.45:
        cond = "cloudy"
    else:
        cond = "sunny"
    if tavg < 2 and cond == "rain":
        cond = "snow"
    hum = round(random.uniform(45, 70) + (20 if cond in ("rain", "snow") else 0), 1)
    daily.append((d(off), cond, tmax, tmin, tavg, hum, rain, "ACS"))
insert("weather_daily", ["obs_date", "conditions", "t_max", "t_min", "t_avg", "humidity", "rainfall", "source"], daily)
for off in range(1, 31):
    tavg = round(15.5 - off * 0.22 + 2 * math.sin(off / 4.0) + random.uniform(-1, 1), 1)
    cond = random.choice(["sunny", "sunny", "cloudy", "cloudy", "rain"])
    if tavg < 2 and cond == "rain":
        cond = "snow"
    forecast.append((d(off), cond, round(tavg + random.uniform(4, 7), 1), round(tavg - random.uniform(4, 6), 1),
                     tavg, round(random.uniform(45, 85), 1)))
insert("weather_forecast", ["forecast_date", "conditions", "t_max", "t_min", "t_avg", "humidity"], forecast)
for s in sensors:
    for off in range(-2, 1):
        for h in range(0, 24):
            sv = math.sin((h - 9) / 24.0 * 2 * math.pi)
            micro.append((s[0], dt(off, h, 0), round(14 + 6 * sv + random.uniform(-1, 1), 2),
                          round(75 - 20 * sv + random.uniform(-5, 5), 2),
                          round(random.uniform(0.3, 5.5), 2), random.choice([0.0, 0.0, 0.0, 0.0, 0.2, 1.4]),
                          round(max(0.0, 650 * math.sin((h - 6) / 13.0 * math.pi)), 2) if 6 <= h <= 19 else 0.0))
insert("micro_climate", ["sensor_id", "measured_at", "temperature", "humidity", "wind_speed", "rainfall",
                         "solar_radiation"], micro, chunk=500)

# --------------------------------------------------------------------------- soil readings
soil = []
for fid, m in field_meta.items():
    rice = m["crop"] == "rice"
    for off in range(-14, 1):
        for h in (6, 12, 18):
            sv = math.sin((h - 9) / 24.0 * 6.28)
            soil.append((fid, dt(off, h, 0), round(random.uniform(2, 8), 2) if rice else 0.0,
                         round(random.uniform(22, 42) + (15 if rice else 0), 2),
                         round(12 + 4 * sv + random.uniform(-1, 1), 2),
                         round(14 + 4 * sv + random.uniform(-1, 1), 2) if rice else 0.0))
insert("soil_readings", ["field_id", "measured_at", "water_level_cm", "moisture_pct", "soil_temp", "water_temp"], soil,
       chunk=500)

# --------------------------------------------------------------------------- growth surveys / nutrients
tavg_by_off = {}
for i, off in enumerate(range(-150, 1)):
    tavg_by_off[off] = daily[i][4]


def gdd(sow_off, upto_off, base):
    s = 0.0
    for o in range(sow_off, upto_off + 1):
        s += max(0.0, tavg_by_off.get(o, 15.0) - base)
    return s


def stage(crop, das, mat):
    p = das / float(mat)
    if crop == "rice":
        names = [(0.15, "Seedling"), (0.35, "Tillering"), (0.55, "Panicle initiation"), (0.7, "Heading"),
                 (0.85, "Grain filling"), (9, "Maturity")]
    else:
        names = [(0.12, "Emergence"), (0.3, "Tillering"), (0.6, "Overwintering"), (0.75, "Jointing"),
                 (0.88, "Heading"), (9, "Maturity")]
    for lim, n in names:
        if p <= lim:
            return n
    return "Maturity"


surveys, nutr = [], []
abnormal_fields = set(random.sample(sorted(field_meta.keys()), 6))
harvest_fields = set(f for f, m in field_meta.items() if m["crop"] == "rice" and m["cv"] == 1 and random.random() < 0.7)
for fid in sorted(field_meta):
    m = field_meta[fid]
    c = cult[m["cv"]]
    base, phyl, maxl, maxt, mat = c[5], c[6], c[7], c[8], c[4]
    if m["crop"] == "wheat":
        mat = 110  # time-compressed season for simulation display
    for off in range(m["sow"] + 10, 1, 5):
        das = off - m["sow"]
        g = gdd(m["sow"], off, base)
        leaves = min(maxl, g / phyl) * random.uniform(0.95, 1.05)
        tillers = maxt / (1 + math.exp(-0.09 * (das - 35))) * random.uniform(0.92, 1.06)
        if das > mat * 0.6:
            tillers *= 1 - 0.15 * (das - mat * 0.6) / (mat * 0.4)
        height = (95 if m["crop"] == "rice" else 85) / (1 + math.exp(-0.07 * (das - 50)))
        spad = 32 + 10 * math.sin(min(das, mat) / float(mat) * math.pi) + random.uniform(-2, 2)
        status = "normal"
        if fid in abnormal_fields and off > -25:
            spad -= 9
            tillers *= 0.8
            status = "abnormal"
        if fid in harvest_fields and off > -12:
            status = "harvest"
        surveys.append((fid, d(off), das, round(leaves, 2), round(tillers, 2), round(height, 1), round(spad, 1),
                        stage(m["crop"], das, mat), status))
        if (das % 10 == 0) or off > -6:
            st = "deficient" if spad < 33 else ("excess" if spad > 44 else "sufficient")
            nutr.append((fid, d(off), round(2.2 + spad / 40.0 + random.uniform(-0.2, 0.2), 2),
                         round(random.uniform(0.18, 0.42), 2), round(random.uniform(1.2, 2.6), 2), round(spad, 1), st))
insert("growth_surveys", ["field_id", "survey_date", "days_after_sowing", "leaf_number", "tiller_number",
                          "plant_height", "spad", "growth_stage", "status"], surveys, chunk=500)
insert("nutrient_status", ["field_id", "diag_date", "n_pct", "p_pct", "k_pct", "spad", "status"], nutr, chunk=500)

# --------------------------------------------------------------------------- pests
catalog = [
    ("rice", "Rice blast", "disease", 0.18, 0.12, 25, "Apply tricyclazole fungicide, drain field briefly", "Tricyclazole", 0.6, "kg"),
    ("rice", "Sheath blight", "disease", 0.12, 0.08, 28, "Reduce N top-dressing, spray validamycin", "Validamycin", 1.0, "L"),
    ("rice", "Brown planthopper", "pest", 0.22, 0.15, 27, "Spray buprofezin at base of plants", "Buprofezin", 0.8, "L"),
    ("rice", "Rice stem borer", "pest", 0.15, 0.10, 26, "Pheromone traps + chlorantraniliprole spray", "Chlorantraniliprole", 0.15, "L"),
    ("wheat", "Wheat leaf rust", "disease", 0.16, 0.14, 18, "Spray triadimefon at first pustules", "Triadimefon", 0.5, "kg"),
    ("wheat", "Powdery mildew", "disease", 0.14, 0.10, 17, "Spray tebuconazole", "Tebuconazole", 0.4, "L"),
    ("wheat", "Wheat aphid", "pest", 0.25, 0.16, 20, "Spray imidacloprid when >500/100 tillers", "Imidacloprid", 0.3, "L"),
]
insert("pest_catalog", ["crop", "name", "category", "growth_rate", "spread_prob", "optimum_temp", "control_measure",
                        "pesticide", "dose_per_ha", "dose_unit"], catalog)
pests = []
for fid in random.sample(sorted(field_meta.keys()), 11):
    m = field_meta[fid]
    c = random.choice([c for c in catalog if c[0] == m["crop"]])
    off = -random.randint(0, 20)
    pests.append((fid, c[1], c[2], d(off), random.choice(["NE corner", "Centre", "SW edge", "Along canal", "N edge"]),
                  "/images/pests/%s.svg" % c[1].lower().replace(" ", "_"), random.randint(15, 600),
                  round(random.uniform(20, 900), 1), team_leaders[m["dep"]], dt(off, 9)))
insert("pests", ["field_id", "pest_name", "category", "occurred_on", "location_desc", "image_url", "individuals",
                 "damaged_area_m2", "created_by", "created_at"], pests)

# --------------------------------------------------------------------------- power
stations = [
    (1, "Main substation", "substation", 10, 530, 665, 800, "normal"),
    (2, "Transformer T1 (rice north)", "transformer", 5, 270, 322, 250, "normal"),
    (3, "Transformer T2 (rice south)", "transformer", 6, 270, 640, 250, "normal"),
    (4, "Transformer T3 (wheat)", "transformer", 7, 790, 322, 250, "fault"),
    (5, "Pump station P1", "pump", 10, 25, 150, 160, "normal"),
    (6, "Pump station P2", "pump", 10, 25, 470, 160, "normal"),
    (7, "Seed processing plant", "dryer", 9, 1060, 630, 300, "normal"),
    (8, "Office & laboratory", "building", 1, 1060, 60, 80, "normal"),
    (9, "Machinery workshop", "building", 9, 1060, 330, 120, "normal"),
    (10, "Wheat team service hall", "building", 8, 790, 640, 60, "normal"),
]
insert("power_stations", ["id", "name", "type", "department_id", "x", "y", "capacity_kw", "load_kw", "status"],
       [s[:7] + (round(s[6] * random.uniform(0.35, 0.8), 1), s[7]) for s in stations])
lines_ = [(1, 2, 10.0, "normal"), (1, 3, 10.0, "normal"), (1, 4, 10.0, "fault"), (1, 7, 0.4, "normal"),
          (1, 9, 0.4, "normal"), (9, 8, 0.4, "normal"), (2, 5, 0.4, "normal"), (3, 6, 0.4, "normal"),
          (4, 10, 0.4, "fault")]
insert("power_lines", ["from_station", "to_station", "voltage_kv", "status"], lines_)
pc = []
for s in stations:
    for off in range(-120, 1):
        base = s[6] * 4 * random.uniform(0.6, 1.2)
        if s[2] == "pump" and off > -60:
            base *= 1.4
        pc.append((s[0], s[3], d(off), round(base, 1)))
insert("power_consumption", ["station_id", "department_id", "reading_date", "kwh"], pc, chunk=500)

# --------------------------------------------------------------------------- equipment
eq_types = [("Tractor", 4, 9, 30), ("Combine harvester", 3, 9, 55), ("Rice transplanter", 3, 9, 22),
            ("Boom sprayer", 3, 9, 15), ("Grain drill", 2, 9, 18), ("Fertiliser spreader", 2, 9, 12),
            ("Water pump", 4, 10, 6), ("Grain dryer", 2, 9, 40), ("Power weeder", 3, 9, 8)]
equipment = []
k = 0
reasons = ["Hydraulic leak", "Waiting for spare part", "Scheduled maintenance", "No operator assigned", "Engine fault"]
for name, cnt, dep, cost in eq_types:
    for i in range(cnt):
        k += 1
        st = random.choice(["operating", "operating", "operating", "idle", "repair"])
        fid = random.choice(sorted(field_meta.keys()))
        m = field_meta[fid]
        if st == "operating":
            x, y = m["x"] + random.randint(15, 85), m["y"] + random.randint(15, 60)
        else:
            x, y = 1060 + random.randint(-25, 25), 330 + random.randint(-60, 60)
        rng = "F-%02d..F-%02d" % (fid, min(48, fid + random.randint(1, 4))) if st != "repair" else "-"
        equipment.append(("%s #%d" % (name, i + 1), "EQ-%03d" % k, name, dep, st, rng,
                          None if st == "operating" else random.choice(reasons), x, y, cost, dt(0, 7)))
insert("equipment", ["designation", "equipment_no", "type", "department_id", "status", "range_desc", "reason", "x", "y",
                     "hourly_cost", "updated_at"], equipment)

# --------------------------------------------------------------------------- irrigation
pumps = [(1, "Pump P1 (north intake)", 25, 150, "running", 820.0, 75.0),
         (2, "Pump P2 (south intake)", 25, 470, "running", 760.0, 75.0),
         (3, "Booster B1", 530, 25, "stopped", 300.0, 30.0), (4, "Booster B2", 530, 615, "fault", 300.0, 30.0)]
insert("irrigation_pumps", ["id", "name", "x", "y", "status", "flow_m3h", "power_kw"], pumps)
canals = [("Main canal north", "main", 1, "25,150;25,30;1000,30", 800.0),
          ("Main canal south", "main", 2, "25,470;25,615;1000,615", 750.0)]
for c in range(COLS):
    x = 60 + c * 112 + (36 if c >= 4 else 0) + 50
    canals.append(("Branch N%d" % (c + 1), "branch", 1 if c < 4 else 3, "%d,30;%d,50" % (x, x), 150.0))
    canals.append(("Branch S%d" % (c + 1), "branch", 2 if c < 4 else 4, "%d,615;%d,598" % (x, x), 150.0))
for r in range(ROWS - 1):
    y = 50 + r * 92 + 78 + 7
    canals.append(("Field ditch R%d" % (r + 1), "branch", 1 if r < 3 else 2, "25,%d;1000,%d" % (y, y), 120.0))
canals.append(("Central drain", "drain", None, "530,30;530,615", 400.0))
insert("irrigation_canals", ["name", "canal_type", "pump_id", "points", "capacity_m3h"], canals)

# --------------------------------------------------------------------------- attendance
att = []
for off in range(-6, 1):
    for dep in sorted(farmers):
        dep_fields = [f for f, m in field_meta.items() if m["dep"] == dep] or sorted(field_meta.keys())
        for u in farmers[dep] + [team_leaders[dep]]:
            if random.random() < 0.85:
                att.append((d(off), "operator", u, None, random.choice(sorted(dep_fields))))
    for i in range(random.randint(2, 7)):
        att.append((d(off), "visitor", None, "Visitor %d" % (i + 1), random.choice(sorted(field_meta.keys()))))
insert("attendance", ["att_date", "kind", "user_id", "visitor_name", "field_id"], att)

# --------------------------------------------------------------------------- yield history
yh = []
for fid in sorted(field_meta):
    m = field_meta[fid]
    c = cult[m["cv"]]
    for yr_off in range(1, 7):
        rice = m["crop"] == "rice"
        n_app = random.uniform(80, 200) if rice else random.uniform(60, 180)
        t = random.uniform(19, 25) if rice else random.uniform(8, 13)
        rain = random.uniform(500, 1200)
        till = c[8] * random.uniform(0.75, 1.1)
        spad = random.uniform(32, 45)
        y = (c[9] * (1 - 0.06 * (m["grade"] - 1)) * (1 - ((n_app - 150) / 300.0) ** 2)
             * (1 - abs(t - (22 if rice else 11)) * 0.03) * (0.9 + 0.1 * till / c[8])
             * (0.92 + (spad - 32) / 160.0) * random.uniform(0.95, 1.05))
        yh.append((fid, Raw("YEAR(CURDATE()) - %d" % yr_off), m["crop"], m["cv"], round(n_app, 1), round(t, 2),
                   round(rain, 1), round(till, 2), round(spad, 2), round(y, 2)))
insert("yield_history", ["field_id", "year", "crop", "cultivar_id", "n_applied", "avg_temp", "rainfall", "max_tillers",
                         "spad", "yield_t_ha"], yh)

exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_plans.py"), encoding="utf-8").read())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_machinery.py"), encoding="utf-8").read())
w("SET FOREIGN_KEY_CHECKS = 1;")
with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("written %s (%d lines)" % (OUT, len(lines)))
