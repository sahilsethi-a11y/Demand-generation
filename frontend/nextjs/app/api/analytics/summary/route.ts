import { NextResponse } from "next/server";
import { readInstantlyMetrics } from "@/lib/instantlyMetrics";

export async function GET() {
  return NextResponse.json({
    instantly: readInstantlyMetrics(),
  });
}
