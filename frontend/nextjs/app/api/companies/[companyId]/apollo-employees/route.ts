import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { companyId: string } }
) {
  const backendUrl = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";
  try {
    const body = await request.json();
    const response = await fetch(`${backendUrl}/api/companies/${params.companyId}/apollo-employees`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("POST /api/companies/[companyId]/apollo-employees - Error proxying to backend:", error);
    return NextResponse.json({ error: "Failed to connect to backend service" }, { status: 500 });
  }
}
