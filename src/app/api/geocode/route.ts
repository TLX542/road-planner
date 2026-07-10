import { NextResponse } from "next/server";

import { geocodeAddress, reverseGeocode, safeErrorMessage, safeErrorStatus } from "@/lib/trip-planner";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown; lat?: unknown; lon?: unknown };

    // Agency markers already carry known-good coordinates (from
    // data/agency-coordinates.json), so when both are present we reverse
    // geocode from the point instead of forward-geocoding free text. A
    // reverse lookup from a correct point essentially always resolves,
    // whereas forward-geocoding "<street>, <CITY>" depends on Nominatim's
    // text index matching the exact street spelling/locality — which is
    // what caused some agencies not to match.
    const hasCoordinates = typeof body.lat === "number" && typeof body.lon === "number";

    const result = hasCoordinates
      ? await reverseGeocode(body.lat as number, body.lon as number)
      : await geocodeAddress(typeof body.query === "string" ? body.query : "");

    return NextResponse.json({ displayName: result.displayName }, { status: 200 });
  } catch (error) {
    console.error("[POST /api/geocode] failed:", error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Address lookup failed.") },
      { status: safeErrorStatus(error) },
    );
  }
}