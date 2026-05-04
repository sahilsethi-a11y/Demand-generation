import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { companyId: string } }
) {
  const backendUrl = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";
  try {
    const response = await fetch(`${backendUrl}/api/companies/${params.companyId}`, { cache: "no-store" });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("GET /api/companies/[companyId] - Error proxying to backend:", error);
    return NextResponse.json({ error: "Failed to connect to backend service" }, { status: 500 });
  }
}
