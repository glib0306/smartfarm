# -*- coding: utf-8 -*-
# Executed inside generate_sql.py (shares its namespace), after seed_plans.py.
# Seeds the harvest & machinery map: crop and machine type catalogues, the farm road network,
# daily harvest condition assessments, extra machinery and recent machine telemetry.
# Uses its own random generator so every table generated before it stays unchanged.

mrng = random.Random(20261016)

# --------------------------------------------------------------------------- crop types
crop_types = [
    # code, name, family, colour, moisture max / min / storage, typical yield, harvest machine, planted
    ("rice", "Rice (paddy)", "Poaceae", "#2f9e6f", 25.0, 18.0, 14.0, 7.4, "Crawler combine", 1),
    ("wheat", "Wheat", "Poaceae", "#c9a227", 20.0, 13.0, 13.0, 5.2, "Combine harvester", 1),
    ("barley", "Barley", "Poaceae", "#b8735a", 20.0, 13.0, 13.0, 4.8, "Combine harvester", 0),
    ("maize", "Maize (seed)", "Poaceae", "#e07b39", 35.0, 25.0, 13.0, 6.5, "Combine harvester", 0),
    ("soybean", "Soybean", "Fabaceae", "#5c8a2e", 18.0, 11.0, 12.0, 2.6, "Combine harvester", 0),
    ("rapeseed", "Rapeseed", "Brassicaceae", "#d1b000", 18.0, 9.0, 8.0, 2.9, "Combine harvester", 0),
]
insert("crop_types", ["code", "name", "family", "color", "harvest_moisture_max", "harvest_moisture_min",
                      "storage_moisture", "typical_yield_t_ha", "harvest_machine_type", "planted"], crop_types)
CROP_TYPE = {c[0]: c for c in crop_types}

# --------------------------------------------------------------------------- machine types
machine_types = [
    # type, code, category, operation, crops, mobile, tracked, width, weight, road km/h, field km/h, ha/h, fuel L/h, colour
    ("Tractor", "TR", "tillage", "Ploughing, puddling and haulage", "rice,wheat", 1, 0, 2.4, 5.5, 30, 8, 0.8, 9.0, "#2a78d6"),
    ("Rotary tiller", "RO", "tillage", "Post-harvest tillage and stubble mulching", "rice,wheat", 1, 0, 2.3, 4.2, 25, 6, 0.6, 9.5, "#4d6fa8"),
    ("Laser leveller", "LL", "tillage", "Precision land levelling of paddies", "rice", 1, 0, 3.0, 6.0, 20, 6, 0.5, 9.0, "#3fa7b5"),
    ("Rice transplanter", "RT", "planting", "Mechanical transplanting of nursery seedlings", "rice", 1, 0, 2.1, 0.9, 12, 4, 0.4, 3.0, "#2f9e6f"),
    ("Grain drill", "GD", "planting", "Row sowing of wheat seed", "wheat", 1, 0, 3.0, 3.5, 20, 9, 1.5, 8.0, "#5c8a2e"),
    ("Fertiliser spreader", "FS", "crop care", "Broadcast top-dressing", "rice,wheat", 1, 0, 2.5, 1.5, 25, 12, 5.0, 5.0, "#7b61c9"),
    ("Boom sprayer", "BS", "crop care", "Herbicide, fungicide and pesticide spraying", "rice,wheat", 1, 0, 3.0, 4.0, 25, 10, 4.0, 6.0, "#c94f7c"),
    ("Power weeder", "PW", "crop care", "Inter-row weeding", "rice", 1, 0, 0.9, 0.15, 6, 3, 0.1, 1.0, "#8a6d4f"),
    ("Combine harvester", "CH", "harvest", "Wheeled combine harvesting (wheat, drained paddy)", "wheat,rice", 1, 0, 3.8, 11.0, 20, 5, 1.0, 22.0, "#e07b39"),
    ("Crawler combine", "CC", "harvest", "Tracked rice combine for soft paddy soil", "rice", 1, 1, 2.6, 4.5, 10, 4, 0.5, 14.0, "#d1495b"),
    ("Grain cart", "GC", "transport", "In-field grain transfer from combines", "rice,wheat", 1, 0, 3.2, 9.0, 25, 10, 0.0, 10.0, "#c9a227"),
    ("Grain truck", "GT", "transport", "Grain haulage from field to seed plant", "rice,wheat", 1, 0, 2.5, 14.0, 40, 15, 0.0, 12.0, "#b8735a"),
    ("Straw baler", "SB", "post-harvest", "Straw collection and baling", "rice,wheat", 1, 0, 2.8, 4.0, 25, 8, 1.2, 10.0, "#9c7a3c"),
    ("Water pump", "WP", "irrigation", "Portable irrigation pumping", "rice,wheat", 0, 0, 1.2, 0.4, 0, 0, 0.0, 2.5, "#2f78a8"),
    ("Grain dryer", "DR", "post-harvest", "Seed drying at the processing plant", "rice,wheat", 0, 0, 3.0, 8.0, 0, 0, 0.0, 0.0, "#6b5b4b"),
]
insert("machine_types", ["type", "code", "category", "operation", "crops", "mobile", "tracked", "width_m", "weight_t",
                         "road_speed_kmh", "field_speed_kmh", "work_rate_ha_h", "fuel_l_h", "color"], machine_types)
