"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/utils/apiFetch";

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
    completed: "bg-emerald-400/15 text-emerald-400",
    running: "bg-blue-400/15 text-blue-400",
    queued: "bg-yellow-400/15 text-yellow-400",
    failed: "bg-red-400/15 text-red-400",
  };
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${styles[status] ?? "bg-white/10 text-white/50"}`}>
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
    if (expandedRun === id) {
      setExpandedRun(null);
      return;
    }
    setExpandedRun(id);
    if (!emails[id]) {
      setEmailsLoading(id);
      try {
        const r = await apiFetch(`/api/runs/${id}/emails`);
        const d = await r.json();
        setEmails((prev) => ({ ...prev, [id]: d.emails ?? [] }));
      } catch (e) {
        console.error(e);
      } finally {
        setEmailsLoading(null);
      }
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-white text-xl font-semibold">Pipeline Runs</h1>
        <p className="text-white/40 text-sm mt-1">History of all pipeline executions with generated emails</p>
      </div>

      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-white/40 text-sm">No runs yet. Start a pipeline run from the Pipeline tab.</p>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => {
            const pid = run.pipeline_run_id;
            const isExpanded = expandedRun === pid;
            const runEmails = pid ? (emails[pid] ?? []) : [];

            return (
              <div key={run.run_history_id} className="bg-brand-secondary rounded-xl border border-white/8 overflow-hidden">
                {/* Run row */}
                <button
                  onClick={() => toggleRun(run)}
                  className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-white/5 transition-colors"
                >
                  {/* Expand chevron */}
                  <svg
                    className={`w-4 h-4 text-white/30 flex-shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>

                  {/* Triggered by */}
                  <div className="w-44 flex-shrink-0">
                    <p className="text-white text-sm font-medium truncate">
                      {run.triggered_by_email ?? (run.schedule_id === "manual" ? "Manual" : "Scheduled")}
                    </p>
                    <p className="text-white/30 text-xs">{fmt(run.triggered_at)}</p>
                  </div>

                  <StatusBadge status={run.status} />

                  {/* Stats */}
                  <div className="flex gap-5 ml-4 flex-1">
                    {[
                      { label: "Jobs", val: run.jobs_found },
                      { label: "Companies", val: run.companies },
                      { label: "ICPs", val: run.icps_found },
                      { label: "Emails", val: run.emails_generated },
                      { label: "Sent", val: run.leads_sent },
                    ].map(({ label, val }) => (
                      <div key={label}>
                        <p className="text-white/40 text-[11px]">{label}</p>
                        <p className="text-white text-sm font-semibold">{val ?? "—"}</p>
                      </div>
                    ))}
                  </div>

                  <p className="text-white/30 text-xs flex-shrink-0">
                    {duration(run.triggered_at, run.completed_at)}
                  </p>
                </button>

                {/* Emails sub-table */}
                {isExpanded && (
                  <div className="border-t border-white/8 px-5 py-4">
                    {emailsLoading === pid ? (
                      <p className="text-white/40 text-sm">Loading emails…</p>
                    ) : runEmails.length === 0 ? (
                      <p className="text-white/30 text-sm">No emails generated for this run.</p>
                    ) : (
                      <>
                        <p className="text-white/40 text-xs mb-3">{runEmails.length} email{runEmails.length !== 1 ? "s" : ""} generated</p>
                        <div className="space-y-3">
                          {runEmails.map((email, i) => {
                            const bodyKey = `${pid}-${i}`;
                            const showFull = expandedBody[bodyKey];
                            const body = email.body ?? "";
                            return (
                              <div key={i} className="bg-white/5 rounded-lg p-4 border border-white/8">
                                <div className="flex items-start justify-between gap-4 mb-2">
                                  <div>
                                    <p className="text-white text-sm font-medium">{email.contact_name ?? "Unknown"}</p>
                                    <p className="text-white/40 text-xs">{email.contact_title ?? ""}{email.contact_title && email.contact_email ? " · " : ""}{email.contact_email ?? ""}</p>
                                  </div>
                                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                                    email.approved ? "bg-emerald-400/15 text-emerald-400" : "bg-yellow-400/15 text-yellow-400"
                                  }`}>
                                    {email.qa_status ?? (email.approved ? "approved" : "pending")}
                                  </span>
                                </div>
                                {email.subject_1 && (
                                  <p className="text-white/60 text-xs mb-1">
                                    <span className="text-white/30">Subject: </span>{email.subject_1}
                                  </p>
                                )}
                                <p className="text-white/50 text-xs leading-relaxed whitespace-pre-wrap">
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
                      <div className="mt-3 text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
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
  );
}
