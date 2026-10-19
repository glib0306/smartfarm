# Seed Farm Smart Integrated Manufacturing System (MES + CPS)

A Manufacturing Execution System (MES) and a Cyber-Physical System (CPS) for wheat and rice seed farms.
Both systems run fully offline on one Windows PC and share a single MySQL database, `smartfarm`.

| Layer | MES | CPS |
|---|---|---|
| Frontend | React 17 + Recharts, SVG farm maps, react-leaflet machinery map | React 17 + Three.js (3D crops) + Recharts |
| Backend | Node + Express, port 4000 | Node + Express, port 5000 |
| Analytics | Python (`analytics/`), called by both backends | same |
| Database | MySQL / MariaDB in XAMPP: `database/smartfarm.sql` | same database |

Target environment: Windows 10 64-bit, XAMPP v3.2.2 (MariaDB 10.1), Node v12, Python v3.7.
No CDN, web font or external service is used at run time. The Python code uses only the standard library.

## Project structure

```
smartfarm/
├─ database/
│  ├─ schema.sql            table definitions (32 tables)
│  ├─ generate_sql.py       generates smartfarm.sql (schema + all virtual data)
│  ├─ seed_plans.py         seeds the approved plan chain and daily reports
│  ├─ seed_machinery.py     seeds crop/machine types, road network, harvest conditions, telemetry
│  └─ smartfarm.sql         DELIVERABLE: schema + virtual data, ready to import
├─ analytics/               Python engine (JSON on stdin -> JSON on stdout)
│  ├─ mathlib.py            simplex LP, BP neural network, PLS (NIPALS)
│  ├─ models.py             growth model, plan optimisation, pest spread, yield, fertility, CPS simulations
│  ├─ run.py                CLI bridge used by Node
│  └─ selftest.py
├─ common/                  shared Node modules (config, db, auth, python bridge, input builders)
├─ mes/backend/             Express API: routes/ and lib/
├─ mes/frontend/            React app (src/pages, src/components)
├─ cps/backend/server.js    Express API for simulations
├─ cps/frontend/            React + Three.js app
├─ tests/                   API smoke tests for MES and CPS, routing unit test
├─ import-db.bat  start-mes.bat  start-cps.bat
```

## Installation

1. **Database.** Start MySQL in the XAMPP control panel, then run `import-db.bat`.
   You can also import `database/smartfarm.sql` with phpMyAdmin. The script drops and recreates the `smartfarm` database.
2. **Node packages.** The first install needs a network connection, or a copy of `node_modules` from another machine.
   ```
   npm run install:all
   npm run build:all
   ```
3. **Python.** Install Python 3.7 or newer and make sure `python` is on the PATH. Otherwise set the `PYTHON` variable to the full path of `python.exe`.
4. **Start.** Run `start-mes.bat` and `start-cps.bat`, then open:
   - MES: http://localhost:4000
   - CPS: http://localhost:5000

Configuration is read from environment variables, with defaults in `common/config.js`:
`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PYTHON`, `MES_PORT`, `CPS_PORT`, `TOKEN_SECRET`.

For development, run `npm start` in `mes/frontend` or `cps/frontend`. The dev server proxies `/api` to ports 4000 and 5000.

## Demo accounts

Every account uses the password `1234`.

| User | Organisation level | What it shows |
|---|---|---|
| `admin` | 1 · Headquarters | All pages, including authorization management |
| `director` | 1 · Headquarters | Annual submission, monthly and 15-day approval, decision support |
| `planner` | 1 · Headquarters | Annual and monthly plans, no 15-day plan |
| `rice_div`, `wheat_div` | 2 · Division | Their division's 15-day plan; approve their teams' 5-day plans |
| `leader5` … `leader8` | 3 · Work team | 5-day plan (view), production diary |
| `farmer5_1` … | 3 · Work team | Home, weather, growth and pests only |
| `newcomer` | 3 · Work team | Login refused until the administrator approves it |

## Requirement coverage

### MES functions

| # | Requirement | Where |
|---|---|---|
| 1 | Annual → monthly → 15-day → 5-day orders, plan revision and review | `routes/plans.js`, `lib/planService.js`, `analytics.derive_plan`. Each period gets three LP-optimised variants derived from the approved parent plan. Fulfilment review is in `routes/fulfilment.js`. The 15-day split can be 14, 15 or 16 days. The last 5-day period can be a six-day plan. |
| 2 | Sensor data from ACS, soil and irrigation | `POST /api/farm/sensors/ingest`. The weather page also analyses rainfall, degree-days, frost and moisture alerts. |
| 3 | Whole-process display and integration | Home, plans, fulfilment, diary and maps all share one data model. |
| 4 | Growth diagnosis and prediction, nutrition, pests, yield, self-learning, decision support | Growth model calibrated per field from survey data. Each calibration is stored in `model_params`. Nutrient diagnosis, pest spread model, BP neural network yield prediction, re-train buttons. |
| 5 | Power consumption monitoring, analysis and distribution | Power consumption page, power system page, and load-transfer proposals for faulty or overloaded nodes. |
| 6 | Redistribution of manpower, equipment and water | Decision support, resource tab. Transport LP over the teams' current 5-day plans. |
| 7 | Water holding capacity and soil fertility by land grade | Decision support, soil tab. PLS regression, available water, irrigation interval, and measures per field. |
| 8 | Optimised solutions to ERP (deep learning, LP, PLS, BP NN) | "Provide to ERP" buttons. The ERP interface log is in `erp_submissions`. |
| 9 | Authority management | Menu permissions per user, organisation-level rules, admin-approved logins. |
| 10 | Organisation system (hierarchy) | Authorization management, organisation tab. Three levels. |

