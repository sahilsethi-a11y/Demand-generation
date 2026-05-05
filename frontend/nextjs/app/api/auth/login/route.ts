import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  const body = await request.json();

  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) return NextResponse.json(data, { status: res.status });

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
}
