"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/utils/apiFetch";
import LoadingSpinner from "@/components/LoadingSpinner";

interface Run {
  run_history_id: string;
  schedule_id: string;
  pipeline_run_id: string;
  status: string;
  triggered_at: number;
  completed_at: number | null;
  triggered_by_email: string | null;
  jobs_found: number | null;
  companies: number | null;
  icps_found: number | null;
  emails_generated: number | null;
  leads_sent: number | null;
  error_message: string | null;
}

interface Email {
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  subject_1: string | null;
  body: string | null;
  qa_status: string | null;
  approved: number;
  company_key: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green-100 text-green-700",
    running:   "bg-blue-100 text-blue-700",
    queued:    "bg-yellow-100 text-yellow-700",
    failed:    "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${styles[status] ?? "bg-slate-100 text-slate-500"}`}>
      {status}
    </span>
  );
}

function fmt(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function duration(start: number, end: number | null) {
  if (!end) return "—";
  const s = Math.round((end - start) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [emails, setEmails] = useState<Record<string, Email[]>>({});
  const [emailsLoading, setEmailsLoading] = useState<string | null>(null);
  const [expandedBody, setExpandedBody] = useState<Record<string, boolean>>({});

  useEffect(() => {
    apiFetch("/api/runs")
      .then((r) => r.json())
      .then((d) => setRuns(d.runs ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function toggleRun(run: Run) {
    const id = run.pipeline_run_id;
    if (!id) return;
    if (expandedRun === id) { setExpandedRun(null); return; }
    setExpandedRun(id);
    if (!emails[id]) {
      setEmailsLoading(id);
      try {
        const r = await apiFetch(`/api/runs/${id}/emails`);
        const d = await r.json();
        setEmails((prev) => ({ ...prev, [id]: d.emails ?? [] }));
      } catch (e) { console.error(e); }
      finally { setEmailsLoading(null); }
    }
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-brand-secondary">Pipeline Runs</h1>
          <p className="text-slate-500 text-sm mt-1">History of all pipeline executions with generated emails</p>
        </div>

        {loading ? (
          <LoadingSpinner label="Loading runs..." />
        ) : runs.length === 0 ? (
          <div className="bg-white border border-brand-border rounded-xl px-6 py-12 text-center shadow-sm">
            <p className="text-slate-400 text-sm">No runs yet. Start a pipeline run from the Pipeline tab.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => {
              const pid = run.pipeline_run_id;
              const isExpanded = expandedRun === pid;
              const runEmails = pid ? (emails[pid] ?? []) : [];

              return (
                <div key={run.run_history_id} className="bg-white rounded-xl border border-brand-border overflow-hidden shadow-sm">
                  {/* Run row */}
                  <button
                    onClick={() => toggleRun(run)}
                    className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors"
                  >
                    <svg
                      className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>

                    <div className="w-48 flex-shrink-0">
                      <p className="text-brand-secondary text-sm font-medium truncate">
                        {run.triggered_by_email ?? (run.schedule_id === "manual" ? "Manual" : "Scheduled")}
                      </p>
                      <p className="text-slate-400 text-xs">{fmt(run.triggered_at)}</p>
                    </div>

                    <StatusBadge status={run.status} />

                    <div className="flex gap-5 ml-4 flex-1">
                      {[
                        { label: "Jobs",      val: run.jobs_found },
                        { label: "Companies", val: run.companies },
                        { label: "ICPs",      val: run.icps_found },
                        { label: "Emails",    val: run.emails_generated },
                        { label: "Sent",      val: run.leads_sent },
                      ].map(({ label, val }) => (
                        <div key={label}>
                          <p className="text-slate-400 text-[11px]">{label}</p>
                          <p className="text-brand-secondary text-sm font-semibold">{val ?? "—"}</p>
                        </div>
                      ))}
                    </div>

                    <p className="text-slate-400 text-xs flex-shrink-0">
                      {duration(run.triggered_at, run.completed_at)}
                    </p>
                  </button>

                  {/* Emails sub-table */}
                  {isExpanded && (
                    <div className="border-t border-brand-border px-5 py-4 bg-slate-50">
                      {emailsLoading === pid ? (
                        <p className="text-slate-400 text-sm">Loading emails…</p>
                      ) : runEmails.length === 0 ? (
                        <p className="text-slate-400 text-sm">No emails generated for this run.</p>
                      ) : (
                        <>
                          <p className="text-slate-400 text-xs mb-3">
                            {runEmails.length} email{runEmails.length !== 1 ? "s" : ""} generated
                          </p>
                          <div className="space-y-3">
                            {runEmails.map((email, i) => {
                              const bodyKey = `${pid}-${i}`;
                              const showFull = expandedBody[bodyKey];
                              const body = email.body ?? "";
                              return (
                                <div key={i} className="bg-white rounded-lg p-4 border border-brand-border shadow-sm">
                                  <div className="flex items-start justify-between gap-4 mb-2">
                                    <div>
                                      <p className="text-brand-secondary text-sm font-medium">{email.contact_name ?? "Unknown"}</p>
                                      <p className="text-slate-400 text-xs">
                                        {email.contact_title ?? ""}
                                        {email.contact_title && email.contact_email ? " · " : ""}
                                        {email.contact_email ?? ""}
                                      </p>
                                    </div>
                                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                                      email.approved ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                                    }`}>
                                      {email.qa_status ?? (email.approved ? "approved" : "pending")}
                                    </span>
                                  </div>
                                  {email.subject_1 && (
                                    <p className="text-slate-600 text-xs mb-1">
                                      <span className="text-slate-400">Subject: </span>{email.subject_1}
                                    </p>
                                  )}
                                  <p className="text-slate-600 text-xs leading-relaxed whitespace-pre-wrap">
                                    {showFull ? body : body.slice(0, 200)}{!showFull && body.length > 200 ? "…" : ""}
                                  </p>
                                  {body.length > 200 && (
                                    <button
                                      onClick={() => setExpandedBody((prev) => ({ ...prev, [bodyKey]: !showFull }))}
                                      className="text-brand-primary text-xs mt-1 hover:underline"
                                    >
                                      {showFull ? "Show less" : "Show more"}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}

                      {run.error_message && (
                        <div className="mt-3 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                          {run.error_message}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
