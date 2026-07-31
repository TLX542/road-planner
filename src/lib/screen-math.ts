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

// Known unused stock (see KNOWN_UNUSED_STOCK below) is never installed
// anywhere, so it never needs a brand-new matching pair of its own — that
// part of leftoverScreensForCount's exclusion from newScreensNeededForCount
// stays untouched. But a spare IIYAMA screen sitting in one agency's stock
// room is still an identical unit that CAN physically travel to pair with a
// stranded installed leftover at another agency (two identical old screens
// are a redeployable pair regardless of which site they each started out
// at). Once paired that way, neither unit is genuinely "surplus with
// nowhere to go" any more, so both drop out of the surplus tally — even
// though, practically, both still need to be physically retrieved during a
// visit.
//
// Non-IIYAMA stock never pairs with anything (same reasoning as
// leftoverScreensForCount) and always stays fully surplus.
//
// `installedCount` / `stockCount` should already be pooled across every
// agency in scope for the model, so this mirrors the existing cross-agency
// pooling that newScreensNeededForCount benefits from — it just extends
// that pooling to stock as well as installed units. Known HS/broken units
// (see KNOWN_HS_SCREENS below) must NOT be folded into either argument —
// they never pair with anything and are tallied separately by the caller.
export function combinedLeftoverForModel(installedCount: number, stockCount: number, brand?: string): number {
  const safeInstalledCount = Number.isFinite(installedCount) && installedCount > 0 ? installedCount : 0;
  const safeStockCount = Number.isFinite(stockCount) && stockCount > 0 ? stockCount : 0;

  if (brand !== undefined && !isRedeployableBrand(brand)) {
    return safeInstalledCount + safeStockCount;
  }

  return (safeInstalledCount + safeStockCount) % 2;
}

// ---------------------------------------------------------------------
// Known unused stock & known HS (out-of-service / broken) screens
// ---------------------------------------------------------------------
//
// Two separate lists of specific units recorded in the spreadsheet that
// aren't ordinary installed screens:
//
//   - KNOWN_UNUSED_STOCK: spares sitting in an agency's stock room, still
//     fully working. They still need to be picked up during a visit, and
//     since they're identical working units they can pair up with a
//     stranded installed leftover elsewhere (see combinedLeftoverForModel)
//     — once paired that way they drop out of the surplus tally too, even
//     though they still need retrieving.
//   - KNOWN_HS_SCREENS: broken/out-of-service units. They also still need
//     picking up, but unlike stock they never pair with anything (a broken
//     screen can't complete a redeployable pair) and never reduce another
//     model's totals — they're simply always counted, in full, toward the
//     "screens to bring home" tally.
//
//     By default an HS unit is *not* factored into newScreensNeededForCount
//     at all — same as stock, there's no active installed screen to
//     replace. But some HS units are known to be actively broken displays
//     that DO need swapping out, not just retiring: for those, set
//     `needsReplacement: true` on the entry. A flagged HS unit still never
//     counts toward installedCount, stockCount, pairing, or the surplus
//     tally — it's simply never "installed" for any of that math — but it
//     does add its own brand-new matching pair (2 new screens, same as any
//     non-redeployable unit) on top of whatever the rest of the tally
//     needs. Leave `needsReplacement` unset/false for an HS unit that's
//     simply being retired with no replacement planned.
//
// Add entries to either list as more of these turn up. Omit `agencyName`
// for a model that matches everywhere it appears; provide a city/name
// fragment to scope it to one specific agency. `count` defaults to 1 (one
// spare/broken unit) and only needs to be set for more.
type ScreenFlagEntry = {
  agencyName?: string;
  brand: string;
  model: string;
  count?: number;
  // Only meaningful on KNOWN_HS_SCREENS entries — see comment above.
  // Ignored on KNOWN_UNUSED_STOCK entries.
  needsReplacement?: boolean;
};

const KNOWN_UNUSED_STOCK: ScreenFlagEntry[] = [
  { agencyName: "RENNES", brand: "IIYAMA", model: "E2482HD-B1" },
  { brand: "Philips", model: "223V5LSB2/10" },
];

// Broken/out-of-service units — see the comment above for how these differ
// from KNOWN_UNUSED_STOCK, and for what `needsReplacement` toggles.
const KNOWN_HS_SCREENS: ScreenFlagEntry[] = [
  { agencyName: "LYON", brand: "IIYAMA", model: "XUB2493HS-B5" },
  { agencyName: "SCHIRMECK", brand: "IIYAMA", model: "XUB2493HS-B5", needsReplacement: true}
];

// Case/accent-insensitive so "Épinal", "epinal", "RENNES", "Groupe Rennes",
// etc. all match consistently regardless of exactly how the spreadsheet
// spells a given agency or brand name.
function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

