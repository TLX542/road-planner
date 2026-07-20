"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AddressAutocomplete } from "@/components/address-autocomplete";
import { TripMap, type AgencyClickMode, type AgencyMarker } from "@/components/trip-map";
import {
  newScreensNeededForCount,
  combinedLeftoverForModel,
  totalNewScreensNeeded,
  splitInstalledAndStockCount,
  withoutKnownStock,
  newScreensNeededForHs,
  totalNewScreensNeededForHs,
} from "@/lib/screen-math";

type TripLeg = {
  from: string;
  to: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: Coordinate[];
};

type Coordinate = { lat: number; lon: number };

type GeocodedStop = {
  displayName: string;
  coordinate: Coordinate;
};

type TripResponse = {
  stops: GeocodedStop[];
  legs: TripLeg[];
  totals: {
    distanceMeters: number;
    durationSeconds: number;
  };
  routeGeometry: Coordinate[];
};

type TripState = {
  stops: string[];
  // Parallel array to `stops` — holds the agency id for any stop that was
  // inserted by clicking an agency marker (in "waypoint" mode), or null for
  // a plain typed/autocompleted address. Kept in lockstep with every
  // operation that touches `stops` (add/remove/move/edit) so the screen
  // tally below always reflects exactly the agencies currently in the
  // itinerary — no more, no less.
  stopAgencyIds: (string | null)[];
  result: TripResponse | null;
  // true only while an explicit, user-triggered calculation is in flight
  loading: boolean;
  // true while a silent, background auto-recalculation is in flight
  updating: boolean;
  error: string;
};

type Theme = "light" | "dark";

function createTrip(stops: string[] = ["", ""]): TripState {
  return {
    stops,
    stopAgencyIds: stops.map(() => null),
    result: null,
    loading: false,
    updating: false,
    error: "",
  };
}

