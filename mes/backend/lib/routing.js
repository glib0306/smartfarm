// Shortest / fastest path for agricultural machinery over the farm road network (Dijkstra).
// Pure functions: nodes {id, x, y}, edges {id, from_node, to_node, width_m, max_weight_t, speed_limit_kmh, road_state, ...}.
// Coordinates are farm map units; METERS_PER_UNIT converts them to metres.
var METERS_PER_UNIT = 2;

// speed multiplier for the road surface state; tracked machines cope better with mud
var STATE_FACTOR = { good: 1, rutted: 0.7, muddy: 0.4 };
var DEFAULT_PROFILE = { type: 'Tractor', width_m: 2.4, weight_t: 5.5, road_speed_kmh: 30, field_speed_kmh: 8, tracked: 0 };

function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

// Why an edge cannot be used by the machine profile, or null when it is passable.
function blockedReason(edge, profile) {
  if (edge.road_state === 'closed') return 'closed';
  if (profile.width_m > edge.width_m) return 'too narrow';
  if (profile.weight_t > edge.max_weight_t) return 'weight limit';
  return null;
}

function speedOn(edge, profile) {
  var f = edge.road_state === 'muddy' && profile.tracked ? 0.8 : (STATE_FACTOR[edge.road_state] || 1);
  return Math.min(profile.road_speed_kmh, edge.speed_limit_kmh) * f;
}

function seconds(meters, kmh) { return kmh > 0 ? meters / (kmh / 3.6) : Infinity; }

// Projects point p onto segment a-b: returns the fraction t along the segment, the point and the distance.
function project(p, a, b) {
  var dx = b.x - a.x;
  var dy = b.y - a.y;
  var len2 = dx * dx + dy * dy;
  var t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  var q = { x: a.x + t * dx, y: a.y + t * dy };
  return { t: t, point: q, d: dist(p, q) };
}

// Nearest point on a road that is not closed. A machine standing next to a lane that is too narrow or
// weak for it got there on that lane, so it may use it as access to the nearest junction.
function snap(p, edges, nodeById) {
  var best = null;
  edges.forEach(function (e) {
    if (e.road_state === 'closed') return;
    var pr = project(p, nodeById[e.from_node], nodeById[e.to_node]);
    if (!best || pr.d < best.d) best = { edge: e, t: pr.t, point: pr.point, d: pr.d };
  });
  return best;
}

// Finds the best route between two free points. optimize: 'distance' (shortest) or 'time' (fastest).
// The legs from each point to the nearest open road are driven off-road at field speed.
// opts.allowDirect (both points inside the same field) also considers driving straight across.
function findRoute(nodes, edges, from, to, opts) {
  opts = opts || {};
  var profile = Object.assign({}, DEFAULT_PROFILE, opts.profile || {});
  var optimize = opts.optimize === 'time' ? 'time' : 'distance';
  var road = roadRoute(nodes, edges, from, to, profile, optimize, !!opts.ignoreRestrictions);
  if (!opts.allowDirect) return road;
  var m = dist(from, to) * METERS_PER_UNIT;
  var direct = { optimize: optimize, distance_m: Math.round(m), time_s: Math.round(seconds(m, profile.field_speed_kmh)),
    straight_m: Math.round(m), points: [xy(from), xy(to)], muddy_m: 0,
    restricted_m: 0, segments: [{ name: 'In-field drive', road_class: 'off-road', road_state: 'off-road', surface: 'field',
      length_m: Math.round(m), time_s: Math.round(seconds(m, profile.field_speed_kmh)), edge_ids: [], points: [xy(from), xy(to)],
      restricted: null }] };
  var k = optimize === 'time' ? 'time_s' : 'distance_m';
  return !road || direct[k] <= road[k] ? direct : road;
}

