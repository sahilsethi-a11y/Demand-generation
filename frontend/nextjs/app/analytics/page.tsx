"use client";

import { useState, useEffect, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

interface CampaignAnalytics {
  sends?: number;
  new_leads_contacted?: number;
  open_total?: number;
  open_unique?: number;
  reply_total?: number;
  reply_unique?: number;
  link_clicks?: number;
  bounced?: number;
  unsubscribed?: number;
  completed?: number;
  error?: string;
}

interface SendingStatus {
  summary?: {
    status?: string;
    message?: string;
  };
  diagnostics?: {
    status?: string;
    last_update?: string;
  };
  error?: string;
}

interface InstantlyData {
  campaign_id: string;
  analytics: CampaignAnalytics;
  sending_status: SendingStatus;
}

interface LocalMetrics {
  instantly?: {
    jobs_sent?: number;
    companies_sent?: number;
  };
}

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  healthy:             { bg: "bg-green-50",  text: "text-green-700",  dot: "bg-green-500" },
  campaign_completed:  { bg: "bg-blue-50",   text: "text-blue-700",   dot: "bg-blue-500" },
  campaign_paused:     { bg: "bg-amber-50",  text: "text-amber-700",  dot: "bg-amber-500" },
  campaign_draft:      { bg: "bg-slate-100", text: "text-slate-600",  dot: "bg-slate-400" },
  bounce_protect:      { bg: "bg-red-50",    text: "text-red-700",    dot: "bg-red-500" },
};

function statusStyle(status?: string) {
  if (!status) return STATUS_STYLES.campaign_draft;
  const key = Object.keys(STATUS_STYLES).find((k) => status.toLowerCase().includes(k)) ?? "campaign_draft";
  return STATUS_STYLES[key];
}

function fmt(n?: number): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function pct(numerator?: number, denominator?: number): string {
  if (!numerator || !denominator) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

function StatCard({ label, value, sub, accent = "bg-brand-primary" }: StatCardProps) {
  return (
    <div className="bg-white border border-brand-border rounded-xl p-5 shadow-sm">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-3xl font-bold text-brand-secondary">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [instantly, setInstantly] = useState<InstantlyData | null>(null);
  const [local, setLocal] = useState<LocalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [instantlyRes, localRes] = await Promise.all([
      fetch(`${API_BASE}/api/instantly-analytics`).catch(() => null),
      fetch(`/api/analytics/summary`).catch(() => null),
    ]);

    if (instantlyRes?.ok) {
      setInstantly(await instantlyRes.json());
    } else {
      const msg = instantlyRes
        ? (await instantlyRes.json().catch(() => ({}))).detail || `HTTP ${instantlyRes.status}`
        : "Could not reach backend";
      setError(msg);
    }

    if (localRes?.ok) {
      setLocal(await localRes.json());
    }

    setLastRefreshed(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const analytics = instantly?.analytics ?? {};
  const sendingStatus = instantly?.sending_status ?? {};
  const campaignStatus: string =
    sendingStatus.summary?.status ?? sendingStatus.diagnostics?.status ?? "";
  const statusLabel = campaignStatus
    ? campaignStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Unknown";
  const style = statusStyle(campaignStatus);

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-7">
          <div>
            <h1 className="text-2xl font-semibold text-brand-secondary">Analytics</h1>
            <p className="text-slate-500 text-sm mt-0.5">Instantly campaign performance</p>
          </div>
          <div className="flex items-center gap-3">
            {lastRefreshed && (
              <span className="text-xs text-slate-400">
                Updated {lastRefreshed.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchAll}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-blue-800 disabled:opacity-50 transition-colors"
            >
              <svg
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <span className="font-medium">Could not load Instantly data:</span> {error}
          </div>
        )}

        {/* Campaign status banner */}
        {!error && (
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border mb-7 ${style.bg} border-transparent`}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot} ${campaignStatus === "healthy" ? "animate-pulse" : ""}`} />
            <div>
              <span className={`text-sm font-semibold ${style.text}`}>
                Campaign status: {loading ? "…" : statusLabel}
              </span>
              {sendingStatus.summary?.message && (
                <p className={`text-xs mt-0.5 ${style.text} opacity-80`}>
                  {sendingStatus.summary.message}
                </p>
              )}
            </div>
            {instantly?.campaign_id && (
              <span className="ml-auto text-xs text-slate-400 font-mono">
                {instantly.campaign_id}
              </span>
            )}
          </div>
        )}

        {/* Delivery stats */}
        <div className="mb-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Delivery</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Leads Contacted"
              value={loading ? "…" : fmt(analytics.new_leads_contacted)}
            />
            <StatCard
              label="Emails Sent"
              value={loading ? "…" : fmt(analytics.sends)}
            />
            <StatCard
              label="Bounced"
              value={loading ? "…" : fmt(analytics.bounced)}
              sub={pct(analytics.bounced, analytics.sends) !== "—" ? `${pct(analytics.bounced, analytics.sends)} of sent` : undefined}
            />
            <StatCard
              label="Unsubscribed"
              value={loading ? "…" : fmt(analytics.unsubscribed)}
            />
          </div>
        </div>

        {/* Engagement stats */}
        <div className="mt-6 mb-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Engagement</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Unique Opens"
              value={loading ? "…" : fmt(analytics.open_unique)}
              sub={pct(analytics.open_unique, analytics.sends) !== "—" ? `${pct(analytics.open_unique, analytics.sends)} open rate` : undefined}
            />
            <StatCard
              label="Total Opens"
              value={loading ? "…" : fmt(analytics.open_total)}
            />
            <StatCard
              label="Unique Replies"
              value={loading ? "…" : fmt(analytics.reply_unique)}
              sub={pct(analytics.reply_unique, analytics.sends) !== "—" ? `${pct(analytics.reply_unique, analytics.sends)} reply rate` : undefined}
            />
            <StatCard
              label="Link Clicks"
              value={loading ? "…" : fmt(analytics.link_clicks)}
            />
          </div>
        </div>

        {/* Local pipeline metrics */}
        <div className="mt-6">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Pipeline (local)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Jobs Sent"
              value={loading ? "…" : fmt(local?.instantly?.jobs_sent ?? 0)}
            />
            <StatCard
              label="Companies Sent"
              value={loading ? "…" : fmt(local?.instantly?.companies_sent ?? 0)}
            />
            <StatCard
              label="Completed"
              value={loading ? "…" : fmt(analytics.completed)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