### MES interface (requirements 1–18)

Every MES page in the specification is implemented and appears in the navigation under the headings the specification gives.
The navigation shows only the items the user's identifier is permitted to see.
The data editing rule (requirement 18) applies to pest records and daily reports. Records from earlier dates create an edit request. The change is applied only after both the person who entered it and a different manager ratify it, using the **Ratification** link in the header.

### CPS

| Tab | Content |
|---|---|
| Production plan simulation | Pick any MES plan variant. Left: expected yield (P10/P50/P90) from 400 Monte-Carlo weather and pest scenarios. Right: profit distribution, plus a comparison of all variants for the period. |
| Growth simulation by growth stage | Three.js rice (left) and wheat (right) plots rebuilt for each week from the MES growth predictions: leaves, tillers, height, panicles or spikes, and ripening colour. |
| Response measures simulation | CPS function 1. Choose measures; growth is predicted with and without them, using current meteorological, soil and pest data. |
| Disease and pest infestation simulation | Map of fields expected to develop disease (red) or pests (yellow), with details per field and the spread over time. |

### Harvest & machinery map

MES page **Harvest & machinery map** (`/machinery-map`, menu permission `machinery_map`). It is built with react-leaflet 3.1 on
`L.CRS.Simple` with metres as map units, so it needs no tile server and works offline. Code: `mes/frontend/src/pages/MachineryMap.js`,
`mes/backend/routes/machinery.js`, `mes/backend/lib/machinery.js`, `mes/backend/lib/routing.js`.

| Layer / tab | Content |
|---|---|
| Harvest conditions | Fields coloured growing / approaching / ready / harvesting / harvested, from `harvest_conditions` (maturity, grain moisture, lodging, expected yield, harvested %). Harvested share of a field is drawn on it. The panel ranks ready fields by lodging, rain forecast and grain moisture against the crop's harvest window (`crop_types`). |
| Machinery (live) | Every machine, polled every 3 s, coloured by operating status, with heading arrow and a 5-minute trail. A machine that posted GPS to `POST /api/machinery/telemetry` in the last 2 minutes is shown where it reported. Otherwise operating machines are simulated from their latest report: field machines work the field back and forth, grain trucks shuttle between their field and the seed plant. Low fuel and lost GPS signal raise alerts. |
| Shortest path | Dijkstra over `road_nodes` / `road_edges` between two points, each a map click, a machine, a field or a facility. Choose shortest distance or fastest time. The vehicle's width and weight exclude lanes that are too narrow or weak, closed roads are never used, and mud slows wheeled machines more than tracked ones. The result lists each road with length and time and the detour forced by restrictions. |

Telemetry intake (machine terminals on the LAN, same token as the other APIs):

```
POST /api/machinery/telemetry
{ "records": [{ "equipment_id": 6, "x": 312, "y": 190, "speed_kmh": 4.5, "heading": 90, "fuel_pct": 61, "status": "operating" }] }
```

`x` and `y` are farm map units (0–1100 × 0–700, 1 unit = 2 m, y pointing south), the same as the SVG maps.
The seed data adds 14 machines (crawler combines, grain trucks and carts, rotary tillers, balers, a laser leveller), so there are 40 in total across 15 machine types.
react-leaflet is pinned to 3.1.0 with `@react-leaflet/core` 1.0.2 (leaflet 1.9.4). Later 3.x releases ship `??` / `?.` syntax that the webpack 4 in react-scripts 4 cannot parse.
`crop_types` also lists barley, maize, soybean and rapeseed as reference crops. Only rice and wheat are planted, because the plan, growth and pest models are built for those two crops.

## Assumptions

- **Missing CPS page.** The photographed specification lacks the first CPS interface page. The CPS screens follow the remaining text and the two CPS functions. The response-measures tab covers CPS function 1.
- **ERP is not part of this project.** "Submitting to ERP" writes the full payload to `erp_submissions`, and ratification is immediate. Another system can read that table, or the code can be pointed at a real ERP endpoint later.
- **"Approved annual plan" means the annual plan submitted to and ratified by ERP.** The seed data has Variant A submitted and Variant B as a draft, so the duplicate-submission warning can be tried.
- **Extra navigation item.** "Decision support (ERP)" is added to host MES functions 6–8, which have no screen in the interface specification.
- **Virtual data dates.** Weather, sensor, survey, pest, power and attendance data use dates relative to `CURDATE()`, so they are current whenever the file is imported. The seeded plan chain and daily reports have fixed dates for the previous and current month at the time the SQL was generated. To re-anchor them, run `python database/generate_sql.py` and import again. Plans for any new period are generated automatically on first visit.
- **Seasons are compressed** in the virtual data, so rice and wheat both show visible growth at the same time.

## Testing

```
python analytics/selftest.py          # LP, BP NN, PLS, growth, pest and simulation models
node tests/mes_api_test.js 4000       # 69 MES API checks; import a fresh database first
node tests/routing_test.js            # machinery routing (Dijkstra), no database needed
node tests/cps_api_test.js 5000       # CPS API checks
```