function roadRoute(nodes, edges, from, to, profile, optimize, ignore) {
  var nodeById = {};
  nodes.forEach(function (n) { nodeById[n.id] = { id: n.id, x: Number(n.x), y: Number(n.y), name: n.name }; });

  var a = snap(from, edges, nodeById);
  var b = snap(to, edges, nodeById);
  if (!a || !b) return null;

  // adjacency with virtual nodes S (start snap, outgoing arcs only) and E (end snap, incoming only) splitting
  // their edges, so a restricted access edge can be left or entered but never driven through
  var adj = {};
  function link(u, v, lenUnits, edge, pts) {
    var m = lenUnits * METERS_PER_UNIT;
    var arc = { to: v, edge: edge, m: m, s: edge ? seconds(m, speedOn(edge, profile)) : 0, pts: pts,
      restricted: ignore ? null : blockedReason(edge, profile) };
    (adj[u] = adj[u] || []).push(arc);
  }
  edges.forEach(function (e) {
    if (!ignore && blockedReason(e, profile)) return;
    var p = nodeById[e.from_node];
    var q = nodeById[e.to_node];
    var len = dist(p, q);
    link(p.id, q.id, len, e, [p, q]);
    link(q.id, p.id, len, e, [q, p]);
  });
  nodeById.S = { id: 'S', x: a.point.x, y: a.point.y };
  nodeById.E = { id: 'E', x: b.point.x, y: b.point.y };
  [a, b].forEach(function (sn, i) {
    var v = i ? 'E' : 'S';
    var p = nodeById[sn.edge.from_node];
    var q = nodeById[sn.edge.to_node];
    var len = dist(p, q);
    if (v === 'S') {
      link(v, p.id, len * sn.t, sn.edge, [nodeById[v], p]);
      link(v, q.id, len * (1 - sn.t), sn.edge, [nodeById[v], q]);
    } else {
      link(p.id, v, len * sn.t, sn.edge, [p, nodeById[v]]);
      link(q.id, v, len * (1 - sn.t), sn.edge, [q, nodeById[v]]);
    }
  });
  if (a.edge.id === b.edge.id) {
    var pe = nodeById[a.edge.from_node];
    var qe = nodeById[a.edge.to_node];
    var l = dist(pe, qe) * Math.abs(a.t - b.t);
    link('S', 'E', l, a.edge, [nodeById.S, nodeById.E]);
  }

  // Dijkstra (the graph has ~70 nodes, a linear scan for the minimum is fast enough)
  var cost = { S: 0 };
  var prev = {};
  var done = {};
  var key = optimize === 'time' ? 's' : 'm';
  for (;;) {
    var u = null;
    Object.keys(cost).forEach(function (k) { if (!done[k] && (u === null || cost[k] < cost[u])) u = k; });
    if (u === null || u === 'E') break;
    done[u] = true;
    (adj[u] || []).forEach(function (arc) {
      var c = cost[u] + arc[key];
      if (cost[arc.to] === undefined || c < cost[arc.to]) { cost[arc.to] = c; prev[arc.to] = { from: u, arc: arc }; }
    });
  }
  if (cost.E === undefined) return null;

  var arcs = [];
  for (var v = 'E'; v !== 'S'; v = prev[v].from) arcs.unshift(prev[v].arc);
  var startLeg = { m: a.d * METERS_PER_UNIT, pts: [from, a.point] };
  var endLeg = { m: b.d * METERS_PER_UNIT, pts: [b.point, to] };
  startLeg.s = seconds(startLeg.m, profile.field_speed_kmh);
  endLeg.s = seconds(endLeg.m, profile.field_speed_kmh);

  var segments = [];
  function seg(name, edge, m, s, pts, restricted) {
    var last = segments[segments.length - 1];
    var id = edge ? edge.id : null;
    restricted = restricted || null;
    if (last && last.name === name && last.road_state === (edge ? edge.road_state : 'off-road') && last.restricted === restricted) {
      last.length_m += m;
      last.time_s += s;
      last.edge_ids = id ? last.edge_ids.concat(id) : last.edge_ids;
      last.points.push(xy(pts[1]));
      return;
    }
    segments.push({ name: name, road_class: edge ? edge.road_class : 'off-road', road_state: edge ? edge.road_state : 'off-road',
      surface: edge ? edge.surface : 'field', length_m: m, time_s: s, edge_ids: id ? [id] : [], points: pts.map(xy),
      restricted: restricted });
  }
  if (startLeg.m > 0.5) seg('Off-road to ' + a.edge.name, null, startLeg.m, startLeg.s, startLeg.pts);
  arcs.forEach(function (arc) { if (arc.m > 0) seg(arc.edge.name, arc.edge, arc.m, arc.s, arc.pts, arc.restricted); });
  if (endLeg.m > 0.5) seg('Off-road to destination', null, endLeg.m, endLeg.s, endLeg.pts);

  var points = [];
  segments.forEach(function (s) {
    s.points.forEach(function (p) {
      var last = points[points.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) points.push(p);
    });
    s.length_m = Math.round(s.length_m);
    s.time_s = Math.round(s.time_s);
  });
  var total = segments.reduce(function (acc, s) { return { m: acc.m + s.length_m, s: acc.s + s.time_s }; }, { m: 0, s: 0 });
  return {
    optimize: optimize,
    distance_m: total.m,
    time_s: total.s,
    straight_m: Math.round(dist(from, to) * METERS_PER_UNIT),
    points: points,
    segments: segments,
    muddy_m: sumWhere(segments, function (s) { return s.road_state === 'muddy'; }),
    restricted_m: sumWhere(segments, function (s) { return !!s.restricted; })
  };
}

function sumWhere(segments, pred) {
  return segments.filter(pred).reduce(function (x, s) { return x + s.length_m; }, 0);
}

function xy(p) { return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]; }

// Cumulative-length helper for moving along a polyline of [x, y] points: returns {x, y, heading}.
function pointAlong(points, units) {
  var acc = 0;
  for (var i = 1; i < points.length; i++) {
    var a = points[i - 1];
    var b = points[i];
    var len = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
    if (acc + len >= units || i === points.length - 1) {
      var t = len ? Math.max(0, Math.min(1, (units - acc) / len)) : 0;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, heading: headingOf(a, b) };
    }
    acc += len;
  }
  return { x: points[0][0], y: points[0][1], heading: 0 };
}

function polylineLength(points) {
  var s = 0;
  for (var i = 1; i < points.length; i++) s += Math.sqrt(Math.pow(points[i][0] - points[i - 1][0], 2) + Math.pow(points[i][1] - points[i - 1][1], 2));
  return s;
}

// compass heading in degrees, 0 = north (up on the map), 90 = east
function headingOf(a, b) {
  var h = Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI;
  return Math.round((h + 360) % 360);
}

module.exports = { METERS_PER_UNIT: METERS_PER_UNIT, DEFAULT_PROFILE: DEFAULT_PROFILE, blockedReason: blockedReason,
  findRoute: findRoute, pointAlong: pointAlong, polylineLength: polylineLength };
