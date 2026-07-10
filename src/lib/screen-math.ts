// Screens are being upgraded to double-screen posts: every post needs two
// *identical* screens. Old stock can already pair up among itself (two
// existing identical screens = one post already covered), but the plan is
// to bring in a full matching set of brand-new screens for every old one —
// new screens are never mixed with old ones to complete a pair.
//
// Only IIYAMA screens are eligible to be redeployed/paired this way. Any
// other brand is never treated as reusable stock: it can't pair with
// another old unit of its own kind either, so every single old unit of a
// non-IIYAMA brand independently needs a brand-new pair (2 new screens
// each), and the old unit itself becomes surplus rather than a candidate
// for reuse.
//
// So for a given (brand, model) with `count` existing units:
//   IIYAMA:
//   - if count is even, the old units already form count/2 complete pairs,
//     but each of those pairs still gets a matching new pair -> count new.
//   - if count is odd, one old unit is left over with no partner; rounding
//     up to the next even number before doubling accounts for the extra
//     unit it needs -> count + 1 new.
//   Non-IIYAMA (never paired, never redeployed):
//   - every old unit needs its own new pair -> count * 2 new.
//
// Examples (IIYAMA): 3 identical screens -> 4 new needed (7 total for that model).
//                     4 identical screens -> 4 new needed (8 total for that model).
// Examples (other brand): 3 identical screens -> 6 new needed.
function isRedeployableBrand(brand: string): boolean {
  return brand.trim().toUpperCase() === "IIYAMA";
}

export function newScreensNeededForCount(count: number, brand?: string): number {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }

  if (brand !== undefined && !isRedeployableBrand(brand)) {
    return count * 2;
  }

  return count % 2 === 0 ? count : count + 1;
}

export function totalNewScreensNeeded(screens: { count: number; brand?: string }[]): number {
  return screens.reduce((total, screen) => total + newScreensNeededForCount(screen.count, screen.brand), 0);
}

// The old unit(s) that have no old partner to pair with, and therefore end
// up as surplus stock rather than being redeployed:
//   - IIYAMA: when `count` is odd, exactly one old unit is left over (see
//     the walkthrough above) — e.g. 7 identical screens leaves 1 leftover.
//     Always 0 or 1, since pairing only ever leaves a remainder of one
//     unit behind.
//   - Non-IIYAMA: since these are never redeployed/paired at all, every
//     single old unit is surplus -> the full `count`.
export function leftoverScreensForCount(count: number, brand?: string): number {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }

  if (brand !== undefined && !isRedeployableBrand(brand)) {
    return count;
  }

  return count % 2;
}