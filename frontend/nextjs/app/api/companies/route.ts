import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const backendUrl = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";
  try {
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const endpoint = queryString ? `${backendUrl}/api/companies?${queryString}` : `${backendUrl}/api/companies`;
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("GET /api/companies - Error proxying to backend:", error);
    return NextResponse.json({ error: "Failed to connect to backend service" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const backendUrl = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";
  try {
    const body = await request.json();
    const response = await fetch(`${backendUrl}/api/companies`, {
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
    console.error("POST /api/companies - Error proxying to backend:", error);
    return NextResponse.json({ error: "Failed to connect to backend service" }, { status: 500 });
  }
}
