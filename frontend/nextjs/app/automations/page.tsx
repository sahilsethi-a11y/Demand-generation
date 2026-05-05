"use client";

import { apiFetch } from "@/utils/apiFetch";

import { useState, useEffect, useCallback } from "react";
import AutomationForm, { AutomationFormData, DEFAULT_FORM_DATA } from "@/components/AutomationForm";

const API_BASE = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────────────────

interface Schedule {
  schedule_id: string;
  name: string;
  is_active: boolean;
  role: string;
  location: string;
  market: string;
  job_type: string;
  interval_minutes: number;
  cron_expr?: string;
  next_run_at: number | null;
  last_run_at: number | null;
  last_run_status: string | null;
  last_run_id: string | null;
  consecutive_failures: number;
  skip_contacted_companies: boolean;
  dedup_lookback_days: number;
  sources: string[];
  max_companies: number;
  auto_send: boolean;
  created_at: number;
}

interface RunHistoryEntry {
  run_history_id: string;
  schedule_id: string;
  pipeline_run_id: string | null;
  status: string;
  triggered_at: number;
  started_at: number | null;
  completed_at: number | null;
  error_message: string | null;
  jobs_found: number | null;
  companies: number | null;
  icps_found: number | null;
  emails_generated: number | null;
  leads_sent: number | null;
  companies_skipped_dedup: number | null;
  contacts_skipped_dedup: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ms: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function countdownTime(ms: number | null): string {
  if (!ms) return "—";
  const diff = ms - Date.now();
  if (diff <= 0) return "imminent";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `in ${secs}s`;
  if (secs < 3600) return `in ${Math.floor(secs / 60)}m`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}

function intervalLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${minutes / 60}h`;
  if (minutes === 1440) return "24h";
  if (minutes === 10080) return "weekly";
  return `${minutes}m`;
}

function statusDot(status: string | null, isActive: boolean) {
  if (!isActive) return <span className="w-2 h-2 rounded-full bg-slate-300 flex-shrink-0 inline-block" />;
  if (status === "running") return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0 inline-block" />;
  if (status === "completed") return <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 inline-block" />;
  if (status === "failed" || status === "paused_on_failure") return <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0 inline-block" />;
}

function runStatusBadge(status: string | null) {
  if (!status) return null;
  const styles: Record<string, string> = {
    completed: "bg-green-50 text-green-700",
    running: "bg-amber-50 text-amber-700",
    failed: "bg-red-50 text-red-600",
    queued: "bg-slate-100 text-slate-500",
    skipped: "bg-slate-100 text-slate-400",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] || "bg-slate-100 text-slate-400"}`}>
      {status.toUpperCase()}
    </span>
  );
}

// ── Schedule Card ─────────────────────────────────────────────────────────────

