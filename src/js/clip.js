/* ==========================================================================
   MILES · polygon clipping
   Territory is exclusive: when a new loop encloses ground someone already
   holds, the newer claim takes it. That means subtracting one polygon from
   another, which is what this file does.

   Greiner–Hormann, specialised to difference. Everything here works in flat
   metres (project before you call it), on rings given as [{x, y}, ...] with
   no repeated closing point.
   ========================================================================== */

(function (M) {
  'use strict';

  const EPS = 1e-9;

  /** Signed area; positive means counter-clockwise in screen-y-down space. */
  function signedArea(ring) {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return sum / 2;
  }

  function area(ring) { return Math.abs(signedArea(ring)); }

  function orient(ring, counterClockwise) {
    const positive = signedArea(ring) > 0;
    return positive === !!counterClockwise ? ring.slice() : ring.slice().reverse();
  }

  /** Crossing-number test. Points exactly on the edge are reported inside. */
  function pointInRing(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a.y > p.y) !== (b.y > p.y)) {
        const t = (p.y - a.y) / (b.y - a.y);
        if (p.x < a.x + t * (b.x - a.x)) inside = !inside;
      }
    }
    return inside;
  }

  /** Proper crossing of two segments; endpoints and collinearity excluded. */
  function crossing(a1, a2, b1, b2) {
    const dax = a2.x - a1.x;
    const day = a2.y - a1.y;
    const dbx = b2.x - b1.x;
    const dby = b2.y - b1.y;
    const denom = dax * dby - day * dbx;
    if (Math.abs(denom) < EPS) return null;                 // parallel
    const alpha = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom;
    const beta = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denom;
    if (alpha <= EPS || alpha >= 1 - EPS || beta <= EPS || beta >= 1 - EPS) return null;
    return { x: a1.x + alpha * dax, y: a1.y + alpha * day, alpha, beta };
  }

  /* --- Linked ring -------------------------------------------------------- */

  function build(ring) {
    const nodes = ring.map((p) => ({ x: p.x, y: p.y, intersection: false, alpha: 0, neighbour: null, entry: false, visited: false }));
    nodes.forEach((n, i) => {
      n.next = nodes[(i + 1) % nodes.length];
      n.prev = nodes[(i - 1 + nodes.length) % nodes.length];
    });
    return nodes[0];
  }

  function walk(start) {
    const out = [];
    let n = start;
    do { out.push(n); n = n.next; } while (n !== start);
    return out;
  }

  /** Inserts an intersection between `from` and the next original vertex. */
  function insertAfter(from, node) {
    let at = from;
    while (at.next.intersection && at.next.alpha < node.alpha) at = at.next;
    node.next = at.next;
    node.prev = at;
    at.next.prev = node;
    at.next = node;
  }

  /**
   * Subtracts `clip` from `subject`.
   * @returns {{rings: Array<Array<{x,y}>>, hole: ?Array<{x,y}>}}
   *   `rings` is the remaining land. `hole` is set when the clip sits wholly
   *   inside the subject, which leaves a ring with a void rather than pieces.
   */
  function difference(subjectRing, clipRing) {
    if (subjectRing.length < 3 || clipRing.length < 3) return { rings: [subjectRing], hole: null };

    // Both counter-clockwise so entry/exit reasoning holds.
    const subject = orient(subjectRing, true);
    const clip = orient(clipRing, true);

    const S = build(subject);
    const C = build(clip);
    const sNodes = walk(S);
    const cNodes = walk(C);

    // Snapshot the original edges before inserting anything: insertion rewrites
    // `next`, so testing against a live `s.next` would shorten edges as we go
    // and silently lose crossings.
    const edgesOf = (nodes) => nodes.map((n, i) => ({
      node: n,
      a: { x: n.x, y: n.y },
      b: { x: nodes[(i + 1) % nodes.length].x, y: nodes[(i + 1) % nodes.length].y },
    }));
    const sEdges = edgesOf(sNodes);
    const cEdges = edgesOf(cNodes);

    let found = 0;
    sEdges.forEach((s) => {
      cEdges.forEach((c) => {
        const hit = crossing(s.a, s.b, c.a, c.b);
        if (!hit) return;
        const sNode = { x: hit.x, y: hit.y, intersection: true, alpha: hit.alpha, visited: false, entry: false };
        const cNode = { x: hit.x, y: hit.y, intersection: true, alpha: hit.beta, visited: false, entry: false };
        sNode.neighbour = cNode;
        cNode.neighbour = sNode;
        insertAfter(s.node, sNode);
        insertAfter(c.node, cNode);
        found++;
      });
    });

    if (!found) {
      if (pointInRing(subject[0], clip)) return { rings: [], hole: null };          // swallowed
      if (pointInRing(clip[0], subject)) return { rings: [subject], hole: clip };   // donut
      return { rings: [subject], hole: null };                                      // apart
    }

    // Walk each ring, flipping a flag at every crossing, to label whether an
    // intersection is where the subject enters the clip or leaves it.
    let inside = pointInRing(S, clip);
    walk(S).forEach((n) => {
      if (!n.intersection) return;
      n.entry = !inside;          // true where the subject is entering the clip
      inside = !inside;
    });

    inside = pointInRing(C, subject);
    walk(C).forEach((n) => {
      if (!n.intersection) return;
      n.entry = !inside;
      inside = !inside;
    });

    // Keep the parts of the subject that lie outside the clip: start where the
    // subject leaves the clip, run forward along it to where it re-enters, then
    // follow the clip backwards to close the cut.
    const rings = [];
    const mark = (node) => {
      node.visited = true;
      if (node.neighbour) node.neighbour.visited = true;   // both sides, always
    };

    walk(S).forEach((startNode) => {
      if (!startNode.intersection || startNode.visited || startNode.entry) return;

      const ring = [];
      let current = startNode;
      let onSubject = true;
      let guard = 0;
      const LIMIT = (sNodes.length + cNodes.length + found * 2) * 4 + 64;
      let closed = false;

      while (guard++ < LIMIT) {
        mark(current);
        ring.push({ x: current.x, y: current.y });

        // Run along the current ring to the next crossing, collecting vertices.
        do {
          current = onSubject ? current.next : current.prev;
          if (!current.intersection) ring.push({ x: current.x, y: current.y });
        } while (!current.intersection && guard++ < LIMIT);

        if (!current.intersection) break;                  // ran out; malformed
        mark(current);
        ring.push({ x: current.x, y: current.y });

        current = current.neighbour;
        onSubject = !onSubject;
        if (current === startNode || current.neighbour === startNode) { closed = true; break; }
      }

      const clean = dedupe(ring);
      if (closed && clean.length >= 3 && area(clean) > 1e-6) rings.push(clean);
    });

    return { rings, hole: null };
  }

  function dedupe(ring) {
    const out = [];
    ring.forEach((p) => {
      const last = out[out.length - 1];
      if (!last || Math.abs(last.x - p.x) > 1e-7 || Math.abs(last.y - p.y) > 1e-7) out.push(p);
    });
    while (out.length > 1) {
      const first = out[0];
      const last = out[out.length - 1];
      if (Math.abs(first.x - last.x) < 1e-7 && Math.abs(first.y - last.y) < 1e-7) out.pop();
      else break;
    }
    return out;
  }

  const Clip = { signedArea, area, orient, pointInRing, difference, dedupe, EPS };

  if (typeof module !== 'undefined' && module.exports) module.exports = Clip;
  if (M) M.Clip = Clip;
})(typeof window !== 'undefined' ? (window.MILES = window.MILES || {}) : null);
