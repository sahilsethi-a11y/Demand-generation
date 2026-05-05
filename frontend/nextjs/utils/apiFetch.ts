const API_BASE = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}
