import { NextResponse } from "next/server";

import { buildTripPlan, safeErrorMessage, safeErrorStatus } from "@/lib/trip-planner";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { stops?: unknown; days?: unknown };

    const stops = Array.isArray(body.stops)
      ? body.stops.filter((item): item is string => typeof item === "string")
      : [];
    const days = typeof body.days === "number" ? body.days : Number(body.days ?? 0);

    const result = await buildTripPlan(stops, days);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[POST /api/plan-trip] failed:", error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Trip planning failed.") },
      { status: safeErrorStatus(error) },
    );
  }
}