MTYPE = {m[0]: m for m in machine_types}

# --------------------------------------------------------------------------- road network (1 map unit = 2 m)
XS = [46, 166, 278, 390, 528, 650, 762, 874, 992]   # west headland, rice lanes, central road, wheat lanes, east headland
YS = [40, 135, 227, 319, 411, 503, 600]             # north headland, cross lanes between field rows, south headland
road_nodes = []
node_at = {}


def add_node(x, y, kind="junction", name=None):
    nid = len(road_nodes) + 1
    road_nodes.append((nid, name, kind, x, y))
    node_at[(x, y)] = nid
    return nid


for y in YS:
    for x in XS:
        add_node(x, y)
FACILITIES = [(1050, 40, "junction", None), (1050, 60, "facility", "Office & laboratory"),
              (1050, 319, "junction", None), (1050, 330, "facility", "Machinery workshop"),
              (1050, 470, "facility", "Fuel depot"), (1050, 600, "junction", None),
              (1050, 630, "facility", "Seed processing plant")]
for x, y, kind, name in FACILITIES:
    add_node(x, y, kind, name)
add_node(528, 655, "gate", "Main gate")
insert("road_nodes", ["id", "name", "kind", "x", "y"], road_nodes)

ROAD_SPEC = {  # surface, width m, max weight t, speed limit km/h
    "main": ("concrete", 6.0, 25.0, 30.0),
    "headland": ("gravel", 5.0, 15.0, 25.0),
    "service": ("concrete", 6.0, 25.0, 20.0),
    "lane_rice": ("earth", 3.0, 6.0, 12.0),
    "lane_wheat": ("gravel", 4.0, 12.0, 15.0),
    "cross": ("earth", 4.5, 15.0, 15.0),    # farm roads along the ditches between field rows
}
CLOSED = {((528, 319), (528, 411)): "Culvert repair - closed until further notice",
          ((992, 135), (992, 227)): "Washout after heavy rain"}
road_edges = []


def add_edge(a, b, name, spec_key, road_class):
    surface, width, weight, speed = ROAD_SPEC[spec_key]
    state, note = "good", None
    if (a, b) in CLOSED:
        state, note = "closed", CLOSED[(a, b)]
    elif surface == "earth":
        r = mrng.random()
        # paddy-side lanes stay wet during the rice harvest
        if r < (0.3 if spec_key == "lane_rice" or a[0] < 528 else 0.1):
            state = "muddy"
        elif r < 0.45:
            state = "rutted"
    elif surface == "gravel" and mrng.random() < 0.12:
        state = "rutted"
    road_edges.append((node_at[a], node_at[b], name, road_class, surface, width, weight, speed, state, note))


