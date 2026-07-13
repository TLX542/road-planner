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
// that pooling to stock as well as installed units.
export function combinedLeftoverForModel(installedCount: number, stockCount: number, brand?: string): number {
  const safeInstalledCount = Number.isFinite(installedCount) && installedCount > 0 ? installedCount : 0;
  const safeStockCount = Number.isFinite(stockCount) && stockCount > 0 ? stockCount : 0;

  if (brand !== undefined && !isRedeployableBrand(brand)) {
    return safeInstalledCount + safeStockCount;
  }

  return (safeInstalledCount + safeStockCount) % 2;
}

// ---------------------------------------------------------------------
// Known unused stock
// ---------------------------------------------------------------------
//
// A handful of specific units recorded in the spreadsheet aren't actually
// installed on a wall anywhere — they're spares sitting in an agency's
// stock room. They still need to be picked up during a visit (so they
// belong in the "surplus to retrieve" tally), but since there's no active
// screen for them to replace, they should never count toward "new screens
// to prepare".
//
// Add entries here as more of these turn up. Omit `agencyName` for a model
// that's spare stock everywhere it appears (matched at every agency);
// provide a city/name fragment to scope it to one specific agency. `count`
// defaults to 1 (one spare unit) and only needs to be set for more.
type UnusedStockEntry = {
  agencyName?: string;
  brand: string;
  model: string;
  count?: number;
};

const KNOWN_UNUSED_STOCK: UnusedStockEntry[] = [
  { agencyName: "RENNES", brand: "IIYAMA", model: "E2482HD-B1" },
  { agencyName: "LYON", brand: "IIYAMA", model: "XUB2493HS-B5" },
  { brand: "Philips", model: "223V5LSB2/10" },
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

function unusedStockCountFor(agencyName: string, brand: string, model: string): number {
  const normalizedAgency = normalizeForMatch(agencyName);
  const normalizedBrand = normalizeForMatch(brand);
  const normalizedModel = normalizeForMatch(model);

  return KNOWN_UNUSED_STOCK.reduce((total, entry) => {
    if (normalizeForMatch(entry.brand) !== normalizedBrand || normalizeForMatch(entry.model) !== normalizedModel) {
      return total;
    }
    if (entry.agencyName !== undefined && !normalizedAgency.includes(normalizeForMatch(entry.agencyName))) {
      return total;
    }
    return total + (entry.count ?? 1);
  }, 0);
}

// Splits a recorded (brand, model, count) at a given agency into the units
// that are actually installed — and therefore need a matching new screen —
// versus units known to just be spare stock at that agency. `stockCount`
// still needs retrieving, it just never feeds newScreensNeededForCount.
export function splitInstalledAndStockCount(
  agencyName: string,
  screen: { brand: string; model: string; count: number },
): { installedCount: number; stockCount: number } {
  const knownStock = unusedStockCountFor(agencyName, screen.brand, screen.model);
  const stockCount = Math.min(knownStock, screen.count);
  return { installedCount: screen.count - stockCount, stockCount };
}

// Convenience for callers (like the per-agency tally) that just want a
// screens array with stock units already excluded from `count`, so it can
// be dropped straight into newScreensNeededForCount / totalNewScreensNeeded
// without them needing to know about the stock split at all.
export function withoutKnownStock<T extends { brand: string; model: string; count: number }>(
  agencyName: string,
  screens: T[],
): T[] {
  return screens.map((screen) => ({
    ...screen,
    count: splitInstalledAndStockCount(agencyName, screen).installedCount,
  }));
}