function formatDistance(distanceMeters: number): string {
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function formatDuration(durationSeconds: number): string {
  const totalMinutes = Math.round(durationSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${minutes} min`;
}

const THEME_STORAGE_KEY = "trip-planner-theme";

// Each leg (the segment between two consecutive stops) shares one base hue
// but shifts from a darker shade (first leg) to a lighter shade (last leg),
// so the trip reads as one color family while still letting you tell its
// legs apart.
const ROUTE_HUE = 212;

function getLegColor(legIndex: number, legCount: number): string {
  const lightnessStart = 32;
  const lightnessEnd = 62;
  const progress = legCount > 1 ? legIndex / (legCount - 1) : 0;
  const lightness = lightnessStart + progress * (lightnessEnd - lightnessStart);
  return `hsl(${ROUTE_HUE}, 68%, ${lightness}%)`;
}

// The order the single toggle button cycles through on each click.
const AGENCY_CLICK_MODES: AgencyClickMode[] = ["waypoint", "visited", "comment"];

function nextAgencyClickMode(mode: AgencyClickMode): AgencyClickMode {
  const index = AGENCY_CLICK_MODES.indexOf(mode);
  return AGENCY_CLICK_MODES[(index + 1) % AGENCY_CLICK_MODES.length];
}

const AGENCY_CLICK_MODE_LABEL: Record<AgencyClickMode, string> = {
  waypoint: "📍 Ajouter comme étape",
  visited: "✅ Basculer visité",
  comment: "💬 Ajouter un commentaire",
};

export default function Home() {
  const [trip, setTrip] = useState<TripState>(() => createTrip());

  const [theme, setTheme] = useState<Theme>("light");

  // Both floating "islands" become bottom sheets on narrow screens (see the
  // max-width: 760px block in globals.css) — collapsed to a small peek strip
  // by default so the map stays visible, and expandable on tap. These flags
  // are meaningless above that breakpoint since the CSS forces the islands
  // fully open there regardless of class name.
  const [mobilePlannerOpen, setMobilePlannerOpen] = useState(false);
  const [mobileTallyOpen, setMobileTallyOpen] = useState(false);
  // Whether the little "i" popover explaining the two new-screens totals
  // (pooled vs. per-agency) is open.
  const [screenTotalsInfoOpen, setScreenTotalsInfoOpen] = useState(false);
  // The "i" button that anchors the popover, and the popover itself. Both
  // are measured in the layout effect below so the popover can be
  // positioned with fixed (viewport) coordinates instead of being laid out
  // relative to a scrolling ancestor — see that effect for why.
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const infoTooltipRef = useRef<HTMLSpanElement>(null);
  const [infoTooltipStyle, setInfoTooltipStyle] = useState<{ top: number; left: number } | null>(null);

  // The popover used to be `position: absolute` inside `.tallyInfoRow`,
  // anchored to the top-left of that row. Two problems with that:
  //   1. It always opened downward from the row, not centered on the "i"
  //      button, so on a short popover it looked top-heavy.
  //   2. `.tallyInfoRow` lives inside `.topIslandLeft` / `.resultsCard`,
  //      which scroll (`overflow: auto`, see globals.css) on the mobile
  //      bottom-sheet layout. An absolutely positioned descendant is
  //      clipped to that scrolling box's bounds, so if the popover would
  //      render below the currently-scrolled-into-view area, it was simply
  //      cut off — the user had to scroll the *sheet* to reveal it.
  // Fixing both: compute the button's position with getBoundingClientRect,
  // then place the popover with `position: fixed` in viewport coordinates.
  // It's placed just below the button (never on top of it — otherwise it
  // covers the one control that closes it), falling back to just above,
  // and finally to whichever side has more room if it doesn't fully fit
  // either way, clamped so it stays as legible as possible.
  useLayoutEffect(() => {
    if (!screenTotalsInfoOpen) {
      setInfoTooltipStyle(null);
      return;
    }

    const button = infoButtonRef.current;
    if (!button) {
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const tooltipWidth = infoTooltipRef.current?.offsetWidth ?? Math.min(280, window.innerWidth * 0.9);
    const tooltipHeight = infoTooltipRef.current?.offsetHeight ?? 0;

    // Horizontal: same left edge as the button, clamped so it can't run
    // off either side of the viewport.
    let left = buttonRect.left;
    left = Math.min(left, window.innerWidth - tooltipWidth - margin);
    left = Math.max(left, margin);

    // Vertical: prefer just below the button; if it doesn't fully fit
    // there, try just above; if it fits fully in neither, use whichever
    // side has more room and clamp to the viewport.
    const spaceBelow = window.innerHeight - buttonRect.bottom - margin;
    const spaceAbove = buttonRect.top - margin;

    let top: number;
    if (tooltipHeight <= spaceBelow) {
      top = buttonRect.bottom + gap;
    } else if (tooltipHeight <= spaceAbove) {
      top = buttonRect.top - gap - tooltipHeight;
    } else if (spaceBelow >= spaceAbove) {
      top = Math.min(buttonRect.bottom + gap, window.innerHeight - tooltipHeight - margin);
    } else {
      top = Math.max(buttonRect.top - gap - tooltipHeight, margin);
    }

    setInfoTooltipStyle({ top, left });
  }, [screenTotalsInfoOpen]);

  // Closes the popover the instant the user interacts with anything else —
  // clicking or tapping elsewhere (including on the popover's own text,
  // which isn't interactive), typing, scrolling, or resizing the window.
  // The "i" button itself is excluded so its own onClick can toggle the
  // popover without this effect fighting it (both firing on the same
  // click would otherwise cancel each other out: this closes it on
  // pointerdown, then the button's click reopens it).
  useEffect(() => {
    if (!screenTotalsInfoOpen) {
      return;
    }

    const closeUnlessButton = (event: Event) => {
      const button = infoButtonRef.current;
      if (button && event.target instanceof Node && button.contains(event.target)) {
        return;
      }
      setScreenTotalsInfoOpen(false);
    };

    document.addEventListener("pointerdown", closeUnlessButton, true);
    document.addEventListener("keydown", closeUnlessButton, true);
    window.addEventListener("scroll", closeUnlessButton, true);
    window.addEventListener("resize", closeUnlessButton);

    return () => {
      document.removeEventListener("pointerdown", closeUnlessButton, true);
      document.removeEventListener("keydown", closeUnlessButton, true);
      window.removeEventListener("scroll", closeUnlessButton, true);
      window.removeEventListener("resize", closeUnlessButton);
    };
  }, [screenTotalsInfoOpen]);

  const [agencies, setAgencies] = useState<AgencyMarker[]>([]);
  // Controls what clicking an agency marker on the map does: insert it as
  // the earliest waypoint on the trip, toggle its visited flag, or
  // open the comment editor below. Cycled via the single header button.
  const [agencyClickMode, setAgencyClickMode] = useState<AgencyClickMode>("waypoint");

  // Which agency's comment popup is open (null = closed), the text
  // currently being edited, and save state for that popup. Kept separate
  // from `agencies` itself so typing in the textarea doesn't need a round
  // trip through the agencies array on every keystroke.
  const [commentAgencyId, setCommentAgencyId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentSaveError, setCommentSaveError] = useState("");

  // Sync with the theme the inline layout script already applied, without
  // fighting SSR (see layout.tsx for the pre-hydration script).
  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current === "dark" || current === "light") {
      setTheme(current);
    }
  }, []);

  // Agency locations (from suivi_ecrans.xlsx) are static reference data, so
  // they're fetched once on mount rather than tied to the trip/route state.
  useEffect(() => {
    let cancelled = false;

    async function loadAgencies() {
      try {
        const response = await fetch("/api/agencies");
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { agencies?: AgencyMarker[] };
        if (!cancelled && Array.isArray(data.agencies)) {
          setAgencies(data.agencies);
        }
      } catch {
        // Non-critical: the planner still works without agency markers.
      }
    }

    void loadAgencies();

    return () => {
      cancelled = true;
    };
  }, []);

  // Flips an agency's visited flag immediately (optimistic update) and
  // persists it to the shared backend. If the save fails, the flip is
  // rolled back so the UI never shows a state that isn't actually saved —
  // and therefore isn't actually shared with everyone else.
  const toggleAgencyVisited = useCallback(
    (agencyId: string) => {
      const target = agencies.find((agency) => agency.id === agencyId);
      if (!target) {
        return;
      }

      const nextVisited = !target.visited;

      setAgencies((current) =>
        current.map((agency) => (agency.id === agencyId ? { ...agency, visited: nextVisited } : agency)),
      );

      fetch(`/api/agencies/${encodeURIComponent(agencyId)}/visited`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visited: nextVisited }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Échec de l'enregistrement de l'état visité.");
          }
        })
        .catch(() => {
          setAgencies((current) =>
            current.map((agency) => (agency.id === agencyId ? { ...agency, visited: !nextVisited } : agency)),
          );
        });
    },
    [agencies],
  );

  // Opens the comment popup for an agency, seeding the draft with whatever
  // is currently saved for it (empty string if there's nothing yet).
  const openCommentEditor = useCallback(
    (agencyId: string) => {
      const target = agencies.find((agency) => agency.id === agencyId);
      setCommentAgencyId(agencyId);
      setCommentDraft(target?.comment ?? "");
      setCommentSaveError("");
    },
    [agencies],
  );

  const closeCommentEditor = useCallback(() => {
    setCommentAgencyId(null);
    setCommentDraft("");
    setCommentSaveError("");
  }, []);

  // Same optimistic-update-with-rollback shape as toggleAgencyVisited
  // above, persisted to the same shared Redis instance so a comment left by
  // whoever's on the road shows up for everyone else too.
  const saveAgencyComment = useCallback(
    (agencyId: string, comment: string) => {
      const previous = agencies.find((agency) => agency.id === agencyId)?.comment ?? "";
      const trimmed = comment.trim();

      setAgencies((current) =>
        current.map((agency) => (agency.id === agencyId ? { ...agency, comment: trimmed } : agency)),
      );
      setCommentSaving(true);
      setCommentSaveError("");

      fetch(`/api/agencies/${encodeURIComponent(agencyId)}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: trimmed }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Échec de l'enregistrement du commentaire.");
          }
          closeCommentEditor();
        })
        .catch(() => {
          setAgencies((current) =>
            current.map((agency) => (agency.id === agencyId ? { ...agency, comment: previous } : agency)),
          );
          setCommentSaveError("Échec de l'enregistrement du commentaire. Veuillez réessayer.");
        })
        .finally(() => {
          setCommentSaving(false);
        });
    },
    [agencies, closeCommentEditor],
  );

  const toggleTheme = () => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next;
    });
  };

  // Whether the current stops are complete enough to calculate. Deliberately
  // independent of loading/updating state so it doesn't flip back and forth
  // as a calculation starts and finishes (that oscillation was causing the
  // auto-recalculation effect to keep re-triggering itself indefinitely).
  const stopsValid = useMemo(
    () => trip.stops.length >= 2 && trip.stops.every((stop) => stop.trim().length > 0),
    [trip.stops],
  );

  const canCalculate = stopsValid && !trip.loading;

  // "Tout effacer" is only meaningful — and only enabled — if there's
  // something to clear: a step with actual text in it, or more than the
  // default two blank slots, or a previously calculated result/error.
  const canClearStops = useMemo(
    () =>
      trip.stops.some((stop) => stop.trim().length > 0) ||
      trip.stops.length > 2 ||
      trip.result !== null ||
      trip.error !== "",
    [trip.stops, trip.result, trip.error],
  );

  // The calculated route, split into its individual legs so each leg can
  // carry its own shade.
  const mapRoutes = useMemo(() => {
    if (!trip.result) {
      return [];
    }

    return trip.result.legs.map((leg, legIndex) => ({
      id: `leg-${legIndex}`,
      color: getLegColor(legIndex, trip.result!.legs.length),
      geometry: leg.geometry,
      isActive: true,
    }));
  }, [trip.result]);

  // Every agency currently used as a stop on the trip — shared by the
  // brand/model tally below and the per-agency breakdown, so both stay in
  // sync off the same selection.
  const selectedAgencyIds = useMemo(
    () => new Set(trip.stopAgencyIds.filter((agencyId): agencyId is string => Boolean(agencyId))),
    [trip.stopAgencyIds],
  );

  // Tally of every screen present at those agencies. Agencies are only
  // counted if a stop is currently linked to them (see stopAgencyIds) —
  // removing that stop (or editing its address by hand) drops it from the
  // tally automatically. The Set above dedupes repeats within the trip's
  // stop list — e.g. an agency that's both an arrival and a later
  // departure point — either way it's the same physical set of screens on
  // the wall, counted once. Visited agencies are excluded too: once a stop
  // has actually been
  // handled, its screens are no longer "still to prepare" and shouldn't
  // inflate the totals below.
  //
  // `count` here is installed units only — known unused stock (spares
  // sitting in an agency's stock room, see lib/screen-math.ts) is split
  // out into `stockCount`, and known HS/broken units into `hsCount`.
  // Neither `count` nor `hsCount` feeds newScreensNeededForCount directly;
  // stockCount can still surface in the surplus list below if it doesn't
  // find a pair, and hsCount always surfaces there in full (see
  // leftoverScreensTally). `hsNeedingReplacementCount` is the subset of
  // hsCount flagged `needsReplacement: true` in lib/screen-math.ts — it
  // doesn't feed the pairing/surplus math either, but it does add its own
  // new-screens need (see newScreensNeededForHs below).
  const screenTally = useMemo(() => {
    const tally = new Map<
      string,
      { brand: string; model: string; count: number; stockCount: number; hsCount: number; hsNeedingReplacementCount: number }
    >();

    selectedAgencyIds.forEach((agencyId) => {
      const agency = agencies.find((candidate) => candidate.id === agencyId);
      if (!agency || agency.visited) {
        return;
      }

      agency.screens.forEach((screen) => {
        const { installedCount, stockCount, hsCount, hsNeedingReplacementCount } = splitInstalledAndStockCount(
          agency.name,
          screen,
        );
        const key = `${screen.brand}\u0000${screen.model}`;
        const existing = tally.get(key);
        if (existing) {
          existing.count += installedCount;
          existing.stockCount += stockCount;
          existing.hsCount += hsCount;
          existing.hsNeedingReplacementCount += hsNeedingReplacementCount;
        } else {
          tally.set(key, {
            brand: screen.brand,
            model: screen.model,
            count: installedCount,
            stockCount,
            hsCount,
            hsNeedingReplacementCount,
          });
        }
      });
    });

    return Array.from(tally.values()).sort(
      (a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model),
    );
  }, [selectedAgencyIds, agencies]);

  // How many brand-new screens the trip's agencies will need in total, so
  // each old screen (and any duplicate it already has) ends up paired with
  // a matching new one, PLUS a matching new pair for every flagged HS unit
  // (see lib/screen-math.ts for both rules).
  const totalNewScreens = useMemo(
    () =>
      totalNewScreensNeeded(screenTally) +
      screenTally.reduce((sum, item) => sum + newScreensNeededForHs(item.hsNeedingReplacementCount), 0),
    [screenTally],
  );

  // Same new-screens math, but broken down per agency instead of pooled
  // across the whole trip — so e.g. "Montigny — 6 écrans neufs" is visible
  // alongside the road-trip-wide total above. Visited agencies are skipped
  // here too, for the same reason as screenTally above. Known stock units
  // are excluded before the math runs (withoutKnownStock), same as the
  // pooled tally.
  const agencyNewScreensTally = useMemo(() => {
    const rows: { id: string; name: string; newScreens: number }[] = [];

    selectedAgencyIds.forEach((agencyId) => {
      const agency = agencies.find((candidate) => candidate.id === agencyId);
      if (!agency || agency.visited) {
        return;
      }

      rows.push({
        id: agency.id,
        name: agency.name,
        newScreens:
          totalNewScreensNeeded(withoutKnownStock(agency.name, agency.screens)) +
          totalNewScreensNeededForHs(agency.name, agency.screens),
      });
    });

    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedAgencyIds, agencies]);

  // Same idea as totalNewScreens above, but without pooling old-screen
  // counts across agencies first. totalNewScreens can pair an odd leftover
  // at one agency with an odd leftover at another to shave off a new
  // screen — which only works if you physically bring old screens between
  // sites. This total assumes each agency is handled on its own (no moving
  // screens between agencies), so it's simply the sum of the "Par agence"
  // figures below and is always >= totalNewScreens.
  const totalNewScreensNoPooling = useMemo(
    () => agencyNewScreensTally.reduce((sum, agency) => sum + agency.newScreens, 0),
    [agencyNewScreensTally],
  );

  // Models where, after letting a stranded installed leftover pair up with
  // any known unused stock of the same (brand, model) — see
  // combinedLeftoverForModel — there's still an odd one out (IIYAMA) or any
  // non-IIYAMA old unit left (never pairs). These are units to physically
  // retrieve that don't factor into the new-screens totals above. Stock
  // that does find a leftover to pair with (or another stock unit of the
  // same model) is no longer "surplus with nowhere to go," so it drops out
  // of this list even though it — and its new pair-mate — still need to be
  // physically picked up.
  //
  // Known HS/broken units (hsCount) are added on top, unconditionally —
  // they never take part in the pairing math above (a broken screen can't
  // complete a redeployable pair with anything), so every HS unit always
  // shows up here in full, distinct from the "en surplus" figure.
  const leftoverScreensTally = useMemo(
    () =>
      screenTally
        .map((item) => ({
          ...item,
          leftover: combinedLeftoverForModel(item.count, item.stockCount, item.brand),
        }))
        .filter((item) => item.leftover > 0 || item.hsCount > 0),
    [screenTally],
  );

  const updateTrip = useCallback((updater: (current: TripState) => TripState) => {
    setTrip((current) => updater(current));
  }, []);

  // Serializes /api/geocode calls one after another (with a pause between
  // them) so clicking several agency markers in quick succession doesn't
  // fire concurrent requests at Nominatim — same courtesy buildTripPlan
  // already gives it when geocoding the trip's own stops.
  const geocodeQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Resolves `coordinate` (the agency's known lat/lon from
  // data/agency-coordinates.json) via reverse geocoding, and swaps the
  // result in for whichever stop currently holds the placeholder text.
  // Reverse geocoding a coordinate we already trust is far more reliable
  // than forward-geocoding "<street>, <CITY>" text, which depends on
  // Nominatim's index matching the exact street spelling and locality — a
  // match that doesn't always happen. If resolution fails, the placeholder
  // is left in place — it's still a valid, editable address field, just
  // not guaranteed to geocode on the first try.
  const resolveAgencyAddress = useCallback(
    (placeholder: string, coordinate: { lat: number; lon: number }) => {
      const run = async () => {
        try {
          const response = await fetch("/api/geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: coordinate.lat, lon: coordinate.lon }),
          });

          if (!response.ok) {
            return;
          }

          const data = (await response.json()) as { displayName?: string };
          if (!data.displayName) {
            return;
          }

          updateTrip((current) => {
            const index = current.stops.findIndex((stop) => stop === placeholder);
            if (index === -1) {
              return current;
            }
            const stops = [...current.stops];
            stops[index] = data.displayName!;
            return { ...current, stops };
          });
        } catch {
          // Leave the placeholder in place — non-critical.
        }
      };

      geocodeQueueRef.current = geocodeQueueRef.current.then(
        () =>
          new Promise<void>((resolve) => {
            run().finally(() => window.setTimeout(resolve, 1100));
          }),
      );
    },
    [updateTrip],
  );

  // Inserts the agency as the natural "next" point on the trip, so
  // clicking agencies in the order you plan to visit them keeps the trip
  // in that same order instead of reversing it:
  //   1. If "Point de départ" (the first stop) is still empty, fill that.
  //   2. Otherwise, if "Point d'arrivée" (the last stop) is still empty,
  //      fill that.
  //   3. Otherwise both ends are already set, so a brand-new stop is
  //      appended at the end. Because "Point d'arrivée" is always just
  //      "whichever stop is last", this automatically pushes the old
  //      arrival point back to become the second-to-last stop (what would
  //      read as "Point d'arrivée - 1") while the newly-clicked agency
  //      becomes the new "Point d'arrivée" — a straight line that always
  //      grows at the end.
  // Agency addresses are street-only (e.g. "12 Avenue Raymond Poincaré"),
  // with no city, which usually isn't enough on its own for the trip
  // planner's geocoder to resolve confidently — and even with the city
  // appended, free-text search can still miss (wrong street spelling,
  // missing locality, etc.). The agency marker already carries a known-good
  // lat/lon (from data/agency-coordinates.json), so we reverse-geocode that
  // instead of forward-geocoding the address text.
  const addAgencyAsEarliestWaypoint = useCallback(
    (agency: AgencyMarker) => {
      const placeholder = `${agency.address}, ${agency.name}`;

      updateTrip((current) => {
        const stops = [...current.stops];
        const stopAgencyIds = [...current.stopAgencyIds];

        const originEmpty = stops.length === 0 || stops[0].trim().length === 0;
        const destinationEmpty = stops.length > 0 && stops[stops.length - 1].trim().length === 0;

        if (originEmpty) {
          if (stops.length === 0) {
            stops.push(placeholder);
            stopAgencyIds.push(agency.id);
          } else {
            stops[0] = placeholder;
            stopAgencyIds[0] = agency.id;
          }
        } else if (destinationEmpty) {
          const lastIndex = stops.length - 1;
          stops[lastIndex] = placeholder;
          stopAgencyIds[lastIndex] = agency.id;
        } else {
          stops.push(placeholder);
          stopAgencyIds.push(agency.id);
        }

        return { ...current, stops, stopAgencyIds };
      });

      resolveAgencyAddress(placeholder, { lat: agency.lat, lon: agency.lon });
    },
    [updateTrip, resolveAgencyAddress],
  );

  // Dispatches an agency marker click based on the current mode: the
  // default "visited" toggle, or (when the mode button is on) inserting
  // the agency as a waypoint instead.
  const handleAgencyMarkerClick = useCallback(
    (agency: AgencyMarker) => {
      if (agencyClickMode === "waypoint") {
        addAgencyAsEarliestWaypoint(agency);
      } else if (agencyClickMode === "visited") {
        toggleAgencyVisited(agency.id);
      } else {
        openCommentEditor(agency.id);
      }
    },
    [agencyClickMode, addAgencyAsEarliestWaypoint, toggleAgencyVisited, openCommentEditor],
  );

  // Every fetchTrip call re-geocodes all stops from scratch and can take a
  // couple of seconds (Nominatim is throttled to ~1 request/second inside
  // buildTripPlan). That's long enough for a user to add, then remove, a
  // waypoint before the first request has even resolved — and without any
  // sequencing, whichever response lands *last* would win, even if it's the
  // stale one from before the removal. This ref tracks the most recently
  // dispatched request so a response can check "am I still the latest?"
  // before touching state, and silently drop itself if not.
  const requestSeqRef = useRef(0);

  const fetchTrip = useCallback(
    async (stops: string[], options?: { silentError?: boolean }) => {
      const stopsValidForFetch = stops.length >= 2 && stops.every((stop) => stop.trim().length > 0);
      if (!stopsValidForFetch) {
        if (!options?.silentError) {
          updateTrip((current) => ({
            ...current,
            error: "Veuillez fournir au moins deux adresses valides.",
          }));
        }
        return;
      }

      const silent = Boolean(options?.silentError);

      requestSeqRef.current += 1;
      const seq = requestSeqRef.current;
      const isStale = () => requestSeqRef.current !== seq;

      updateTrip((current) => ({
        ...current,
        loading: !silent,
        updating: silent,
        error: silent ? current.error : "",
      }));

      try {
        const response = await fetch("/api/plan-trip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stops }),
        });

        const data = (await response.json()) as TripResponse | { error?: string };

        if (!response.ok) {
          throw new Error("error" in data && data.error ? data.error : "Échec du calcul de l'itinéraire.");
        }

        // A newer request has been dispatched since this one started (e.g.
        // the user removed a waypoint while this fetch was still
        // resolving) — its own response will apply the correct state, so
        // this stale one must not overwrite it.
        if (isStale()) {
          return;
        }

        updateTrip((current) => ({
          ...current,
          result: data as TripResponse,
          loading: false,
          updating: false,
          error: "",
        }));
      } catch (submitError) {
        if (isStale()) {
          return;
        }

        updateTrip((current) => ({
          ...current,
          // A silent background failure (e.g. a transient geocoding
          // hiccup) shouldn't blank out the last known-good route on the
          // map — only clear it on an explicit, user-triggered calculation.
          result: silent ? current.result : null,
          loading: false,
          updating: false,
          error: silent
            ? current.error
            : submitError instanceof Error
              ? submitError.message
              : "Erreur inattendue lors du calcul de l'itinéraire.",
        }));
      }
    },
    [updateTrip],
  );

  const updateStop = (index: number, value: string) => {
    updateTrip((current) => ({
      ...current,
      stops: current.stops.map((stop, stopIndex) => (stopIndex === index ? value : stop)),
      // Manually editing a stop breaks its link to whichever agency (if
      // any) it was inserted as — the text no longer necessarily matches
      // that agency's location, so it should drop out of the tally.
      stopAgencyIds: current.stopAgencyIds.map((agencyId, stopIndex) => (stopIndex === index ? null : agencyId)),
    }));
  };

  const addStop = () => {
    updateTrip((current) => ({
      ...current,
      stops: [...current.stops, ""],
      stopAgencyIds: [...current.stopAgencyIds, null],
    }));
  };

  // Resets the itinerary back to a blank two-stop trip (origin +
  // destination) and clears out whatever was last calculated, since a
  // cleared set of steps no longer matches that route/result.
  const clearStops = () => {
    updateTrip(() => createTrip());
  };

  const removeStop = (index: number) => {
    updateTrip((current) => ({
      ...current,
      stops: current.stops.filter((_, stopIndex) => stopIndex !== index),
      stopAgencyIds: current.stopAgencyIds.filter((_, stopIndex) => stopIndex !== index),
    }));
  };

  // Used instead of removeStop when only the origin and destination remain
  // (i.e. there's no row left that *can* be removed): empties that row's
  // text and drops its agency link, but keeps the row itself in place.
  const clearStop = (index: number) => {
    updateTrip((current) => ({
      ...current,
      stops: current.stops.map((stop, stopIndex) => (stopIndex === index ? "" : stop)),
      stopAgencyIds: current.stopAgencyIds.map((agencyId, stopIndex) => (stopIndex === index ? null : agencyId)),
    }));
  };

  const moveStop = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= trip.stops.length) {
      return;
    }

    updateTrip((current) => {
      const stops = [...current.stops];
      [stops[index], stops[target]] = [stops[target], stops[index]];
      const stopAgencyIds = [...current.stopAgencyIds];
      [stopAgencyIds[index], stopAgencyIds[target]] = [stopAgencyIds[target], stopAgencyIds[index]];
      return { ...current, stops, stopAgencyIds };
    });
  };

  // Same effect as moveStop above but for an arbitrary distance in one go —
  // used by the drag handle below, which can jump straight from index 0 to
  // index 4 in a single drag rather than moving one slot at a time.
  const reorderStop = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }

    updateTrip((current) => {
      const stops = [...current.stops];
      const [movedStop] = stops.splice(fromIndex, 1);
      stops.splice(toIndex, 0, movedStop);

      const stopAgencyIds = [...current.stopAgencyIds];
      const [movedAgencyId] = stopAgencyIds.splice(fromIndex, 1);
      stopAgencyIds.splice(toIndex, 0, movedAgencyId);

      return { ...current, stops, stopAgencyIds };
    });
  };

  // Backs the little grab handle on each stop row (see the "controls" markup
  // below). Rather than firing a reorder on every pixel of pointer movement,
  // it tracks total displacement from the drag's starting point and only
  // swaps the stop into a new slot once the pointer has crossed roughly half
  // a row's height — the same "settle point" feel as most drag-to-reorder
  // lists. `dragTranslateY` is kept as the *remainder* after that snapping
  // (not the raw pointer delta), so the dragged row keeps following the
  // pointer smoothly across a swap instead of visually jumping by a row
  // height at the moment the reorder happens.
  const stopRowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [draggingStopIndex, setDraggingStopIndex] = useState<number | null>(null);
  const [dragTranslateY, setDragTranslateY] = useState(0);

  const handleStopHandlePointerDown = (index: number) => (event: React.PointerEvent) => {
    if (trip.loading || event.button !== 0) {
      return;
    }

    const row = stopRowRefs.current[index];
    if (!row) {
      return;
    }

    event.preventDefault();

    const rowHeight = row.getBoundingClientRect().height;
    const startY = event.clientY;
    const stopCount = trip.stops.length;
    let currentIndex = index;

    setDraggingStopIndex(index);
    setDragTranslateY(0);

    const handleMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const steps = Math.round(deltaY / rowHeight);
      const clampedSteps = Math.min(Math.max(steps, -index), stopCount - 1 - index);
      const targetIndex = index + clampedSteps;

      if (targetIndex !== currentIndex) {
        reorderStop(currentIndex, targetIndex);
        currentIndex = targetIndex;
        setDraggingStopIndex(targetIndex);
      }

      setDragTranslateY(deltaY - clampedSteps * rowHeight);
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      setDraggingStopIndex(null);
      setDragTranslateY(0);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <div className="appShell">
      <section className="mapArea">
        <TripMap
          routes={mapRoutes}
          activeStops={trip.result?.stops.map((stop) => stop.coordinate) ?? []}
          agencyMarkers={agencies}
          selectedAgencyIds={selectedAgencyIds}
          agencyClickMode={agencyClickMode}
          onAgencyClick={handleAgencyMarkerClick}
        />
      </section>

      {mobilePlannerOpen || mobileTallyOpen ? (
        <div
          className="sheetBackdrop"
          onClick={() => {
            setMobilePlannerOpen(false);
            setMobileTallyOpen(false);
          }}
        />
      ) : null}

      {screenTally.length > 0 ? (
        <div className={`topIslandLeft${mobileTallyOpen ? " sheetOpen" : ""}`}>
          <button
            type="button"
            className="sheetHandle"
            aria-label={mobileTallyOpen ? "Réduire le récapitulatif des écrans" : "Afficher le récapitulatif des écrans"}
            aria-expanded={mobileTallyOpen}
            onClick={() => setMobileTallyOpen((open) => !open)}
          >
            <span className="sheetHandleBar" aria-hidden="true" />
            <span className="sheetHandleLabel">
              Écrans{totalNewScreens > 0 ? ` — ${totalNewScreens} neuf${totalNewScreens > 1 ? "s" : ""}` : ""}
            </span>
          </button>
          <section className="resultsCard" aria-live="polite">
            <h2>Écrans pour l'ensemble du road trip</h2>
            <ul className="screenTallyList">
              {screenTally
                .filter((item) => item.count > 0 || item.hsNeedingReplacementCount > 0)
                .map((item) => {
                  const newNeeded =
                    newScreensNeededForCount(item.count, item.brand) +
                    newScreensNeededForHs(item.hsNeedingReplacementCount);
                  return (
                    <li key={`${item.brand}-${item.model}`}>
                      {item.brand} {item.model}
                      {item.count > 1 ? ` ×${item.count}` : ""}
                      {newNeeded > 0 ? (
                        <>
                          {" — "}
                          <strong>{newNeeded}</strong> écran{newNeeded > 1 ? "s" : ""} neuf
                          {newNeeded > 1 ? "s" : ""} à préparer
                        </>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
            {totalNewScreens > 0 ? (
              <p>
                Total d'écrans neufs à préparer : <strong>{totalNewScreens}</strong>
              </p>
            ) : null}
            {totalNewScreensNoPooling > 0 ? (
              <p className="tallyInfoRow">
                Total sans mutualisation entre agences :{" "}
                <span className="tallyValueWithInfo">
                  <strong>{totalNewScreensNoPooling}</strong>
                  <button
                    type="button"
                    ref={infoButtonRef}
                    className="infoButton"
                    aria-label="Explication des deux totaux d'écrans neufs"
                    aria-expanded={screenTotalsInfoOpen}
                    onClick={() => setScreenTotalsInfoOpen((open) => !open)}
                  >
                    i
                  </button>
                </span>
                {screenTotalsInfoOpen ? (
                  <span
                    className="infoTooltip"
                    role="note"
                    ref={infoTooltipRef}
                    style={
                      infoTooltipStyle
                        ? { top: infoTooltipStyle.top, left: infoTooltipStyle.left, visibility: "visible" }
                        : { top: 0, left: 0, visibility: "hidden" }
                    }
                  >
                    Le premier total suppose que les écrans usagés dépareillés d'une agence peuvent être appairés
                    avec ceux d'une autre.
                    <br />
                    Le deuxième calcule chaque agence indépendamment, pour le cas où vous n'apportez pas d'écrans
                    d'une agence à l'autre.
                    <br />
                    <b>Les écrans autres que la marque IIYAMA ne sonts pas comptés pour la mutualisation, 
                      et sont considérés comme nécéssitant deux écrans neufs pour chaque écran usagé récupéré.
                    </b>
                    <br />
                    Les agences marquées comme visitées ne sont plus comptées dans ces totaux.
                    <br />
                    Certains écrans connus comme étant en stock (non installés) sont exclus des écrans neufs à
                    préparer. S'ils peuvent former une paire avec un écran usagé dépareillé d'une autre agence (ou
                    entre eux), ils ne comptent plus non plus comme surplus — même s'ils restent à récupérer sur
                    place.
                    <br />
                    Les écrans connus comme étant HS (hors service) ne comptent jamais comme surplus ni ne peuvent
                    former de paire : ils apparaissent toujours intégralement dans la liste "à récupérer",
                    séparément du surplus. Par défaut ils sont aussi exclus des écrans neufs à préparer — mais un
                    écran HS peut être marqué individuellement (dans lib/screen-math.ts) comme "à remplacer" : il
                    reste exclu du surplus et de la mutualisation comme n'importe quel écran HS, mais ajoute alors sa
                    propre paire d'écrans neufs au total, comme n'importe quel écran usagé non redéployable.
                  </span>
                ) : null}
              </p>

            ) : null}
            {agencyNewScreensTally.length > 0 ? (
              <>
                <h3>Par agence</h3>
                <ul className="screenTallyList">
                  {agencyNewScreensTally.map((agency) => (
                    <li key={agency.id}>
                      {agency.name}
                      {" — "}
                      {agency.newScreens > 0 ? (
                        <>
                          <strong>{agency.newScreens}</strong> écran{agency.newScreens > 1 ? "s" : ""} neuf
                          {agency.newScreens > 1 ? "s" : ""} nécessaire{agency.newScreens > 1 ? "s" : ""}
                        </>
                      ) : (
                        "aucun écran neuf nécessaire"
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {leftoverScreensTally.length > 0 ? (
              <>
                <h3>Écrans à récupérer par modèle</h3>
                <ul className="screenTallyList">
                  {leftoverScreensTally.map((item) => (
                    <li key={`${item.brand}-${item.model}-leftover`}>
                      {item.brand} {item.model}
                      {item.leftover > 0 ? (
                        <>
                          {" — "}
                          <strong>{item.leftover}</strong> écran{item.leftover > 1 ? "s" : ""} en surplus
                        </>
                      ) : null}
                      {item.hsCount > 0 ? (
                        <>
                          {item.leftover > 0 ? " · " : " — "}
                          <strong>{item.hsCount}</strong> <span className="hsBadge">HS</span>
                          {item.hsNeedingReplacementCount > 0 ? (
                            <span className="hsBadge hsBadgeReplace">
                              {item.hsNeedingReplacementCount === item.hsCount
                                ? "à remplacer"
                                : `${item.hsNeedingReplacementCount} à remplacer`}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      <div className={`topIsland${mobilePlannerOpen ? " sheetOpen" : ""}`}>
        <button
          type="button"
          className="sheetHandle"
          aria-label={mobilePlannerOpen ? "Réduire le planificateur" : "Ouvrir le planificateur"}
          aria-expanded={mobilePlannerOpen}
          onClick={() => setMobilePlannerOpen((open) => !open)}
        >
          <span className="sheetHandleBar" aria-hidden="true" />
          <span className="sheetHandleLabel">Planifier</span>
        </button>
        <header className="islandHeader">
          <div>
            <h1>Planificateur de Road Trip</h1>
            <p>Préparateur chantier double écrans</p>
          </div>
          <div className="headerActions">
            <button type="button" className="themeToggle" onClick={toggleTheme}>
              {theme === "dark" ? "☀️ Mode clair" : "🌙 Mode sombre"}
            </button>
            <button
              type="button"
              className={`agencyModeToggle mode-${agencyClickMode}`}
              aria-label={`Mode de clic sur les agences : ${AGENCY_CLICK_MODE_LABEL[agencyClickMode]}. Cliquer pour changer de mode.`}
              onClick={() => setAgencyClickMode((current) => nextAgencyClickMode(current))}
            >
              {AGENCY_CLICK_MODE_LABEL[agencyClickMode]}
            </button>
          </div>
        </header>

        <form
          className="plannerForm"
          onSubmit={(event) => {
            event.preventDefault();
            void fetchTrip(trip.stops);
            // Collapse back to the peek strip so the newly-calculated route
            // is immediately visible on the map instead of hidden behind
            // the sheet — only matters on mobile, harmless elsewhere.
            setMobilePlannerOpen(false);
          }}
        >
          <section className="plannerSection">
            <div className="sectionHeading">
              <h2>Étapes</h2>
              <div className="sectionHeadingActions">
                <button type="button" className="clearStopsButton" onClick={clearStops} disabled={trip.loading || !canClearStops}>
                  Tout effacer
                </button>
                <button type="button" onClick={addStop} disabled={trip.loading}>
                  + Ajouter une étape
                </button>
              </div>
            </div>
            <ol className="itineraryOutline">
              {trip.stops.map((stop, index) => (
                <li key={`outline-${index}`}>
                  {index === 0 ? "Départ" : index === trip.stops.length - 1 ? "Arrivée" : `Étape ${index}`}:{" "}
                  <strong>{stop.trim() || "—"}</strong>
                </li>
              ))}
            </ol>

            {trip.stops.map((stop, index) => {
              const isOrigin = index === 0;
              const isDestination = index === trip.stops.length - 1;
              const isDragging = draggingStopIndex === index;

              return (
                <div
                  className={`stopRow${isDragging ? " dragging" : ""}`}
                  key={`stop-${index}`}
                  ref={(node) => {
                    stopRowRefs.current[index] = node;
                  }}
                  style={isDragging ? { transform: `translateY(${dragTranslateY}px)` } : undefined}
                >
                  <div
                    className="stopDragHandle"
                    role="button"
                    aria-label={`Glisser pour déplacer l'étape ${index + 1}`}
                    aria-disabled={trip.loading}
                    title="Glisser pour réordonner"
                    onPointerDown={handleStopHandlePointerDown(index)}
                  >
                    <span className="stopDragHandleIcon" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                  <label htmlFor={`stop-${index}`}>
                    {isOrigin ? "Point de départ" : isDestination ? "Point d'arrivée" : `Étape ${index}`}
                  </label>
                  <AddressAutocomplete
                    id={`stop-${index}`}
                    value={stop}
                    onChange={(value) => updateStop(index, value)}
                    placeholder="Entrez une adresse, une ville ou un lieu"
                    disabled={trip.loading}
                  />
                  <div className="controls">
                    <button
                      type="button"
                      onClick={() => moveStop(index, -1)}
                      disabled={trip.loading || index === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStop(index, 1)}
                      disabled={trip.loading || index === trip.stops.length - 1}
                    >
                      ↓
                    </button>
                    {trip.stops.length <= 2 ? (
                      <button
                        type="button"
                        onClick={() => clearStop(index)}
                        disabled={trip.loading || stop.trim() === ""}
                      >
                        Effacer
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => removeStop(index)}
                        disabled={trip.loading}
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>

          <button className="calculateButton" type="submit" disabled={!canCalculate || trip.loading}>
            {trip.loading ? "Calcul en cours..." : "Calculer l'itinéraire"}
          </button>

          {trip.error ? <p className="error">{trip.error}</p> : null}
        </form>

        {trip.result ? (
          <section className="resultsCard" aria-live="polite">
            <h2>
              Résumé de l'itinéraire
              {trip.updating ? <span className="muted"> · Mise à jour…</span> : null}
            </h2>
            <div className="totals">
              <p>
                Distance : <strong>{formatDistance(trip.result.totals.distanceMeters)}</strong>
              </p>
              <p>
                Durée : <strong>{formatDuration(trip.result.totals.durationSeconds)}</strong>
              </p>
            </div>
            <h3>Segments de l'itinéraire</h3>
            <ul className="legsList">
              {trip.result.legs.map((leg, index) => (
                <li key={`${leg.from}-${leg.to}-${index}`}>
                  <h4>
                    Segment {index + 1} : {leg.from} → {leg.to}
                  </h4>
                  <p>
                    Distance : <strong>{formatDistance(leg.distanceMeters)}</strong>
                  </p>
                  <p>
                    Temps de conduite : <strong>{formatDuration(leg.durationSeconds)}</strong>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>


      {commentAgencyId
        ? (() => {
            const agency = agencies.find((candidate) => candidate.id === commentAgencyId);
            if (!agency) {
              return null;
            }

            return (
              <div className="commentModalBackdrop" onClick={closeCommentEditor}>
                <div
                  className="commentModal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="commentModalTitle"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="commentModalHeader">
                    <div>
                      <h2 id="commentModalTitle">{agency.name}</h2>
                      <p className="commentModalAddress">{agency.address}</p>
                    </div>
                    <button
                      type="button"
                      className="commentModalClose"
                      aria-label="Fermer"
                      onClick={closeCommentEditor}
                    >
                      ✕
                    </button>
                  </div>

                  <textarea
                    className="commentModalTextarea"
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    placeholder="Ajoutez des infos ou un commentaire pour cette agence…"
                    rows={5}
                    autoFocus
                    disabled={commentSaving}
                  />

                  {commentSaveError ? <p className="error">{commentSaveError}</p> : null}

                  <div className="commentModalActions">
                    <button type="button" onClick={closeCommentEditor} disabled={commentSaving}>
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="commentModalSave"
                      onClick={() => saveAgencyComment(agency.id, commentDraft)}
                      disabled={commentSaving}
                    >
                      {commentSaving ? "Enregistrement…" : "Enregistrer"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()
        : null}
    </div>
  );
}