for yi, y in enumerate(YS):
    for i in range(len(XS) - 1):
        a, b = (XS[i], y), (XS[i + 1], y)
        if y in (YS[0], YS[-1]):
            add_edge(a, b, "North headland road" if y == YS[0] else "South headland road", "headland", "headland")
        else:
            side = "rice" if XS[i + 1] <= 528 else "wheat"
            add_edge(a, b, "Cross road %d (%s)" % (yi, side), "cross", "farm")
for x in XS:
    for j in range(len(YS) - 1):
        a, b = (x, YS[j]), (x, YS[j + 1])
        if x == 528:
            add_edge(a, b, "Central road", "main", "main")
        elif x in (XS[0], XS[-1]):
            add_edge(a, b, "West headland track" if x == XS[0] else "East headland road", "headland", "headland")
        elif x < 528:
            add_edge(a, b, "Rice lane %d" % XS.index(x), "lane_rice", "lane")
        else:
            add_edge(a, b, "Wheat lane %d" % (XS.index(x) - 4), "lane_wheat", "lane")
service = [(x, y) for x, y, _, _ in FACILITIES]
for i in range(len(service) - 1):
    add_edge(service[i], service[i + 1], "Service road", "service", "service")
for y in (40, 319, 600):
    add_edge((992, y), (1050, y), "Service access", "service", "service")
add_edge((528, 600), (528, 655), "Central road", "main", "main")
insert("road_edges", ["from_node", "to_node", "name", "road_class", "surface", "width_m", "max_weight_t",
                      "speed_limit_kmh", "road_state", "note"], road_edges)

