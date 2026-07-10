// Screens are being upgraded to double-screen posts: every post needs two
// *identical* screens. Old stock can already pair up among itself (two
// existing identical screens = one post already covered), but the plan is
// to bring in a full matching set of brand-new screens for every old one —
// new screens are never mixed with old ones to complete a pair.
//
// So for a given (brand, model) with `count` existing units:
//   - if count is even, the old units already form count/2 complete pairs,
//     but each of those pairs still gets a matching new pair -> count new.
//   - if count is odd, one old unit is left over with no partner; rounding
//     up to the next even number before doubling accounts for the extra
//     unit it needs -> count + 1 new.
//
// Examples: 3 identical screens -> 4 new needed (7 total for that model).
//           4 identical screens -> 4 new needed (8 total for that model).
export function newScreensNeededForCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }

  return count % 2 === 0 ? count : count + 1;
}

export function totalNewScreensNeeded(screens: { count: number }[]): number {
  return screens.reduce((total, screen) => total + newScreensNeededForCount(screen.count), 0);
}

// The one old unit that has no old partner to pair with when `count` is
// odd (see the walkthrough above) — e.g. 7 identical screens leaves 1
// leftover. Always 0 or 1, since pairing only ever leaves a remainder of
// one unit behind.
export function leftoverScreensForCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }

  return count % 2;
}