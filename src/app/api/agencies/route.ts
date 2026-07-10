import { NextResponse } from "next/server";

import { getGeocodedAgencies } from "@/lib/agencies-data";
import { getVisitedAgencyIds } from "@/lib/visited-agencies";

export async function GET() {
  // Pure in-memory read of static, build-time data — no network or
  // filesystem access here, so this can't time out or hit a read-only
  // filesystem on serverless hosts (see scripts/geocode-agencies.mjs for
  // how data/agency-coordinates.json gets populated).
  const geocodedAgencies = getGeocodedAgencies();

  // Visited state is the one bit of data that *does* need to be shared and
  // permanent across everyone who loads the site, so it lives in Vercel KV
  // rather than in the static build-time files above.
  let visitedIds: Set<string>;
  try {
    visitedIds = await getVisitedAgencyIds();
  } catch (error) {
    console.error("[GET /api/agencies] failed to load visited state:", error);
    visitedIds = new Set();
  }

  const agencies = geocodedAgencies.map((agency) => ({
    ...agency,
    visited: visitedIds.has(agency.id),
  }));

  return NextResponse.json({ agencies }, { status: 200 });
}