# --------------------------------------------------------------------------- harvest conditions
hf = sorted(harvest_fields) or sorted(f for f, m in field_meta.items() if m["cv"] == 1)[:4]
third = max(1, len(hf) // 3)
HARVESTED, HARVESTING = set(hf[:third]), set(hf[third:2 * third])


def maturity_rate(m):
    """maturity % gained per day (rice season is compressed like the wheat one, see growth surveys)"""
    return 125.0 / cult[m["cv"]][4] if m["crop"] == "rice" else 100.0 / 110


def readiness_for(mat):
    return "growing" if mat < 80 else ("approaching" if mat < 95 else "ready")


hc_rows = []
hc_now = {}
for fid in sorted(field_meta):
    m = field_meta[fid]
    ct = CROP_TYPE[m["crop"]]
    rate = maturity_rate(m)
    mat0 = 100.0 if fid in harvest_fields else min(94.0 if m["cv"] != 1 else 99.0, -m["sow"] * rate)
    lodging = mrng.choice([0, 0, 0, 1, 2, 3, 5]) + (mrng.uniform(10, 22) if fid in abnormal_fields else 0)
    yld = cult[m["cv"]][9] * (1 - 0.06 * (m["grade"] - 1)) * (0.85 if fid in abnormal_fields else 1.0) * mrng.uniform(0.94, 1.05)
    h_done = mrng.uniform(25, 70)
    for off in range(-6, 1):
        mat = max(0.0, min(100.0, mat0 - rate * -off))
        moist = None
        if mat >= 60:
            moist = ct[5] + 1.5 + (100 - mat) * 0.55 + mrng.uniform(-1.2, 1.2)
        state = readiness_for(mat)
        pct = 0.0
        if fid in HARVESTING:
            pct = max(0.0, h_done - 15 * -off)
        elif fid in HARVESTED:
            pct = max(0.0, min(100.0, 100 - 35 * (-1 - off)))
        if pct >= 100:
            state = "harvested"
        elif pct > 0:
            state = "harvesting"
        if fid in harvest_fields and state == "approaching":
            state = "ready"
        if moist is not None and state in ("harvesting", "harvested"):
            moist = min(moist, ct[4] - mrng.uniform(1, 4))
        if state in ("ready", "harvesting", "harvested"):
            est = d(off)
        else:
            est = d(off + int(math.ceil((95 - mat) / rate)))
        notes = None
        if lodging >= 10:
            notes = "Lodging %d%% - harvest early to limit losses" % lodging
        elif moist is not None and state == "ready" and moist > ct[4]:
            notes = "Grain moisture above %.0f%% - wait or plan drying" % ct[4]
        row = (fid, d(off), round(mat, 1), None if moist is None else round(moist, 1), round(lodging, 1),
               round(yld, 2), round(pct, 1), state, None if state == "harvested" else est, notes)
        hc_rows.append(row)
        if off == 0:
            hc_now[fid] = state
insert("harvest_conditions", ["field_id", "assessed_on", "maturity_pct", "grain_moisture_pct", "lodging_pct",
                              "expected_yield_t_ha", "harvested_pct", "readiness", "est_harvest_date", "notes"],
       hc_rows, chunk=500)

# --------------------------------------------------------------------------- extra machinery
machines = []  # dicts for every equipment row, existing ones first (ids 1..n follow insertion order)
for i, e in enumerate(equipment):
    machines.append(dict(id=i + 1, designation=e[0], type=e[2], status=e[4], reason=e[6], x=e[7], y=e[8],
                         range_desc=e[5], changed=False))
extra = [("Crawler combine", ["operating", "operating", "repair"]), ("Rotary tiller", ["operating", "repair"]),
         ("Grain truck", ["operating", "operating", "operating", "idle"]), ("Grain cart", ["operating", "idle"]),
         ("Straw baler", ["operating", "idle"]), ("Laser leveller", ["idle"])]
extra_cost = {"Crawler combine": 45, "Rotary tiller": 20, "Grain truck": 18, "Grain cart": 14, "Straw baler": 16,
              "Laser leveller": 24}
new_rows = []
for name, states in extra:
    for i, st in enumerate(states):
        mid = len(machines) + 1
        x, y = 1050 + mrng.randint(-30, 30), 330 + mrng.randint(-50, 50)
        reason = None if st == "operating" else ("Scheduled maintenance" if st == "repair" else "Standby")
        machines.append(dict(id=mid, designation="%s #%d" % (name, i + 1), type=name, status=st, reason=reason,
                             x=x, y=y, range_desc="-", changed=False, new=True))
        new_rows.append([mid, "%s #%d" % (name, i + 1), "EQ-%03d" % mid, name, 9, st, "-", reason, x, y,
                         extra_cost[name], dt(0, 7)])

# --------------------------------------------------------------------------- machine work assignments
by_state = {}
for fid in sorted(field_meta):
    by_state.setdefault(hc_now[fid], []).append(fid)
rice_growing = [f for f in by_state.get("growing", []) + by_state.get("approaching", []) if field_meta[f]["crop"] == "rice"]
wheat_fields = [f for f in sorted(field_meta) if field_meta[f]["crop"] == "wheat"]
harvesting = by_state.get("harvesting", []) or by_state.get("ready", [])
harvested = by_state.get("harvested", []) or harvesting
WORK = {  # type -> (candidate fields, task)
    "Combine harvester": (harvesting + by_state.get("ready", []), "Harvesting"),
    "Crawler combine": (harvesting, "Harvesting"),
    "Grain cart": (harvesting, "Grain transfer"),
    "Grain truck": (harvesting, "Grain haulage to seed plant"),
    "Straw baler": (harvested, "Straw baling"),
    "Tractor": (harvested + wheat_fields[:2], "Post-harvest ploughing"),
    "Rotary tiller": (harvested, "Stubble tillage"),
    "Laser leveller": (harvested, "Land levelling"),
    "Boom sprayer": (wheat_fields, "Herbicide spraying"),
    "Fertiliser spreader": (wheat_fields, "Top-dressing"),
    "Power weeder": (rice_growing, "Weeding"),
}
SEASONAL = ("Rice transplanter", "Grain drill")
fx = dict((f[0], f) for f in fields)
counter = {}
assign = {}
for mc in machines:
    t = mc["type"]
    if t in SEASONAL and mc["status"] == "operating":
        mc.update(status="idle", reason="Out of season - stored", x=1050 + mrng.randint(-30, 30),
                  y=330 + mrng.randint(-50, 50), range_desc="-", changed=True)
    if mc["status"] != "operating":
        continue
    if t == "Grain dryer":
        mc.update(x=1062 + 8 * (mc["id"] % 2), y=640, range_desc="Seed processing plant", changed=True)
        assign[mc["id"]] = (None, "Seed drying")
        continue
    if t == "Water pump":
        cx = [f for f in fields if f[6] <= mc["x"] <= f[6] + f[8] and f[7] <= mc["y"] <= f[7] + f[9]]
        assign[mc["id"]] = (cx[0][0] if cx else None, "Irrigation pumping")
        continue
    cands, task = WORK.get(t, (wheat_fields, "Field work"))
    if not cands:
        cands = wheat_fields
    fid = cands[counter.get(t, 0) % len(cands)]
    counter[t] = counter.get(t, 0) + 1
    f = fx[fid]
    if t == "Grain truck":
        x, y = 1050, 630 - 8 * counter[t]
    else:
        x, y = f[6] + mrng.randint(12, f[8] - 12), f[7] + mrng.randint(12, f[9] - 12)
    mc.update(x=x, y=y, range_desc="F-%02d" % fid, changed=True)
    assign[mc["id"]] = (fid, task)
# machines that are not working stand in rows in the workshop yard (3 abreast, 24 map units apart)
slot = 0
for mc in machines:
    if mc["status"] != "operating" and MTYPE[mc["type"]][5]:
        mc.update(x=1026 + 24 * (slot % 3), y=186 + 24 * (slot // 3), changed=True)
        slot += 1
for mc in machines:
    if mc.get("new") or not mc["changed"]:
        continue
    w("UPDATE `equipment` SET `status` = %s, `reason` = %s, `x` = %d, `y` = %d, `range_desc` = %s WHERE `id` = %d;"
      % (q(mc["status"]), q(mc["reason"]), mc["x"], mc["y"], q(mc["range_desc"]), mc["id"]))
w()
for r in new_rows:
    mc = machines[r[0] - 1]
    r[6], r[8], r[9] = mc["range_desc"], mc["x"], mc["y"]
insert("equipment", ["id", "designation", "equipment_no", "type", "department_id", "status", "range_desc", "reason",
                     "x", "y", "hourly_cost", "updated_at"], [tuple(r) for r in new_rows])

# --------------------------------------------------------------------------- telemetry history (last 3 hours, every 10 minutes)
tele = []
for mc in machines:
    mt = MTYPE[mc["type"]]
    fid, task = assign.get(mc["id"], (None, None))
    fuel = mrng.uniform(45, 95)
    hours = mrng.uniform(300, 4200)
    working = mc["status"] == "operating" and mt[5]
    for k in range(18, -1, -1):
        jx = mrng.uniform(-10, 10) if working else 0
        jy = mrng.uniform(-8, 8) if working else 0
        speed = round(mt[10] * mrng.uniform(0.8, 1.05), 1) if working else 0.0
        tele.append((mc["id"], Raw("NOW() - INTERVAL %d MINUTE" % (k * 10)), round(mc["x"] + jx, 1),
                     round(mc["y"] + jy, 1), mrng.choice([0, 90, 180, 270]) if working else 0, speed,
                     round(min(99.0, fuel + (k * 10 / 60.0) * mt[12] * 0.4) if mc["status"] == "operating" else fuel, 1),
                     round(hours - (k * 10 / 60.0 if mc["status"] == "operating" else 0), 1),
                     mc["status"], fid, task, "sim"))
insert("machine_telemetry", ["equipment_id", "recorded_at", "x", "y", "heading", "speed_kmh", "fuel_pct",
                             "engine_hours", "status", "field_id", "task", "source"], tele, chunk=500)
