"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const apiBase = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.detail || "Invalid email or password");
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
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50 text-white font-medium text-sm rounded-lg py-2.5 transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
