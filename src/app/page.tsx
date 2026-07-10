"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddressAutocomplete } from "@/components/address-autocomplete";
import { TripMap, type AgencyClickMode, type AgencyMarker } from "@/components/trip-map";
import { newScreensNeededForCount, leftoverScreensForCount, totalNewScreensNeeded } from "@/lib/screen-math";

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
  days: number;
  stops: GeocodedStop[];
  legs: TripLeg[];
  totals: {
    distanceMeters: number;
    durationSeconds: number;
  };
  routeGeometry: Coordinate[];
};

type DayPlan = {
  id: string;
  label: string;
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

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function createDay(label: string, stops: string[] = ["", ""]): DayPlan {
  return {
    id: nextId("day"),
    label,
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

// One base hue per day (cycling if there are more days than colors). Within
// a single day, each leg (the segment between two consecutive stops) shares
// that day's hue but shifts from a darker shade (first leg) to a lighter
// shade (last leg), so a multi-stop day reads as one color family while
// still letting you tell its legs apart. Other days keep their own hue so
// every day stays visible and distinguishable on the map at once.
const DAY_HUES = [212, 266, 152, 24, 338, 190, 45, 356];

function getDayHue(dayIndex: number): number {
  return DAY_HUES[dayIndex % DAY_HUES.length];
}

function getDayTabColor(dayIndex: number): string {
  return `hsl(${getDayHue(dayIndex)}, 68%, 46%)`;
}

function getLegColor(dayIndex: number, legIndex: number, legCount: number): string {
  const hue = getDayHue(dayIndex);
  const lightnessStart = 32;
  const lightnessEnd = 62;
  const progress = legCount > 1 ? legIndex / (legCount - 1) : 0;
  const lightness = lightnessStart + progress * (lightnessEnd - lightnessStart);
  return `hsl(${hue}, 68%, ${lightness}%)`;
}

export default function Home() {
  const [days, setDays] = useState<DayPlan[]>(() => [createDay("Jour 1")]);
  const [activeDayId, setActiveDayId] = useState<string>(() => days[0].id);

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

  const [agencies, setAgencies] = useState<AgencyMarker[]>([]);
  // Controls what clicking an agency marker on the map does: toggle its
  // visited flag (default) or insert it as the earliest waypoint on the
  // active day. Toggled via the small button under "+ Add waypoint".
  const [agencyClickMode, setAgencyClickMode] = useState<AgencyClickMode>("waypoint");

  // Sync with the theme the inline layout script already applied, without
  // fighting SSR (see layout.tsx for the pre-hydration script).
  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current === "dark" || current === "light") {
      setTheme(current);
    }
  }, []);

  // Agency locations (from suivi_ecrans.xlsx) are static reference data, so
  // they're fetched once on mount rather than tied to any day/route state.
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

  const activeDayIndex = days.findIndex((day) => day.id === activeDayId);
  const activeDay = days[activeDayIndex] ?? days[0];

  // Whether the current stops are complete enough to calculate. Deliberately
  // independent of loading/updating state so it doesn't flip back and forth
  // as a calculation starts and finishes (that oscillation was causing the
  // auto-recalculation effect to keep re-triggering itself indefinitely).
  const stopsValid = useMemo(
    () => activeDay.stops.length >= 2 && activeDay.stops.every((stop) => stop.trim().length > 0),
    [activeDay.stops],
  );

  const canCalculate = stopsValid && !activeDay.loading;

  // Every day that has already been calculated gets drawn, split into its
  // individual legs so each leg can carry its own shade — so switching the
  // active day never hides another day's route, and every day is always
  // visible on the map at once.
  const mapRoutes = useMemo(
    () =>
      days.flatMap((day, dayIndex) => {
        if (!day.result) {
          return [];
        }

        return day.result.legs.map((leg, legIndex) => ({
          id: `${day.id}-leg-${legIndex}`,
          color: getLegColor(dayIndex, legIndex, day.result!.legs.length),
          geometry: leg.geometry,
          isActive: day.id === activeDayId,
        }));
      }),
    [days, activeDayId],
  );

  // Every agency currently used as a stop on ANY day of the trip (not just
  // the active one) — shared by the brand/model tally below and the
  // per-agency breakdown, so both stay in sync off the same selection.
  const selectedAgencyIds = useMemo(
    () =>
      new Set(
        days.flatMap((day) => day.stopAgencyIds.filter((agencyId): agencyId is string => Boolean(agencyId))),
      ),
    [days],
  );

  // Tally of every screen present at those agencies. Agencies are only
  // counted if a stop is currently linked to them (see stopAgencyIds) —
  // removing that stop (or editing its address by hand) drops it from the
  // tally automatically. The Set above dedupes both repeats within one day
  // and an agency that shows up again on a *different* day (e.g. it's the
  // shared hinge point between Day 1's arrival and Day 2's departure) —
  // either way it's the same physical set of screens on the wall, counted
  // once.
  const screenTally = useMemo(() => {
    const tally = new Map<string, { brand: string; model: string; count: number }>();

    selectedAgencyIds.forEach((agencyId) => {
      const agency = agencies.find((candidate) => candidate.id === agencyId);
      if (!agency) {
        return;
      }

      agency.screens.forEach((screen) => {
        const key = `${screen.brand}\u0000${screen.model}`;
        const existing = tally.get(key);
        if (existing) {
          existing.count += screen.count;
        } else {
          tally.set(key, { brand: screen.brand, model: screen.model, count: screen.count });
        }
      });
    });

    return Array.from(tally.values()).sort(
      (a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model),
    );
  }, [selectedAgencyIds, agencies]);

  // How many brand-new screens the trip's agencies will need in total, so
  // each old screen (and any duplicate it already has) ends up paired with
  // a matching new one. See lib/screen-math.ts for the per-model rule.
  const totalNewScreens = useMemo(() => totalNewScreensNeeded(screenTally), [screenTally]);

  // Same new-screens math, but broken down per agency instead of pooled
  // across the whole trip — so e.g. "Montigny — 6 écrans neufs" is visible
  // alongside the road-trip-wide total above.
  const agencyNewScreensTally = useMemo(() => {
    const rows: { id: string; name: string; newScreens: number }[] = [];

    selectedAgencyIds.forEach((agencyId) => {
      const agency = agencies.find((candidate) => candidate.id === agencyId);
      if (!agency) {
        return;
      }

      rows.push({
        id: agency.id,
        name: agency.name,
        newScreens: totalNewScreensNeeded(agency.screens),
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

  // Models where the pooled old-stock count is odd, so one old unit has no
  // old partner to pair with (see leftoverScreensForCount) — always 0 or 1
  // per model, e.g. seven of the same model leaves one leftover.
  const leftoverScreensTally = useMemo(
    () =>
      screenTally
        .map((item) => ({ ...item, leftover: leftoverScreensForCount(item.count) }))
        .filter((item) => item.leftover > 0),
    [screenTally],
  );

  const updateDay = useCallback((dayId: string, updater: (day: DayPlan) => DayPlan) => {
    setDays((current) => current.map((day) => (day.id === dayId ? updater(day) : day)));
  }, []);

  // Serializes /api/geocode calls one after another (with a pause between
  // them) so clicking several agency markers in quick succession doesn't
  // fire concurrent requests at Nominatim — same courtesy buildTripPlan
  // already gives it when geocoding a day's own stops.
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
    (dayId: string, placeholder: string, coordinate: { lat: number; lon: number }) => {
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

          updateDay(dayId, (current) => {
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
    [updateDay],
  );

  // Inserts the agency as the natural "next" point on the active day, so
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

      updateDay(activeDay.id, (current) => {
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

      resolveAgencyAddress(activeDay.id, placeholder, { lat: agency.lat, lon: agency.lon });
    },
    [activeDay.id, updateDay, resolveAgencyAddress],
  );

  // Dispatches an agency marker click based on the current mode: the
  // default "visited" toggle, or (when the mode button is on) inserting
  // the agency as a waypoint instead.
  const handleAgencyMarkerClick = useCallback(
    (agency: AgencyMarker) => {
      if (agencyClickMode === "waypoint") {
        addAgencyAsEarliestWaypoint(agency);
      } else {
        toggleAgencyVisited(agency.id);
      }
    },
    [agencyClickMode, addAgencyAsEarliestWaypoint, toggleAgencyVisited],
  );

  // Every fetchTrip call re-geocodes all stops from scratch and can take a
  // couple of seconds (Nominatim is throttled to ~1 request/second inside
  // buildTripPlan). That's long enough for a user to add, then remove, a
  // waypoint before the first request has even resolved — and without any
  // sequencing, whichever response lands *last* would win, even if it's the
  // stale one from before the removal. This ref tracks the most recently
  // dispatched request per day so a response can check "am I still the
  // latest?" before touching state, and silently drop itself if not.
  const requestSeqRef = useRef<Map<string, number>>(new Map());

  const fetchTrip = useCallback(
    async (dayId: string, stops: string[], options?: { silentError?: boolean }) => {
      const stopsValidForFetch = stops.length >= 2 && stops.every((stop) => stop.trim().length > 0);
      if (!stopsValidForFetch) {
        if (!options?.silentError) {
          updateDay(dayId, (current) => ({
            ...current,
            error: "Veuillez fournir au moins deux adresses valides pour ce jour.",
          }));
        }
        return;
      }

      const silent = Boolean(options?.silentError);

      const seq = (requestSeqRef.current.get(dayId) ?? 0) + 1;
      requestSeqRef.current.set(dayId, seq);
      const isStale = () => requestSeqRef.current.get(dayId) !== seq;

      updateDay(dayId, (current) => ({
        ...current,
        loading: !silent,
        updating: silent,
        error: silent ? current.error : "",
      }));

      try {
        const response = await fetch("/api/plan-trip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stops, days: 1 }),
        });

        const data = (await response.json()) as TripResponse | { error?: string };

        if (!response.ok) {
          throw new Error("error" in data && data.error ? data.error : "Échec du calcul de l'itinéraire.");
        }

        // A newer request for this day has been dispatched since this one
        // started (e.g. the user removed a waypoint while this fetch was
        // still resolving) — its own response will apply the correct state,
        // so this stale one must not overwrite it.
        if (isStale()) {
          return;
        }

        updateDay(dayId, (current) => ({
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

        updateDay(dayId, (current) => ({
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
    [updateDay],
  );

  const updateStop = (index: number, value: string) => {
    updateDay(activeDay.id, (current) => ({
      ...current,
      stops: current.stops.map((stop, stopIndex) => (stopIndex === index ? value : stop)),
      // Manually editing a stop breaks its link to whichever agency (if
      // any) it was inserted as — the text no longer necessarily matches
      // that agency's location, so it should drop out of the tally.
      stopAgencyIds: current.stopAgencyIds.map((agencyId, stopIndex) => (stopIndex === index ? null : agencyId)),
    }));
  };

  const addStop = () => {
    updateDay(activeDay.id, (current) => ({
      ...current,
      stops: [...current.stops, ""],
      stopAgencyIds: [...current.stopAgencyIds, null],
    }));
  };

  const removeStop = (index: number) => {
    updateDay(activeDay.id, (current) => ({
      ...current,
      stops: current.stops.filter((_, stopIndex) => stopIndex !== index),
      stopAgencyIds: current.stopAgencyIds.filter((_, stopIndex) => stopIndex !== index),
    }));
  };

  const moveStop = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= activeDay.stops.length) {
      return;
    }

    updateDay(activeDay.id, (current) => {
      const stops = [...current.stops];
      [stops[index], stops[target]] = [stops[target], stops[index]];
      const stopAgencyIds = [...current.stopAgencyIds];
      [stopAgencyIds[index], stopAgencyIds[target]] = [stopAgencyIds[target], stopAgencyIds[index]];
      return { ...current, stops, stopAgencyIds };
    });
  };

  // A new day starts where the previous one ended: its first stop is
  // pre-filled with the previous day's last stop (the geocoded display name
  // if that day has already been calculated, otherwise whatever text is in
  // the field), so consecutive days chain into one continuous trip.
  const addDay = () => {
    const previousDay = days[days.length - 1];
    const lastIndex = previousDay ? previousDay.stops.length - 1 : -1;
    const lastResolvedStop = previousDay?.result?.stops[previousDay.result.stops.length - 1]?.displayName;
    const lastTypedStop = previousDay?.stops[lastIndex] ?? "";
    const carryOverStop = lastResolvedStop ?? lastTypedStop;
    const carryOverAgencyId = previousDay && lastIndex >= 0 ? previousDay.stopAgencyIds[lastIndex] : null;

    const day = createDay(`Jour ${days.length + 1}`, [carryOverStop, ""]);
    day.stopAgencyIds = [carryOverAgencyId ?? null, null];
    setDays((current) => [...current, day]);
    setActiveDayId(day.id);
  };

  const removeDay = (dayId: string) => {
    if (days.length <= 1) {
      return;
    }

    setDays((current) => current.filter((day) => day.id !== dayId));
    if (activeDayId === dayId) {
      const fallback = days.find((day) => day.id !== dayId);
      if (fallback) {
        setActiveDayId(fallback.id);
      }
    }
  };

  const switchDay = (dayId: string) => {
    setActiveDayId(dayId);
  };

  return (
    <div className="appShell">
      <section className="mapArea">
        <TripMap
          routes={mapRoutes}
          activeStops={activeDay.result?.stops.map((stop) => stop.coordinate) ?? []}
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
              {screenTally.map((item) => {
                const newNeeded = newScreensNeededForCount(item.count);
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
                    className="infoButton"
                    aria-label="Explication des deux totaux d'écrans neufs"
                    aria-expanded={screenTotalsInfoOpen}
                    onClick={() => setScreenTotalsInfoOpen((open) => !open)}
                  >
                    i
                  </button>
                </span>
                {screenTotalsInfoOpen ? (
                  <span className="infoTooltip" role="note">
                    Le premier total suppose que les écrans usagés dépareillés d'une agence peuvent être appairés
                    avec ceux d'une autre.
                    <br />
                    Le deuxième calcule chaque agence indépendamment, pour le cas où vous n'apportez pas d'écrans
                    d'une agence à l'autre.
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
                <h3>Écrans en surplus par modèle</h3>
                <ul className="screenTallyList">
                  {leftoverScreensTally.map((item) => (
                    <li key={`${item.brand}-${item.model}-leftover`}>
                      {item.brand} {item.model} — <strong>{item.leftover}</strong> écran en surplus
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
          <span className="sheetHandleLabel">{activeDay.label} · Planifier</span>
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
              className={`agencyModeToggle${agencyClickMode === "waypoint" ? " active" : ""}`}
              aria-pressed={agencyClickMode === "waypoint"}
              onClick={() => setAgencyClickMode((current) => (current === "waypoint" ? "visited" : "waypoint"))}
            >
              📍 {agencyClickMode === "waypoint" ? "Clics sur la carte : ajouter comme étape" : "Clics sur la carte : basculer visité"}
            </button>
          </div>
        </header>

        <div>
          <span className="tabGroupLabel">Jours</span>
          <div className="tabRow" role="tablist" aria-label="Jours">
            {days.map((day, dayIndex) => (
              <button
                key={day.id}
                type="button"
                role="tab"
                aria-selected={day.id === activeDayId}
                className={`tab dayTab${day.id === activeDayId ? " active" : ""}`}
                onClick={() => switchDay(day.id)}
              >
                <span
                  className="colorDot"
                  aria-hidden="true"
                  style={{ backgroundColor: getDayTabColor(dayIndex) }}
                />
                <span className="dayTabLabel">{day.label}</span>
                {days.length > 1 ? (
                  <span
                    className="tabClose"
                    role="button"
                    aria-label={`Supprimer ${day.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeDay(day.id);
                    }}
                  >
                    ✕
                  </span>
                ) : null}
              </button>
            ))}
            <button type="button" className="tab dayTab addTab" onClick={addDay}>
              <span className="dayTabLabel">+ Ajouter un jour</span>
            </button>
          </div>
        </div>

        <form
          className="plannerForm"
          onSubmit={(event) => {
            event.preventDefault();
            void fetchTrip(activeDay.id, activeDay.stops);
            // Collapse back to the peek strip so the newly-calculated route
            // is immediately visible on the map instead of hidden behind
            // the sheet — only matters on mobile, harmless elsewhere.
            setMobilePlannerOpen(false);
          }}
        >
          <section className="plannerSection">
            <div className="sectionHeading">
              <h2>Étapes — {activeDay.label}</h2>
              <button type="button" onClick={addStop} disabled={activeDay.loading}>
                + Ajouter une étape
              </button>
            </div>
            <ol className="itineraryOutline">
              {activeDay.stops.map((stop, index) => (
                <li key={`outline-${index}`}>
                  {index === 0 ? "Départ" : index === activeDay.stops.length - 1 ? "Arrivée" : `Étape ${index}`}:{" "}
                  <strong>{stop.trim() || "—"}</strong>
                </li>
              ))}
            </ol>

            {activeDay.stops.map((stop, index) => {
              const isOrigin = index === 0;
              const isDestination = index === activeDay.stops.length - 1;

              return (
                <div className="stopRow" key={`stop-${activeDay.id}-${index}`}>
                  <label htmlFor={`stop-${activeDay.id}-${index}`}>
                    {isOrigin ? "Point de départ" : isDestination ? "Point d'arrivée" : `Étape ${index}`}
                  </label>
                  <AddressAutocomplete
                    id={`stop-${activeDay.id}-${index}`}
                    value={stop}
                    onChange={(value) => updateStop(index, value)}
                    placeholder="Entrez une adresse, une ville ou un lieu"
                    disabled={activeDay.loading}
                  />
                  <div className="controls">
                    <button
                      type="button"
                      onClick={() => moveStop(index, -1)}
                      disabled={activeDay.loading || index === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStop(index, 1)}
                      disabled={activeDay.loading || index === activeDay.stops.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStop(index)}
                      disabled={activeDay.loading || activeDay.stops.length <= 2}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              );
            })}
          </section>

          <button className="calculateButton" type="submit" disabled={!canCalculate || activeDay.loading}>
            {activeDay.loading ? "Calcul en cours..." : `Calculer l'itinéraire pour ${activeDay.label}`}
          </button>

          {activeDay.error ? <p className="error">{activeDay.error}</p> : null}
        </form>

        {activeDay.result ? (
          <section className="resultsCard" aria-live="polite">
            <h2>
              Résumé de l'itinéraire — {activeDay.label}
              {activeDay.updating ? <span className="muted"> · Mise à jour…</span> : null}
            </h2>
            <div className="totals">
              <p>
                Distance : <strong>{formatDistance(activeDay.result.totals.distanceMeters)}</strong>
              </p>
              <p>
                Durée : <strong>{formatDuration(activeDay.result.totals.durationSeconds)}</strong>
              </p>
            </div>
            <h3>Segments de l'itinéraire</h3>
            <ul className="legsList">
              {activeDay.result.legs.map((leg, index) => (
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
    </div>
  );
}