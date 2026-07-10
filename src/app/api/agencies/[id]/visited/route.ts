import { NextResponse } from "next/server";

import { setAgencyVisited } from "@/lib/visited-agencies";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: agencyId } = await params;

  if (!agencyId) {
    return NextResponse.json({ error: "Missing agency id." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as { visited?: unknown };
    const visited = Boolean(body.visited);

    await setAgencyVisited(agencyId, visited);

    return NextResponse.json({ agencyId, visited }, { status: 200 });
  } catch (error) {
    console.error(`[POST /api/agencies/${agencyId}/visited] failed:`, error);
    return NextResponse.json({ error: "Could not update visited state." }, { status: 500 });
  }
}