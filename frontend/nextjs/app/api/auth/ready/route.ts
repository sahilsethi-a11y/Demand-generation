import { NextResponse } from "next/server";

const RAW_BACKEND =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_GPTR_API_URL ||
  "http://localhost:8000";

const BACKEND = RAW_BACKEND.replace(/\/+$/, "");

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/ready`, {
      method: "GET",
      cache: "no-store",
    });

    const text = await res.text();
    let data: Record<string, any> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text.slice(0, 200) };
    }

    return NextResponse.json(
      {
        ready: res.ok,
        status: data.status || (res.ok ? "ready" : "starting"),
        upstream: BACKEND,
      },
      { status: res.ok ? 200 : 503 }
    );
  } catch {
    return NextResponse.json(
      {
        ready: false,
        status: "unreachable",
        upstream: BACKEND,
      },
      { status: 503 }
    );
  }
}
