import { NextResponse } from "next/server";

import { addHqStockScreen, getHqStockScreens, parseHqStockInput, removeHqStockScreen } from "@/lib/agencies-data";
import { safeErrorMessage, safeErrorStatus } from "@/lib/trip-planner";

// GET returns every screen model currently in stock at HQ (possibly an
// empty list).
export async function GET() {
  try {
    const screens = await getHqStockScreens();
    return NextResponse.json({ screens }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/hq-stock] failed to load HQ stock:", error);
    return NextResponse.json({ error: "Le stock du siège est indisponible." }, { status: 500 });
  }
}

// POST adds a screen model to HQ stock. Any number of distinct models can
// be in stock at once, but at most one of any given (brand, model) — a
// duplicate is rejected rather than silently replacing the existing entry.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête JSON invalide." }, { status: 400 });
  }

  try {
    const input = parseHqStockInput(body);
    const screens = await addHqStockScreen(input);
    return NextResponse.json({ screens }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/hq-stock] failed to add HQ stock:", error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Impossible d'ajouter l'écran en stock.") },
      { status: safeErrorStatus(error) },
    );
  }
}

// DELETE removes a single screen model from HQ stock (identified by
// brand/model in the JSON body) — e.g. once it's actually been taken
// along on a trip. The rest of the stock is left untouched.
export async function DELETE(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête JSON invalide." }, { status: 400 });
  }

  try {
    const input = parseHqStockInput(body);
    const screens = await removeHqStockScreen(input.brand, input.model);
    return NextResponse.json({ screens }, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/hq-stock] failed to remove HQ stock:", error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Impossible de supprimer l'écran en stock.") },
      { status: safeErrorStatus(error) },
    );
  }
}