// Shared matcher for both KNOWN_UNUSED_STOCK and KNOWN_HS_SCREENS — same
// (agency, brand, model) matching rules, just applied against whichever
// list the caller passes in. An optional extra predicate narrows further
// (e.g. only entries with `needsReplacement: true`) without duplicating
// the agency/brand/model matching logic.
function flaggedCountFor(
  entries: ScreenFlagEntry[],
  agencyName: string,
  brand: string,
  model: string,
  extraFilter?: (entry: ScreenFlagEntry) => boolean,
): number {
  const normalizedAgency = normalizeForMatch(agencyName);
  const normalizedBrand = normalizeForMatch(brand);
  const normalizedModel = normalizeForMatch(model);

  return entries.reduce((total, entry) => {
    if (normalizeForMatch(entry.brand) !== normalizedBrand || normalizeForMatch(entry.model) !== normalizedModel) {
      return total;
    }
    if (entry.agencyName !== undefined && !normalizedAgency.includes(normalizeForMatch(entry.agencyName))) {
      return total;
    }
    if (extraFilter !== undefined && !extraFilter(entry)) {
      return total;
    }
    return total + (entry.count ?? 1);
  }, 0);
}

// Splits a recorded (brand, model, count) at a given agency into the units
// that are actually installed (and therefore need a matching new screen),
// known spare stock, and known HS/broken units. `stockCount` and `hsCount`
// both still need retrieving, but neither ever feeds
// newScreensNeededForCount, and hsCount never feeds combinedLeftoverForModel
// either (see the section comment above).
//
// `hsNeedingReplacementCount` is the subset of `hsCount` whose
// KNOWN_HS_SCREENS entry (or entries) set `needsReplacement: true` — it's
// always <= hsCount. It still isn't part of installedCount/hsCount's own
// math (pairing, surplus, etc.), but the caller should feed it through
// newScreensNeededForHs to add its share to the new-screens total. See
// the KNOWN_HS_SCREENS section comment above for the full rationale.
export function splitInstalledAndStockCount(
  agencyName: string,
  screen: { brand: string; model: string; count: number },
): { installedCount: number; stockCount: number; hsCount: number; hsNeedingReplacementCount: number } {
  const knownStock = flaggedCountFor(KNOWN_UNUSED_STOCK, agencyName, screen.brand, screen.model);
  const stockCount = Math.min(knownStock, screen.count);

  const knownHs = flaggedCountFor(KNOWN_HS_SCREENS, agencyName, screen.brand, screen.model);
  const hsCount = Math.min(knownHs, screen.count - stockCount);

  const knownHsNeedingReplacement = flaggedCountFor(
    KNOWN_HS_SCREENS,
    agencyName,
    screen.brand,
    screen.model,
    (entry) => entry.needsReplacement === true,
  );
  const hsNeedingReplacementCount = Math.min(knownHsNeedingReplacement, hsCount);

  return { installedCount: screen.count - stockCount - hsCount, stockCount, hsCount, hsNeedingReplacementCount };
}

// New screens needed on top of the regular tally to cover HS/broken units
// flagged with `needsReplacement: true`. An HS unit never pairs with
// anything (see the KNOWN_HS_SCREENS comment above), so — same as any
// non-redeployable old unit — each one needs its own brand-new matching
// pair: 2 new screens per unit.
export function newScreensNeededForHs(hsNeedingReplacementCount: number): number {
  if (!Number.isFinite(hsNeedingReplacementCount) || hsNeedingReplacementCount <= 0) {
    return 0;
  }
  return hsNeedingReplacementCount * 2;
}

// Convenience for callers that want the total extra new-screens count
// (across a whole screens array, at one agency) contributed by flagged HS
// units, without needing to call splitInstalledAndStockCount themselves
// per screen. Mirrors how withoutKnownStock wraps the installed side of
// the same split.
export function totalNewScreensNeededForHs(
  agencyName: string,
  screens: { brand: string; model: string; count: number }[],
): number {
  return screens.reduce(
    (total, screen) =>
      total + newScreensNeededForHs(splitInstalledAndStockCount(agencyName, screen).hsNeedingReplacementCount),
    0,
  );
}

// Convenience for callers (like the per-agency tally) that just want a
// screens array with stock and HS units already excluded from `count`, so
// it can be dropped straight into newScreensNeededForCount /
// totalNewScreensNeeded without them needing to know about the split at
// all.
export function withoutKnownStock<T extends { brand: string; model: string; count: number }>(
  agencyName: string,
  screens: T[],
): T[] {
  return screens.map((screen) => ({
    ...screen,
    count: splitInstalledAndStockCount(agencyName, screen).installedCount,
  }));
}

