"use client";

import { useEffect, useRef } from "react";

import { newScreensNeededForCount, totalNewScreensNeeded } from "@/lib/screen-math";

type Coordinate = { lat: number; lon: number };

export type MapRoute = {
  id: string;
  color: string;
  geometry: Coordinate[];
  isActive: boolean;
};

export type AgencyMarkerScreen = {
  brand: string;
  model: string;
  count: number;
};

export type AgencyMarker = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  screens: AgencyMarkerScreen[];
  visited: boolean;
};

export type AgencyClickMode = "visited" | "waypoint";

type TripMapProps = {
  routes: MapRoute[];
  activeStops: Coordinate[];
  agencyMarkers?: AgencyMarker[];
  // Agency IDs currently used as a stop somewhere in the trip — these
  // markers get a distinct "selected" color instead of the default
  // visited/not-visited green-or-purple, and revert automatically once the
  // agency is no longer a stop.
  selectedAgencyIds?: Set<string>;
  // Which action a marker click performs right now — purely cosmetic here
  // (controls the tooltip hint text), the parent decides the actual
  // behavior in onAgencyClick.
  agencyClickMode?: AgencyClickMode;
  // Called with the full agency when its marker is clicked. Parent owns
  // what that means (toggle visited vs. insert as a waypoint) and any
  // persistence — this component just reports the click.
  onAgencyClick?: (agency: AgencyMarker) => void;
};

// Escapes text dropped into a Leaflet tooltip's HTML string so agency/screen
// names can never break out of the markup they're rendered into.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildAgencyTooltipHtml(agency: AgencyMarker, mode: AgencyClickMode, isSelected: boolean): string {
  const screensHtml = agency.screens
    .map((screen) => {
      const label = `${escapeHtml(screen.brand)} ${escapeHtml(screen.model)}`;
      const suffix = screen.count > 1 ? ` &times;${screen.count}` : "";
      const newNeeded = newScreensNeededForCount(screen.count);
      const newNeededHtml = newNeeded > 0 ? ` <span class="agencyTooltipNew">+${newNeeded} neuf${newNeeded > 1 ? "s" : ""}</span>` : "";
      return `<li>${label}${suffix}${newNeededHtml}</li>`;
    })
    .join("");

  const statusHtml = agency.visited
    ? `<span class="agencyTooltipStatus visited">&#10003; Visitée</span>`
    : `<span class="agencyTooltipStatus">Non visitée</span>`;

  const hintText =
    mode === "waypoint" ? "Cliquez sur le marqueur pour l'ajouter comme prochaine étape" : "Cliquez sur le marqueur pour basculer visité";

  const totalNew = totalNewScreensNeeded(agency.screens);
  const totalNewHtml =
    totalNew > 0 ? `<span class="agencyTooltipNewTotal">${totalNew} écran${totalNew > 1 ? "s" : ""} neuf${totalNew > 1 ? "s" : ""} nécessaire${totalNew > 1 ? "s" : ""}</span>` : "";

  const selectedHtml = isSelected ? `<span class="agencyTooltipNewTotal">📍 Sur l'itinéraire</span>` : "";

  return `
    <div class="agencyTooltip">
      <strong>${escapeHtml(agency.name)}</strong>
      <span class="agencyTooltipAddress">${escapeHtml(agency.address)}</span>
      ${selectedHtml}
      ${statusHtml}
      <ul class="agencyTooltipScreens">${screensHtml}</ul>
      ${totalNewHtml}
      <span class="agencyTooltipHint">${hintText}</span>
    </div>
  `;
}

// Stable reference for the "nothing selected" default, so omitting the prop
// doesn't create a brand-new Set every render and retrigger the marker
// effect below for no reason.
const EMPTY_SELECTION: Set<string> = new Set();

