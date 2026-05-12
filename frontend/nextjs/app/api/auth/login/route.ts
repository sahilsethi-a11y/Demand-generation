import { NextRequest, NextResponse } from "next/server";

const BACKEND =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_GPTR_API_URL ||
  "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const res = await fetch(`${BACKEND}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const raw = await res.text();
    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.toLowerCase().includes("application/json");

    let data: Record<string, any> = {};
    if (raw) {
      if (isJson) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = {};
        }
      } else {
        data = { detail: raw.slice(0, 200) };
      }
    }

    if (!res.ok) {
      const detail =
        data.detail ||
        `Login failed (${res.status}). Backend at ${BACKEND} returned ${
          isJson ? "invalid JSON" : "non-JSON response"
        }.`;
      return NextResponse.json({ ...data, detail }, { status: res.status });
    }

    // Extract the JWT from the backend's Set-Cookie header
    const setCookieHeader = res.headers.get("set-cookie") ?? "";
    const match = setCookieHeader.match(/auth_token=([^;]+)/);
    const token = match?.[1] ?? "";

    const response = NextResponse.json(data);
    if (token) {
      // httpOnly:false so apiFetch can read it for Authorization headers on backend calls
      response.cookies.set("auth_token", token, {
        httpOnly: false,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7,
        path: "/",
      });
    }
    return response;
  } catch (error: any) {
    return NextResponse.json(
      {
        detail:
          error?.message ||
          "Login proxy could not reach backend. Verify BACKEND_URL or NEXT_PUBLIC_GPTR_API_URL.",
      },
      { status: 502 }
    );
  }
}