// ---------------------------------------------------------------------
// HQ stock (screens sitting at HQ, ready to bring on the trip)
// ---------------------------------------------------------------------
//
// Separate from KNOWN_UNUSED_STOCK above (which is tied to one specific
// agency) — HQ stock (see lib/agencies-data.ts) is a small pool of
// recovered screens sitting at HQ with no fixed home, available to bring
// along to *any* agency on the trip. There's at most one unit of any
// given (brand, model) in HQ stock at a time.
//
// A trip-wide pooled installed count (see screenTally in page.tsx) that's
// ODD means one old unit has no old partner anywhere on this trip, and —
// per the newScreensNeededForCount rule above — normally needs a full
// brand-new matching pair (2 new screens) all to itself. If HQ stock has
// a spare of that same model, it can be carried out and paired directly
// with that stranded old unit instead: two identical OLD screens once
// again form a complete post, exactly like any other old pair, so
// nothing new needs to be bought for it at all.
//
// This only helps when there's actually a stranded leftover to pair with
// (odd trip-wide count) and only for redeployable brands (IIYAMA) — same
// restriction as ordinary old-old pairing, since a non-IIYAMA unit never
// pairs with anything regardless of what else is available.

/**
 * Whether a spare screen of this model currently sitting in HQ stock
 * could actually be used to complete a pair with a stranded installed
 * leftover on this trip (see the section comment above).
 */
export function hqStockCanPairWithTripLeftover(installedCount: number, brand: string): boolean {
  if (!Number.isFinite(installedCount) || installedCount <= 0) {
    return false;
  }
  if (!isRedeployableBrand(brand)) {
    return false;
  }
  return installedCount % 2 === 1;
}

/**
 * New-screens savings from bringing a matching HQ stock spare along: it
 * turns what would have been a brand-new replacement pair (2 screens) for
 * the trip's stranded leftover into an all-old pair using hardware
 * already on hand. 0 when there's no leftover for it to usefully pair
 * with (see hqStockCanPairWithTripLeftover).
 */
export function hqStockNewScreensSavings(installedCount: number, brand: string): number {
  return hqStockCanPairWithTripLeftover(installedCount, brand) ? 2 : 0;
}

/**
 * Out of everything currently sitting in HQ stock, the subset that's
 * actually worth bringing on this trip — i.e. that matches a (brand,
 * model) with a stranded leftover somewhere in `screenTally` (the
 * trip-wide pooled tally, see page.tsx). A stock screen whose model isn't
 * needed, or whose model's trip-wide count is already even, wouldn't find
 * anything to pair with, so it's left out.
 */
export function usefulHqStockScreens<T extends { brand: string; model: string }>(
  screenTally: { brand: string; model: string; count: number }[],
  hqStockScreens: T[],
): T[] {
  return hqStockScreens.filter((stockScreen) => {
    const match = screenTally.find(
      (item) =>
        normalizeForMatch(item.brand) === normalizeForMatch(stockScreen.brand) &&
        normalizeForMatch(item.model) === normalizeForMatch(stockScreen.model),
    );
    return match !== undefined && hqStockCanPairWithTripLeftover(match.count, match.brand);
  });
}

/**
 * Total new-screens savings (see hqStockNewScreensSavings) across every
 * model currently in HQ stock, against the trip-wide pooled tally.
 * Convenience wrapper so callers don't need to loop + look up matches
 * themselves — mirrors totalNewScreensNeededForHs above.
 */
export function totalNewScreensSavingsFromHqStock(
  screenTally: { brand: string; model: string; count: number }[],
  hqStockScreens: { brand: string; model: string }[],
): number {
  return usefulHqStockScreens(screenTally, hqStockScreens).length * 2;
}

/**
 * Same idea as combinedLeftoverForModel above, but also letting a
 * matching HQ stock spare soak up the trip's stranded installed leftover
 * for this model, on top of any agency-level known stock. Once the HQ
 * spare is on its way to pair with that leftover, the leftover isn't
 * "surplus with nowhere to go" any more — it's staying right where it is,
 * joined by the incoming spare to form a working old-old pair — so it
 * drops out of the "à récupérer" list, same as a leftover that pairs with
 * agency-level stock already does.
 *
 * Only ever adds at most one unit on top of `stockCount`: HQ stock never
 * holds more than one of a given model, and hqStockCanPairWithTripLeftover
 * (checked against `installedCount` alone, same as everywhere else HQ
 * stock is considered) confirms there's actually a stranded leftover for
 * it to pair with before the bonus is applied at all.
 */
export function combinedLeftoverForModelWithHqStock(
  installedCount: number,
  stockCount: number,
  brand: string,
  model: string,
  hqStockScreens: { brand: string; model: string }[],
): number {
  const matchesHqStock = hqStockScreens.some(
    (screen) => normalizeForMatch(screen.brand) === normalizeForMatch(brand) && normalizeForMatch(screen.model) === normalizeForMatch(model),
  );
  const hqStockBonus = matchesHqStock && hqStockCanPairWithTripLeftover(installedCount, brand) ? 1 : 0;

  return combinedLeftoverForModel(installedCount, stockCount + hqStockBonus, brand);
}