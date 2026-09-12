/* ==========================================================================
   MILES · land
   Territory is exclusive. When two loops enclose the same ground, the one
   claimed later owns it, and the earlier claim gives up that part — so no two
   plots on the map ever overlap.

   A claim is therefore stored twice over: `polygon` is the loop you actually
   ran and never changes, while `pieces` is what you still hold of it after
   everyone else's later claims have been cut out. A piece is a ring plus any
   voids inside it, which is what a later loop landing in the middle leaves
   behind.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Geo, Clip } = M;

  /** Subtracts one clip ring from a list of pieces, in projected metres. */
  function cut(pieces, clip) {
    const out = [];

    pieces.forEach((piece) => {
      const result = Clip.difference(piece.ring, clip);

      // The clip landed wholly inside this piece: it becomes a void.
      if (result.hole) {
        out.push({ ring: piece.ring, holes: piece.holes.concat([result.hole]) });
        return;
      }

      result.rings.forEach((ring) => {
        // Carry the existing voids over to whichever fragment now contains
        // them. A void the cut has opened up to the outside is no longer a
        // void, so it has to be taken out of the ring itself instead.
        let shards = [{ ring, holes: [] }];
        piece.holes.forEach((hole) => {
          const next = [];
          shards.forEach((shard) => {
            if (hole.every((p) => Clip.pointInRing(p, shard.ring))) {
              next.push({ ring: shard.ring, holes: shard.holes.concat([hole]) });
              return;
            }
            const re = Clip.difference(shard.ring, hole);
            if (re.hole) next.push({ ring: shard.ring, holes: shard.holes.concat([re.hole]) });
            else re.rings.forEach((r) => next.push({ ring: r, holes: shard.holes }));
          });
          shards = next;
        });
        out.push.apply(out, shards);
      });
    });

    return out;
  }

  function pieceArea(piece) {
    return piece.holes.reduce((a, h) => a - Clip.area(h), Clip.area(piece.ring));
  }

  const Land = {
    /**
     * Resolves a set of claims so none of them overlap.
     * Each claim needs `polygon` (a lat/lng ring) and `claimedAt`. Every claim
     * comes back with `pieces` (lat/lng rings with voids) and a corrected
     * `area` in square metres. Order of the returned array is preserved.
     */
    resolve(claims, origin) {
      if (!claims || !claims.length) return [];
      const anchor = origin || claims[0].polygon[0];

      // Oldest first, so "everything claimed after me" is simply what follows.
      const order = claims
        .map((claim, index) => ({ claim, index }))
        .sort((a, b) => (a.claim.claimedAt || 0) - (b.claim.claimedAt || 0));

      const rings = order.map((entry) =>
        (entry.claim.polygon || []).map((p) => Geo.project(p, anchor)));

      order.forEach((entry, i) => {
        let pieces = rings[i].length >= 3 ? [{ ring: rings[i], holes: [] }] : [];
        for (let j = i + 1; j < order.length && pieces.length; j++) {
          if (rings[j].length >= 3) pieces = cut(pieces, rings[j]);
        }

        const kept = pieces.filter((piece) => pieceArea(piece) > 50);   // ignore slivers
        entry.claim.pieces = kept.map((piece) => ({
          ring: piece.ring.map((p) => Geo.unproject(p, anchor)),
          holes: piece.holes.map((h) => h.map((p) => Geo.unproject(p, anchor))),
        }));
        entry.claim.area = kept.reduce((sum, piece) => sum + pieceArea(piece), 0);
      });

      return claims;
    },

    /** Area actually held, after later claims have taken their share. */
    held(claims) {
      return (claims || []).reduce((sum, c) => sum + (c.area || 0), 0);
    },
  };

  M.Land = Land;
})(window.MILES);
