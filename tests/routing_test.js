// Unit test for the machinery routing library (no database needed): node tests/routing_test.js
var assert = require('assert');
var routing = require('../mes/backend/lib/routing');

// A square of roads 0-100 with a narrow muddy short cut across the middle:
//   1 ---- 2
//   |  5---|---6   (5-6 is a narrow lane at y=50, joining the left and right roads at 3 and 4)
//   3 ---- 4
var nodes = [{ id: 1, x: 0, y: 0 }, { id: 2, x: 100, y: 0 }, { id: 3, x: 0, y: 100 }, { id: 4, x: 100, y: 100 },
  { id: 5, x: 0, y: 50 }, { id: 6, x: 100, y: 50 }];
function edge(id, a, b, extra) {
  return Object.assign({ id: id, from_node: a, to_node: b, name: 'E' + id, road_class: 'main', surface: 'gravel',
    width_m: 6, max_weight_t: 20, speed_limit_kmh: 30, road_state: 'good' }, extra || {});
}
var edges = [edge(1, 1, 2), edge(2, 1, 5), edge(3, 5, 3), edge(4, 2, 6), edge(5, 6, 4), edge(6, 3, 4),
  edge(7, 5, 6, { width_m: 3, max_weight_t: 6, speed_limit_kmh: 12, road_state: 'muddy' })];

var checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

// shortest: the lane across the middle (left road -> lane -> right road)
var r = routing.findRoute(nodes, edges, { x: 0, y: 50 }, { x: 100, y: 50 }, { optimize: 'distance' });
ok(r && r.distance_m === 200, 'shortest uses the 100-unit lane (200 m), got ' + (r && r.distance_m));
ok(r.segments.length === 1 && r.segments[0].name === 'E7', 'single lane segment');
ok(r.muddy_m === 200, 'muddy metres reported');

// fastest: muddy lane at 12 km/h * 0.4 is slower than 300 units of good road at 30 km/h
var fast = routing.findRoute(nodes, edges, { x: 0, y: 50 }, { x: 100, y: 50 }, { optimize: 'time' });
ok(fast.distance_m === 400 && fast.time_s < r.time_s, 'fastest avoids the muddy lane');

// a tracked machine copes with mud (0.8): 200 m @ 9.6 km/h = 75 s, still slower than 400 m @ 30 km/h = 48 s
var tracked = routing.findRoute(nodes, edges, { x: 0, y: 50 }, { x: 100, y: 50 },
  { optimize: 'time', profile: { width_m: 2.5, weight_t: 4, road_speed_kmh: 30, field_speed_kmh: 4, tracked: 1 } });
ok(tracked.time_s === 48, 'tracked machine time ' + tracked.time_s);

// a wide/heavy machine cannot use the lane at all
var wide = routing.findRoute(nodes, edges, { x: 0, y: 50 }, { x: 100, y: 50 },
  { optimize: 'distance', profile: { width_m: 3.8, weight_t: 11, road_speed_kmh: 20, field_speed_kmh: 5 } });
ok(wide.distance_m === 400, 'wide machine detours, got ' + wide.distance_m);
ok(routing.blockedReason(edges[6], { width_m: 3.8, weight_t: 1 }) === 'too narrow', 'too narrow reason');
// ...but standing on that lane it may use it to reach the nearest junction (flagged as restricted access)
var access = routing.findRoute(nodes, edges, { x: 30, y: 50 }, { x: 100, y: 0 },
  { optimize: 'distance', profile: { width_m: 3.8, weight_t: 11, road_speed_kmh: 20, field_speed_kmh: 5 } });
ok(access.segments[0].restricted === 'too narrow' && access.restricted_m === 140, 'restricted access leg ' + JSON.stringify(access.segments[0]));
ok(access.distance_m === 240, 'access to node 6 then up to 2 (140 + 100 m), got ' + access.distance_m);
ok(routing.blockedReason(edges[6], { width_m: 2, weight_t: 11 }) === 'weight limit', 'weight reason');

// closed road is never used; points off the network get off-road legs
var closed = edges.map(function (e) { return e.id === 1 ? Object.assign({}, e, { road_state: 'closed' }) : e; });
var c = routing.findRoute(nodes, closed, { x: 10, y: -10 }, { x: 90, y: -10 }, { optimize: 'distance' });
ok(c.segments.every(function (s) { return s.edge_ids.indexOf(1) < 0; }), 'closed edge avoided');
ok(c.segments[0].road_class === 'off-road' && c.segments[c.segments.length - 1].road_class === 'off-road', 'off-road legs at both ends');

// both points on the same edge
var same = routing.findRoute(nodes, edges, { x: 20, y: 0 }, { x: 70, y: 0 }, {});
ok(same.distance_m === 100, 'same-edge route 100 m, got ' + same.distance_m);

// inside one field the straight drive wins when allowed
var direct = routing.findRoute(nodes, edges, { x: 30, y: 30 }, { x: 35, y: 30 }, { allowDirect: true });
ok(direct.segments.length === 1 && direct.distance_m === 10, 'direct in-field drive');

// no route when everything is closed
var none = routing.findRoute(nodes, edges.map(function (e) { return Object.assign({}, e, { road_state: 'closed' }); }),
  { x: 0, y: 0 }, { x: 100, y: 100 }, {});
ok(none === null, 'no passable route');

// polyline helpers
var p = routing.pointAlong([[0, 0], [10, 0], [10, 10]], 15);
ok(p.x === 10 && p.y === 5 && p.heading === 180, 'pointAlong ' + JSON.stringify(p));
ok(routing.polylineLength([[0, 0], [3, 4]]) === 5, 'polylineLength');

console.log('routing: ' + checks + ' checks passed');
