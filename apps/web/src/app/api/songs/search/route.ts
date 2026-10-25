import { NextResponse } from "next/server";
import { searchSongs } from "@/lib/queries";
import { stationRoute } from "@/lib/auth";

export const GET = stationRoute("view", async (request, { stationId }) => {
  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get("categoryId") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  return NextResponse.json(await searchSongs(stationId, { categoryId, q }));
});
