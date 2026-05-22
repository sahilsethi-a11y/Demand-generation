import { NextRequest, NextResponse } from "next/server";

const RAW_BACKEND =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_GPTR_API_URL ||
  "http://localhost:8000";

const BACKEND = RAW_BACKEND.replace(/\/+$/, "");
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 7;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const getBackoffMs = (attempt: number) => Math.min(6000, 700 * 2 ** (attempt - 1));

async function checkBackendReady() {
  try {
    const res = await fetch(`${BACKEND}/ready`, {
      method: "GET",
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const target = `${BACKEND}/api/auth/login`;

    let res: Response | null = null;
    let networkError: unknown = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ready = await checkBackendReady();
      if (!ready) {
        if (attempt === MAX_ATTEMPTS) {
          return NextResponse.json(
            {
              detail:
                "Backend is waking up and not ready yet. Please retry in a few seconds.",
              upstream: BACKEND,
              status: 503,
            },
            { status: 503 }
          );
        }
        await sleep(getBackoffMs(attempt));
        continue;
      }

      try {
        res = await fetch(target, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        });

        if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS) {
          break;
        }
      } catch (err) {
        networkError = err;
        if (attempt === MAX_ATTEMPTS) {
          throw err;
        }
      }

      // Retry transient gateway/cold-start failures with stronger backoff.
      await sleep(getBackoffMs(attempt));
    }

    if (!res) {
      throw networkError || new Error("No response from auth upstream");
    }

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
      return NextResponse.json(
        { ...data, detail, upstream: BACKEND, status: res.status },
        { status: res.status }
      );
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
        upstream: BACKEND,
      },
      { status: 502 }
    );
  }
}
