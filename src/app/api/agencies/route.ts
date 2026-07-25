import { NextResponse } from "next/server";

import { createAgency, getGeocodedAgencies, parseAgencyInput, parseOptionalCoordinate } from "@/lib/agencies-data";
import { geocodeAddress, safeErrorMessage, safeErrorStatus } from "@/lib/trip-planner";
import { getAgencyComments, getVisitedAgencyIds } from "@/lib/visited-agencies";

export async function GET() {
  let geocodedAgencies;
  try {
    geocodedAgencies = await getGeocodedAgencies();
  } catch (error) {
    console.error("[GET /api/agencies] failed to load agency data:", error);
    return NextResponse.json({ error: "Agency data is unavailable." }, { status: 500 });
  }

  // Visited state and comments already live in Redis and can safely
  // default to empty on failure — that behavior is unchanged.
  let visitedIds: Set<string>;
  let comments: Map<string, string>;
  try {
    [visitedIds, comments] = await Promise.all([getVisitedAgencyIds(), getAgencyComments()]);
  } catch (error) {
    console.error("[GET /api/agencies] failed to load visited/comment state:", error);
    visitedIds = new Set();
    comments = new Map();
  }

  const agencies = geocodedAgencies.map((agency) => ({
    ...agency,
    visited: visitedIds.has(agency.id),
    comment: comments.get(agency.id) ?? "",
  }));

  return NextResponse.json({ agencies }, { status: 200 });
}

// Creates a brand-new agency. The address is geocoded server-side (same
// Nominatim call the trip planner itself uses) unless the caller already
// supplies a manual lat/lon override, so every agency in Redis always ends
// up with a usable map marker.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête JSON invalide." }, { status: 400 });
  }

  try {
    const input = parseAgencyInput(body);
    const manualCoordinate = parseOptionalCoordinate(body);
    const coordinate = manualCoordinate ?? (await geocodeAddress(input.address)).coordinate;

    const agency = await createAgency(input, coordinate);
    return NextResponse.json({ agency }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/agencies] failed to create agency:", error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Impossible de créer l'agence.") },
      { status: safeErrorStatus(error) },
    );
  }
}