import { NextResponse } from "next/server";
import { searchSongs } from "@/lib/queries";
import { stationId } from "@/lib/station";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get("categoryId") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  const results = await searchSongs(stationId, { categoryId, q });
  return NextResponse.json(results);
}
