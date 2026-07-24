import { NextResponse } from "next/server";

import { getGeocodedAgencies } from "@/lib/agencies-data";
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