function ScheduleCard({
  schedule,
  onPause,
  onResume,
  onTrigger,
  onDelete,
  onEdit,
}: {
  schedule: Schedule;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onTrigger: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (schedule: Schedule) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function loadHistory() {
    if (historyLoading) return;
    setHistoryLoading(true);
    const res = await apiFetch(`/api/automations/${schedule.schedule_id}/history?limit=10`).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setHistory(data.history || []);
    }
    setHistoryLoading(false);
  }

  function handleExpand() {
    if (!expanded) loadHistory();
    setExpanded((v) => !v);
  }

  const isRunning = schedule.last_run_status === "running";
  const hasFailed = (schedule.consecutive_failures || 0) > 0;

  return (
    <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
      {/* Card header */}
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {statusDot(schedule.last_run_status, schedule.is_active)}
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-brand-secondary truncate">{schedule.name || `${schedule.role} / ${schedule.location}`}</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {schedule.role} · {schedule.location} · {schedule.market.toUpperCase()} · every {intervalLabel(schedule.interval_minutes)}
                {schedule.cron_expr && <span className="ml-1 text-slate-300">({schedule.cron_expr})</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Status badge */}
            {!schedule.is_active ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">PAUSED</span>
            ) : isRunning ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium animate-pulse">RUNNING</span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">ACTIVE</span>
            )}

            {/* Action buttons */}
            <button
              onClick={() => onTrigger(schedule.schedule_id)}
              title="Run now"
              className="p-1.5 text-slate-400 hover:text-brand-primary hover:bg-blue-50 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {schedule.is_active ? (
              <button
                onClick={() => onPause(schedule.schedule_id)}
                title="Pause"
                className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            ) : (
              <button
                onClick={() => onResume(schedule.schedule_id)}
                title="Resume"
                className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            )}
            <button
              onClick={() => onEdit(schedule)}
              title="Edit"
              className="p-1.5 text-slate-400 hover:text-brand-primary hover:bg-blue-50 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={() => onDelete(schedule.schedule_id)}
              title="Delete"
              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
          <span>Last run: <span className="text-slate-600">{relativeTime(schedule.last_run_at)}</span></span>
          {runStatusBadge(schedule.last_run_status)}
          {schedule.is_active && (
            <span>Next: <span className="text-slate-600">{countdownTime(schedule.next_run_at)}</span></span>
          )}
          {hasFailed && (
            <span className="text-red-500">{schedule.consecutive_failures} failure{schedule.consecutive_failures > 1 ? "s" : ""} in a row</span>
          )}
        </div>

        {/* Sources chips */}
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {(schedule.sources || []).map((s) => (
            <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 capitalize">{s}</span>
          ))}
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{schedule.max_companies} co.</span>
          {schedule.auto_send && <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600">auto-send</span>}
          {schedule.skip_contacted_companies && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">dedup on</span>}
        </div>
      </div>

      {/* Expand / collapse history */}
      <button
        onClick={handleExpand}
        className="w-full px-5 py-2 border-t border-brand-border text-xs text-slate-400 hover:bg-slate-50 transition-colors flex items-center justify-between"
      >
        <span>Run History</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-brand-border">
          {historyLoading ? (
            <p className="px-5 py-3 text-xs text-slate-400">Loading...</p>
          ) : history.length === 0 ? (
            <p className="px-5 py-3 text-xs text-slate-400">No runs yet.</p>
          ) : (
            <div className="divide-y divide-brand-border">
              {/* Header */}
              <div className="px-5 py-2 grid grid-cols-6 gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wide bg-slate-50">
                <span>Triggered</span>
                <span>Status</span>
                <span>Jobs</span>
                <span>ICPs</span>
                <span>Sent</span>
                <span>Dedup</span>
              </div>
              {history.map((run) => (
                <div key={run.run_history_id} className="px-5 py-2.5 grid grid-cols-6 gap-2 text-xs">
                  <span className="text-slate-500">{relativeTime(run.triggered_at)}</span>
                  <span>{runStatusBadge(run.status)}</span>
                  <span className="text-slate-600">{run.jobs_found ?? "—"}</span>
                  <span className="text-slate-600">{run.icps_found ?? "—"}</span>
                  <span className="text-slate-600">{run.leads_sent ?? "—"}</span>
                  <span className="text-slate-400">
                    {(run.companies_skipped_dedup || 0) > 0 || (run.contacts_skipped_dedup || 0) > 0
                      ? `${run.companies_skipped_dedup ?? 0}co / ${run.contacts_skipped_dedup ?? 0}ct`
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function EditModal({
  schedule,
  onSave,
  onClose,
}: {
  schedule: Schedule;
  onSave: (data: AutomationFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function handleSave(data: AutomationFormData) {
    setSaving(true);
    await onSave(data);
    setSaving(false);
  }

  const initialData: Partial<AutomationFormData> = {
    name: schedule.name,
    role: schedule.role,
    location: schedule.location,
    market: schedule.market as "us" | "india",
    job_type: schedule.job_type,
    sources: schedule.sources,
    interval_minutes: schedule.interval_minutes,
    cron_expr: schedule.cron_expr || "",
    skip_contacted_companies: schedule.skip_contacted_companies,
    dedup_lookback_days: schedule.dedup_lookback_days,
    max_companies: schedule.max_companies,
    auto_send: schedule.auto_send,
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-brand-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-secondary">Edit Automation</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">
          <AutomationForm
            initialData={initialData}
            onSubmit={handleSave}
            submitLabel="Save Changes"
            loading={saving}
          />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editTarget, setEditTarget] = useState<Schedule | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchSchedules = useCallback(async () => {
    const res = await apiFetch(`/api/automations`).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setSchedules(data.schedules || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSchedules();
    // Poll every 15s when any schedule is running
    const id = setInterval(() => {
      fetchSchedules();
    }, 15000);
    return () => clearInterval(id);
  }, [fetchSchedules]);

  async function handleCreate(data: AutomationFormData) {
    setCreating(true);
    const res = await apiFetch(`/api/automations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).catch(() => null);
    setCreating(false);
    if (res?.ok) {
      showToast("Automation created");
      fetchSchedules();
    } else {
      showToast("Failed to create automation", "error");
    }
  }

  async function handleEdit(data: AutomationFormData) {
    if (!editTarget) return;
    const res = await apiFetch(`/api/automations/${editTarget.schedule_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).catch(() => null);
    if (res?.ok) {
      showToast("Automation updated");
      setEditTarget(null);
      fetchSchedules();
    } else {
      showToast("Failed to update automation", "error");
    }
  }

  async function handlePause(id: string) {
    const res = await apiFetch(`/api/automations/${id}/pause`, { method: "POST" }).catch(() => null);
    if (res?.ok) { showToast("Paused"); fetchSchedules(); }
    else showToast("Failed to pause", "error");
  }

  async function handleResume(id: string) {
    const res = await apiFetch(`/api/automations/${id}/resume`, { method: "POST" }).catch(() => null);
    if (res?.ok) { showToast("Resumed"); fetchSchedules(); }
    else showToast("Failed to resume", "error");
  }

  async function handleTrigger(id: string) {
    const res = await apiFetch(`/api/automations/${id}/trigger`, { method: "POST" }).catch(() => null);
    if (res?.ok) { showToast("Triggered — will fire within 30s"); }
    else showToast("Failed to trigger", "error");
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this automation and all its run history?")) return;
    const res = await apiFetch(`/api/automations/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) { showToast("Deleted"); fetchSchedules(); }
    else showToast("Failed to delete", "error");
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-brand-secondary">Automations</h1>
          <p className="text-slate-500 text-sm mt-1">
            Set up recurring schedules that continuously fetch jobs, enrich leads, and send outreach — fully automated.
          </p>
        </div>

        <div className="flex gap-6 items-start">

          {/* Left: Schedule list */}
          <div className="flex-1 min-w-0 space-y-4">
            {loading ? (
              <div className="bg-white border border-brand-border rounded-xl px-6 py-8 text-center text-slate-400 text-sm shadow-sm">
                Loading automations...
              </div>
            ) : schedules.length === 0 ? (
              <div className="bg-white border border-brand-border rounded-xl px-6 py-12 text-center shadow-sm">
                <svg className="w-10 h-10 text-slate-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-slate-400 text-sm font-medium">No automations yet</p>
                <p className="text-slate-300 text-xs mt-1">Create one using the form to start the loop.</p>
              </div>
            ) : (
              schedules.map((schedule) => (
                <ScheduleCard
                  key={schedule.schedule_id}
                  schedule={schedule}
                  onPause={handlePause}
                  onResume={handleResume}
                  onTrigger={handleTrigger}
                  onDelete={handleDelete}
                  onEdit={setEditTarget}
                />
              ))
            )}
          </div>

          {/* Right: Create form */}
          <div className="w-96 flex-shrink-0">
            <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-brand-border">
                <h2 className="text-sm font-semibold text-brand-secondary">New Automation</h2>
                <p className="text-xs text-slate-400 mt-0.5">Configure a recurring pipeline run</p>
              </div>
              <div className="px-5 py-5">
                <AutomationForm
                  initialData={DEFAULT_FORM_DATA}
                  onSubmit={handleCreate}
                  submitLabel="Create Automation"
                  loading={creating}
                />
              </div>
            </div>

            {/* Callout: link to manual pipeline */}
            <div className="mt-3 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-600">
              Want a one-off run instead?{" "}
              <a href="/pipeline" className="font-semibold underline hover:text-blue-800">
                Use the Pipeline page →
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editTarget && (
        <EditModal
          schedule={editTarget}
          onSave={handleEdit}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg text-white transition-all ${
          toast.type === "success" ? "bg-green-600" : "bg-red-600"
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
