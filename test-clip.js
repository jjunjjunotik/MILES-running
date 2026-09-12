// Run with: node test-clip.js
const Clip = require('./src/js/clip.js');

const sq = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
let fails = 0;
const check = (name, ok, info) => { if (!ok) { fails++; console.log('FAIL ' + name + (info ? ' :: ' + info : '')); } };

// Area of (A minus B) by stratified sampling — an oracle independent of the
// algorithm. A jittered grid, not a plain LCG: consecutive values from a weak
// LCG are correlated, and using them as (x, y) pairs lays samples on a lattice
// that biases the estimate by whole percent.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mcDifferenceArea(A, B, side = 700) {
  const xs = A.map((p) => p.x), ys = A.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const rnd = mulberry32(20260912);
  const dx = (x1 - x0) / side, dy = (y1 - y0) / side;
  let hit = 0;
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) {
      const p = { x: x0 + (i + rnd()) * dx, y: y0 + (j + rnd()) * dy };
      if (Clip.pointInRing(p, A) && !Clip.pointInRing(p, B)) hit++;
    }
  }
  return (hit / (side * side)) * (x1 - x0) * (y1 - y0);
}

const totalArea = (rings) => rings.reduce((s, r) => s + Clip.area(r), 0);

// 1. Half overlap
let r = Clip.difference(sq(0, 0, 10, 10), sq(5, -5, 10, 20));
check('half overlap area', Math.abs(totalArea(r.rings) - 50) < 0.01, `got ${totalArea(r.rings)}`);
check('half overlap ring count', r.rings.length === 1, `got ${r.rings.length}`);

// 2. Clip swallows subject
r = Clip.difference(sq(2, 2, 4, 4), sq(0, 0, 10, 10));
check('swallowed -> nothing left', r.rings.length === 0 && !r.hole);

// 3. Clip strictly inside -> donut
r = Clip.difference(sq(0, 0, 10, 10), sq(3, 3, 4, 4));
check('donut reported', !!r.hole && r.rings.length === 1, JSON.stringify({ rings: r.rings.length, hole: !!r.hole }));
check('donut area', r.hole && Math.abs(Clip.area(r.rings[0]) - Clip.area(r.hole) - 84) < 0.01);

// 4. Disjoint
r = Clip.difference(sq(0, 0, 10, 10), sq(50, 50, 5, 5));
check('disjoint unchanged', r.rings.length === 1 && Math.abs(Clip.area(r.rings[0]) - 100) < 0.01);

// 5. Corner bite
r = Clip.difference(sq(0, 0, 10, 10), sq(8, 8, 10, 10));
check('corner bite area', Math.abs(totalArea(r.rings) - 96) < 0.01, `got ${totalArea(r.rings)}`);

// 6. Bar across the middle splits it in two
r = Clip.difference(sq(0, 0, 10, 10), sq(-5, 4, 20, 2));
check('split into two pieces', r.rings.length === 2, `got ${r.rings.length}`);
check('split area', Math.abs(totalArea(r.rings) - 80) < 0.01, `got ${totalArea(r.rings)}`);

// 7. Fuzz against the Monte Carlo oracle, with wobbly loop-like polygons.
function blob(cx, cy, radius, seed, lobes = 3) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const pts = [];
  const phase = rnd() * 6.28;
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    const rr = radius * (1 + Math.sin(t * lobes + phase) * 0.22 + rnd() * 0.04);
    pts.push({ x: cx + Math.cos(t) * rr, y: cy + Math.sin(t) * rr });
  }
  return pts;
}

let worst = 0;
for (let i = 0; i < 24; i++) {
  const A = blob(0, 0, 100, 1000 + i * 7, 3);
  const B = blob(30 + (i % 5) * 18 - 36, 20 - (i % 3) * 22, 70, 5000 + i * 13, 4);
  const out = Clip.difference(A, B);
  const got = out.hole ? Clip.area(out.rings[0]) - Clip.area(out.hole) : totalArea(out.rings);
  const want = mcDifferenceArea(A, B);
  const err = Math.abs(got - want) / Math.max(1, want);
  worst = Math.max(worst, err);
  if (err > 0.008) { fails++; console.log(`FAIL fuzz#${i} got=${got.toFixed(1)} mc=${want.toFixed(1)} err=${(err * 100).toFixed(1)}%`); }

  // No INTERIOR point of the result may lie inside the clip. Vertices sit on
  // the boundary where the two rings cross, so sample the interior instead.
  out.rings.forEach((ring, k) => {
    const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let s2 = 777 + i, tested = 0, leaked = 0;
    const rnd2 = () => { s2 = (s2 * 1103515245 + 12345) & 0x7fffffff; return s2 / 0x7fffffff; };
    for (let t = 0; t < 4000 && tested < 400; t++) {
      const p = { x: x0 + rnd2() * (x1 - x0), y: y0 + rnd2() * (y1 - y0) };
      if (!Clip.pointInRing(p, ring)) continue;
      tested++;
      if (Clip.pointInRing(p, B)) leaked++;
    }
    if (tested > 20 && leaked / tested > 0.02) {
      fails++; console.log(`FAIL fuzz#${i} ring${k}: ${leaked}/${tested} interior samples inside the clip`);
    }
  });
}
console.log(`fuzz worst area error: ${(worst * 100).toFixed(2)}%`);
console.log(fails === 0 ? 'ALL CLIP TESTS PASS' : `${fails} FAILURES`);
process.exit(fails ? 1 : 0);
