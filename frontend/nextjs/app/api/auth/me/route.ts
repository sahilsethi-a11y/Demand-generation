import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "change-me-please-set-jwt-secret-env-var"
);

export async function GET(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value;
  if (!token) return NextResponse.json(null, { status: 401 });

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return NextResponse.json({
      user_id: payload.sub,
      email: payload.email,
      role: payload.role,
    });
  } catch {
    return NextResponse.json(null, { status: 401 });
  }
}
