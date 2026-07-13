import { NextResponse } from "next/server";

import { getGeocodedAgencies } from "@/lib/agencies-data";
import { getAgencyComments, getVisitedAgencyIds } from "@/lib/visited-agencies";

export async function GET() {
  // Pure in-memory read of static, build-time data — no network or
  // filesystem access here, so this can't time out or hit a read-only
  // filesystem on serverless hosts (see scripts/geocode-agencies.mjs for
  // how data/agency-coordinates.json gets populated).
  const geocodedAgencies = getGeocodedAgencies();

  // Visited state and free-text comments are the bits of data that *do*
  // need to be shared and permanent across everyone who loads the site, so
  // they live in Vercel KV (Redis) rather than in the static build-time
  // files above. Fetched together and defaulted together on failure so one
  // Redis hiccup can't leave the page half-populated.
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
