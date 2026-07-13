import { NextResponse } from "next/server";

import { setAgencyComment } from "@/lib/visited-agencies";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: agencyId } = await params;

  if (!agencyId) {
    return NextResponse.json({ error: "Missing agency id." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as { comment?: unknown };
    // An explicit empty string clears the comment (see setAgencyComment),
    // so anything that isn't a string is treated as "no comment" rather
    // than rejected outright.
    const comment = typeof body.comment === "string" ? body.comment : "";

    await setAgencyComment(agencyId, comment);

    return NextResponse.json({ agencyId, comment: comment.trim() }, { status: 200 });
  } catch (error) {
    console.error(`[POST /api/agencies/${agencyId}/comment] failed:`, error);
    return NextResponse.json({ error: "Could not save comment." }, { status: 500 });
  }
}