export function TripMap({
  routes,
  activeStops,
  agencyMarkers = [],
  selectedAgencyIds = EMPTY_SELECTION,
  agencyClickMode = "visited",
  onAgencyClick,
}: TripMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const routeLayerGroupRef = useRef<import("leaflet").LayerGroup | null>(null);
  const stopLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const agencyLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  // The click handler closes over onAgencyClick; keeping the latest
  // callback in a ref means the agency-marker effect below doesn't need to
  // depend on it (and therefore doesn't need to redraw markers just because
  // the parent re-created the callback).
  const onAgencyClickRef = useRef(onAgencyClick);

  useEffect(() => {
    onAgencyClickRef.current = onAgencyClick;
  }, [onAgencyClick]);

  useEffect(() => {
    let isMounted = true;

    async function initializeMap() {
      if (!mapContainerRef.current || mapRef.current) {
        return;
      }

      const L = await import("leaflet");

      if (!isMounted || !mapContainerRef.current) {
        return;
      }

      const map = L.map(mapContainerRef.current, {
        center: [46.5, 2.2],
        zoom: 6,
        zoomControl: false,
      });

      const roadLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      });

      roadLayer.addTo(map);

      routeLayerGroupRef.current = L.layerGroup().addTo(map);
      stopLayerRef.current = L.layerGroup().addTo(map);
      agencyLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
    }

    initializeMap();

    return () => {
      isMounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
      routeLayerGroupRef.current = null;
      stopLayerRef.current = null;
      agencyLayerRef.current = null;
    };
  }, []);

  // Agency markers are static reference data (independent of the routes
  // being planned), so they get their own effect keyed only on the list
  // itself rather than being redrawn every time a route changes.
  useEffect(() => {
    async function renderAgencyMarkers() {
      if (!mapRef.current || !agencyLayerRef.current) {
        return;
      }

      const L = await import("leaflet");
      const agencyLayer = agencyLayerRef.current;
      agencyLayer.clearLayers();

      agencyMarkers.forEach((agency) => {
        const isSelected = selectedAgencyIds.has(agency.id);

        const style = isSelected
          ? {
              // Selected (currently used as a stop somewhere in the trip) —
              // stands out from both the visited-green and
              // not-visited-purple defaults, and reverts automatically once
              // it's no longer a stop.
              radius: 9,
              color: "#1d4ed8",
              weight: 3,
              fillColor: "#3b82f6",
              fillOpacity: 0.95,
            }
          : agency.visited
            ? {
                radius: 7,
                color: "#16a34a",
                weight: 2,
                fillColor: "#4ade80",
                fillOpacity: 0.9,
              }
            : {
                radius: 7,
                color: "#7c3aed",
                weight: 2,
                fillColor: "#a78bfa",
                fillOpacity: 0.85,
              };

        const marker = L.circleMarker([agency.lat, agency.lon], style);

        marker.bindTooltip(buildAgencyTooltipHtml(agency, agencyClickMode, isSelected), {
          direction: "top",
          sticky: true,
          opacity: 1,
          className: "agencyTooltipWrapper",
        });

        marker.on("click", () => {
          onAgencyClickRef.current?.(agency);
        });

        marker.addTo(agencyLayer);
      });
    }

    renderAgencyMarkers();
  }, [agencyMarkers, agencyClickMode, selectedAgencyIds]);

  useEffect(() => {
    async function renderRoutes() {
      if (!mapRef.current || !routeLayerGroupRef.current || !stopLayerRef.current) {
        return;
      }

      const L = await import("leaflet");
      const map = mapRef.current;
      const routeLayerGroup = routeLayerGroupRef.current;
      const stopLayer = stopLayerRef.current;

      routeLayerGroup.clearLayers();

      // Draw inactive/older routes first so the currently selected one is
      // always drawn on top and stands out.
      const orderedRoutes = [...routes].sort((a, b) => Number(a.isActive) - Number(b.isActive));
      const allLatLngs: [number, number][] = [];

      orderedRoutes.forEach((route) => {
        const latLngs = route.geometry.map((point) => [point.lat, point.lon] as [number, number]);
        if (latLngs.length < 2) {
          return;
        }

        allLatLngs.push(...latLngs);

        // Non-active routes stay clearly visible (not just a faint hint) —
        // only noticeably thinner/lighter than the active day, not washed out.
        L.polyline(latLngs, {
          color: route.color,
          weight: route.isActive ? 6 : 4.5,
          opacity: route.isActive ? 0.95 : 0.8,
        }).addTo(routeLayerGroup);
      });

      stopLayer.clearLayers();
      activeStops.forEach((stop, index) => {
        L.circleMarker([stop.lat, stop.lon], {
          radius: 6,
          color: index === 0 ? "#16a34a" : index === activeStops.length - 1 ? "#dc2626" : "#1f2937",
          fillColor: "#ffffff",
          fillOpacity: 0.9,
          weight: 3,
        }).addTo(stopLayer);
      });

      const stopLatLngs = activeStops.map((stop) => [stop.lat, stop.lon] as [number, number]);
      const boundsPoints = allLatLngs.length > 1 ? allLatLngs : stopLatLngs;

      if (boundsPoints.length > 1) {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [32, 32] });
        return;
      }

      if (stopLatLngs.length > 0) {
        map.fitBounds(L.latLngBounds(stopLatLngs), { padding: [32, 32], maxZoom: 11 });
      }
    }

    renderRoutes();
  }, [routes, activeStops]);

  return <div className="mapViewport" ref={mapContainerRef} aria-label="Road trip map" />;
}