import { NextResponse } from "next/server";

import { deleteAgency, parseAgencyInput, parseOptionalCoordinate, updateAgency } from "@/lib/agencies-data";
import { geocodeAddress, safeErrorMessage, safeErrorStatus } from "@/lib/trip-planner";
import { setAgencyComment, setAgencyVisited } from "@/lib/visited-agencies";

type RouteParams = { params: Promise<{ id: string }> };

// Overwrites an existing agency's name/address/screens. The address is
// re-geocoded (same as POST /api/agencies) unless the caller supplies a
// manual lat/lon override, so an edited address never leaves the marker
// pointing at the old location.
export async function PUT(request: Request, { params }: RouteParams) {
  const { id: agencyId } = await params;

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

    const agency = await updateAgency(agencyId, input, coordinate);
    return NextResponse.json({ agency }, { status: 200 });
  } catch (error) {
    console.error(`[PUT /api/agencies/${agencyId}] failed to update agency:`, error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Impossible de mettre à jour l'agence.") },
      { status: safeErrorStatus(error) },
    );
  }
}

// Removes an agency entirely, plus its visited flag and comment (a
// separate Redis key — see lib/visited-agencies.ts) so no orphaned state
// is left behind for an id that no longer has an agency.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id: agencyId } = await params;

  try {
    await deleteAgency(agencyId);
  } catch (error) {
    console.error(`[DELETE /api/agencies/${agencyId}] failed to delete agency:`, error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Impossible de supprimer l'agence.") },
      { status: safeErrorStatus(error) },
    );
  }

  // Best-effort cleanup — not fatal if this fails, an orphaned
  // visited/comment entry for a deleted id is harmless.
  try {
    await Promise.all([setAgencyVisited(agencyId, false), setAgencyComment(agencyId, "")]);
  } catch (error) {
    console.error(`[DELETE /api/agencies/${agencyId}] failed to clean up visited/comment state:`, error);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}