"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState<"checking" | "ready" | "starting" | "unreachable">("checking");
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const checkReady = async () => {
      try {
        const res = await fetch("/api/auth/ready", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (data?.ready) {
          setBackendStatus("ready");
        } else if (data?.status === "starting") {
          setBackendStatus("starting");
        } else {
          setBackendStatus("unreachable");
        }
      } catch {
        if (!cancelled) setBackendStatus("unreachable");
      }
    };

    checkReady();
    const timer = setInterval(checkReady, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (backendStatus !== "ready") {
      setError("Backend is not ready yet. Please wait a few seconds and retry.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const raw = await res.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      if (!res.ok) {
        setError(data.detail || `Login failed (${res.status})`);
        return;
      }
      router.push("/pipeline");
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="bg-brand-secondary rounded-2xl p-8 shadow-xl border border-white/10">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-brand-primary flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">EMB TalentOS</p>
            <p className="text-white/50 text-xs">Demand Generation</p>
          </div>
        </div>

        <h1 className="text-white font-semibold text-xl mb-1">Sign in</h1>
        <p className="text-white/40 text-sm mb-6">Enter your credentials to continue</p>
        <p
          className={`text-xs mb-4 rounded-lg px-3 py-2 border ${
            backendStatus === "ready"
              ? "text-emerald-300 bg-emerald-400/10 border-emerald-400/20"
              : backendStatus === "starting" || backendStatus === "checking"
              ? "text-amber-300 bg-amber-400/10 border-amber-400/20"
              : "text-red-300 bg-red-400/10 border-red-400/20"
          }`}
        >
          Backend status:{" "}
          {backendStatus === "ready"
            ? "Ready"
            : backendStatus === "starting"
            ? "Starting up"
            : backendStatus === "checking"
            ? "Checking"
            : "Unreachable"}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-white/60 text-xs font-medium block mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50"
            />
          </div>
          <div>
            <label className="text-white/60 text-xs font-medium block mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 pr-10 text-white text-sm placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || backendStatus !== "ready"}
            className="w-full bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50 text-white font-medium text-sm rounded-lg py-2.5 transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
