"use client";

import { apiFetch } from "@/utils/apiFetch";
import { useState, useEffect, useCallback } from "react";
import JobDetailModal from "@/components/JobDetailModal";
import LoadingSpinner from "@/components/LoadingSpinner";

const SOURCE_LABELS: Record<string, string> = {
  all: "All Sources",
  greenhouse: "Greenhouse",
  ashby: "Ashby",
  lever: "Lever",
  linkedin: "LinkedIn",
  naukri: "Naukri",
  indeed: "Indeed",
};

const SOURCE_COLORS: Record<string, string> = {
  greenhouse: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ashby:      "bg-violet-50 text-violet-700 border-violet-200",
  lever:      "bg-blue-50 text-blue-700 border-blue-200",
  linkedin:   "bg-sky-50 text-sky-700 border-sky-200",
  naukri:     "bg-orange-50 text-orange-700 border-orange-200",
  indeed:     "bg-indigo-50 text-indigo-700 border-indigo-200",
};

type OutreachStatus = "new" | "leads" | "emails_ready" | "sent";

function StatusBadge({ status }: { status: OutreachStatus }) {
  const config: Record<OutreachStatus, { dot: string; pill: string; label: string }> = {
    new:          { dot: "bg-slate-400",   pill: "bg-slate-50 text-slate-500 border-slate-200",     label: "New" },
    leads:        { dot: "bg-blue-500",    pill: "bg-blue-50 text-blue-700 border-blue-200",         label: "Has ICPs" },
    emails_ready: { dot: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 border-amber-200",      label: "Emails Ready" },
    sent:         { dot: "bg-green-500",   pill: "bg-green-50 text-green-700 border-green-200",      label: "Sent to Instantly" },
  };
  const c = config[status] ?? config.new;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${c.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function InstantlyStatusBadge({ leadStatus }: { leadStatus: any }) {
  if (!leadStatus) return null;
  const status = leadStatus.status || leadStatus.lead_status || "";
  const opens  = leadStatus.open_count ?? leadStatus.opens ?? 0;
  const replies = leadStatus.reply_count ?? leadStatus.replies ?? 0;
  return (
    <div className="mt-1 flex gap-1.5 flex-wrap">
      {status && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 capitalize">
          {status.replace(/_/g, " ")}
        </span>
      )}
      {opens > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
          {opens} open{opens !== 1 ? "s" : ""}
        </span>
      )}
      {replies > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 border border-green-100">
          {replies} repl{replies !== 1 ? "ies" : "y"}
        </span>
      )}
    </div>
  );
}

export default function JobsPage() {
  const [jobs, setJobs]           = useState<any[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [source, setSource]       = useState("all");
  const [search, setSearch]       = useState("");
  const [page, setPage]           = useState(1);
  const [counts, setCounts]       = useState<Record<string, number>>({});
  const [selectedJob, setSelectedJob] = useState<any>(null);

  // Send-to-Instantly state — Set of company_keys currently in-flight (individual or bulk)
  const [sendingKeys, setSendingKeys] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [toast, setToast]         = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Bulk selection — keyed by company_key
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Instantly lead status per company_key
  const [instantlyStatuses, setInstantlyStatuses] = useState<Record<string, Record<string, any>>>({});
  const [checkingStatus, setCheckingStatus]       = useState<string | null>(null);

  const PAGE_SIZE = 50;

  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
      source,
      role_query: search,
    });
    const res = await apiFetch(`/api/jobs/saved?${params}`).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setJobs(data.jobs || []);
      setTotal(data.total || 0);
      const c: Record<string, number> = {};
      for (const j of data.jobs || []) {
        const s = j.source || "unknown";
        c[s] = (c[s] || 0) + 1;
      }
      setCounts((prev) => ({ ...prev, ...c }));
    }
    setLoading(false);
  }, [page, source, search]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const sendToInstantly = async (e: React.MouseEvent, job: any, overwrite = false) => {
    e.stopPropagation();
    const companyKey = job.company_key;
    if (!companyKey || sendingKeys.has(companyKey)) return;
    setSendingKeys((prev) => new Set(prev).add(companyKey));
    try {
      const res = await apiFetch(`/api/companies/${encodeURIComponent(companyKey)}/instantly-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite }),
      }).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        const count = data.sent_count ?? 0;
        showToast("success", `${count} lead${count !== 1 ? "s" : ""} sent to Instantly.`);
        setJobs((prev) =>
          prev.map((j) =>
            j.company_key === companyKey
              ? { ...j, outreach_status: "sent", instantly_sent_at: Date.now() }
              : j
          )
        );
      } else {
        const err = await res?.json().catch(() => ({}));
        showToast("error", err?.detail || "Failed to send to Instantly.");
      }
    } finally {
      setSendingKeys((prev) => { const next = new Set(prev); next.delete(companyKey); return next; });
    }
  };

  const checkInstantlyStatus = async (e: React.MouseEvent, job: any) => {
    e.stopPropagation();
    const companyKey = job.company_key;
    if (!companyKey || checkingStatus) return;
    setCheckingStatus(companyKey);
    try {
      const res = await apiFetch(
        `/api/companies/${encodeURIComponent(companyKey)}/instantly-status`
      ).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        setInstantlyStatuses((prev) => ({ ...prev, [companyKey]: data.leads || {} }));
      }
    } finally {
      setCheckingStatus(null);
    }
  };

  // Derived selection helpers
  const readyJobs      = jobs.filter((j) => j.outreach_status === "emails_ready");
  const selectedReady  = jobs.filter(
    (j) => selectedKeys.has(j.company_key) && j.outreach_status === "emails_ready"
  );
  const allPageKeys    = jobs.map((j) => j.company_key).filter(Boolean);
  const allSelected    = allPageKeys.length > 0 && allPageKeys.every((k) => selectedKeys.has(k));
  const someSelected   = selectedKeys.size > 0;

  const toggleRow = (e: React.MouseEvent, companyKey: string) => {
    e.stopPropagation();
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(companyKey) ? next.delete(companyKey) : next.add(companyKey);
      return next;
    });
  };

  const toggleAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedKeys(e.target.checked ? new Set(allPageKeys) : new Set());
  };

  const sendBulkToInstantly = async () => {
    if (selectedReady.length === 0 || bulkSending) return;
    setBulkSending(true);
    let sent = 0;
    let failed = 0;
    for (const job of selectedReady) {
      const companyKey = job.company_key;
      setSendingKeys((prev) => new Set(prev).add(companyKey));
      try {
        const res = await apiFetch(
          `/api/companies/${encodeURIComponent(companyKey)}/instantly-send`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ overwrite: job.outreach_status === "sent" }),
          }
        ).catch(() => null);
        if (res?.ok) {
          sent++;
          setJobs((prev) =>
            prev.map((j) =>
              j.company_key === companyKey
                ? { ...j, outreach_status: "sent", instantly_sent_at: Date.now() }
                : j
            )
          );
        } else {
          failed++;
        }
      } catch {
        failed++;
      } finally {
        setSendingKeys((prev) => { const next = new Set(prev); next.delete(companyKey); return next; });
      }
    }
    setBulkSending(false);
    setSelectedKeys(new Set());
    if (failed === 0) {
      showToast("success", `${sent} compan${sent !== 1 ? "ies" : "y"} sent to Instantly.`);
    } else {
      showToast("error", `${sent} sent, ${failed} failed.`);
    }
  };

  const sources = ["all", "greenhouse", "ashby", "lever", "linkedin", "naukri", "indeed"];

  return (
    <>
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Toast */}
        {toast && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
            toast.type === "success"
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}>
            {toast.msg}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-brand-secondary">Jobs</h1>
            <p className="text-slate-500 text-sm mt-0.5">{total.toLocaleString()} jobs discovered</p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search by role..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary w-56"
            />
            <button
              onClick={fetchJobs}
              className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-blue-800 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Source tabs */}
        <div className="flex gap-1 mb-4 bg-white border border-brand-border rounded-lg p-1 w-fit">
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => { setSource(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                source === s
                  ? "bg-brand-primary text-white"
                  : "text-slate-500 hover:text-brand-secondary hover:bg-slate-50"
              }`}
            >
              {SOURCE_LABELS[s] || s}
              {s !== "all" && counts[s] ? (
                <span className="ml-1.5 text-xs opacity-75">({counts[s]})</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Bulk action bar */}
        {someSelected && (
          <div className="mb-3 flex items-center justify-between gap-4 px-4 py-3 bg-brand-primary/5 border border-brand-primary/20 rounded-xl">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-semibold text-brand-secondary">
                {selectedKeys.size} selected
              </span>
              {selectedReady.length > 0 && (
                <span className="text-slate-500">
                  · {selectedReady.length} with emails ready
                </span>
              )}
              {selectedKeys.size > selectedReady.length && (
                <span className="text-slate-400 text-xs">
                  ({selectedKeys.size - selectedReady.length} skipped — no emails yet)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedReady.length > 0 && (
                <button
                  onClick={sendBulkToInstantly}
                  disabled={bulkSending}
                  className="px-4 py-2 text-sm font-semibold text-white bg-brand-primary rounded-lg hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bulkSending
                    ? "Sending…"
                    : `Send ${selectedReady.length} to Instantly`}
                </button>
              )}
              <button
                onClick={() => setSelectedKeys(new Set())}
                className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Jobs table */}
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          {loading ? (
            <LoadingSpinner label="Loading jobs..." />
          ) : jobs.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-slate-400 text-sm">No jobs found.</p>
              <a href="/pipeline" className="text-brand-primary text-sm mt-2 inline-block hover:underline">
                Run the pipeline to discover jobs →
              </a>
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-border bg-slate-50">
                    <th className="pl-4 pr-2 py-3 w-8" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                        onChange={toggleAll}
                        className="w-4 h-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
                        title={allSelected ? "Deselect all" : "Select all on page"}
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Company</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Posted</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">ICPs</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Emails</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {jobs.map((job, i) => {
                    const companyKey     = job.company_key;
                    const status         = (job.outreach_status as OutreachStatus) || "new";
                    const isSending      = sendingKeys.has(companyKey);
                    const isCheckingSt   = checkingStatus === companyKey;
                    const leadStatuses   = instantlyStatuses[companyKey];
                    const hasSentBefore  = status === "sent";
                    const canSend        = status === "emails_ready";
                    const icpCount       = job.contacts_count ?? 0;
                    const emailCount     = job.email_count ?? 0;

                    return (
                      <tr
                        key={i}
                        onClick={() => setSelectedJob(job)}
                        className={`hover:bg-slate-50 cursor-pointer transition-colors ${selectedKeys.has(companyKey) ? "bg-brand-primary/5" : ""}`}
                      >
                        <td className="pl-4 pr-2 py-3 w-8" onClick={(e) => toggleRow(e, companyKey)}>
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(companyKey)}
                            onChange={() => {}}
                            className="w-4 h-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-brand-secondary truncate max-w-[160px]">
                          {job.organization || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-700 truncate max-w-[200px]">
                          {job.title || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-500 truncate max-w-[140px]">
                          {job.display_location || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${SOURCE_COLORS[job.source] || "bg-slate-50 text-slate-500 border-slate-200"}`}>
                            {SOURCE_LABELS[job.source] || job.source || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                          {job.date_posted ? new Date(job.date_posted).toLocaleDateString() : "—"}
                        </td>

                        {/* ICP count */}
                        <td className="px-4 py-3 text-center">
                          {icpCount > 0 ? (
                            <span className="inline-block text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                              {icpCount}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>

                        {/* Email count */}
                        <td className="px-4 py-3 text-center">
                          {emailCount > 0 ? (
                            <span className="inline-block text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                              {emailCount}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <StatusBadge status={status} />
                          {hasSentBefore && job.instantly_sent_at && (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {new Date(job.instantly_sent_at).toLocaleDateString()}
                              {(job.instantly_resend_count ?? 0) > 0 && (
                                <span className="ml-1 text-amber-500">
                                  · resent {job.instantly_resend_count}x
                                </span>
                              )}
                            </p>
                          )}
                          {leadStatuses && Object.values(leadStatuses).map((ls, idx) => (
                            <InstantlyStatusBadge key={idx} leadStatus={ls} />
                          ))}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            {canSend && (
                              <button
                                onClick={(e) => sendToInstantly(e, job)}
                                disabled={isSending}
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-brand-primary rounded-lg hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                              >
                                {isSending ? "Sending…" : "Send to Instantly"}
                              </button>
                            )}
                            {hasSentBefore && (
                              <>
                                <button
                                  onClick={(e) => sendToInstantly(e, job, true)}
                                  disabled={isSending}
                                  className="px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                                >
                                  {isSending ? "Resending…" : "Resend"}
                                </button>
                                <button
                                  onClick={(e) => checkInstantlyStatus(e, job)}
                                  disabled={isCheckingSt}
                                  className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                                >
                                  {isCheckingSt ? "Checking…" : "Check status"}
                                </button>
                              </>
                            )}
                            {status === "new" || status === "leads" ? (
                              <span className="text-xs text-slate-300">—</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {total > PAGE_SIZE && (
                <div className="px-4 py-3 border-t border-brand-border flex items-center justify-between text-sm text-slate-500">
                  <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
                  <div className="flex gap-1">
                    <button
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="px-3 py-1.5 border border-brand-border rounded-lg disabled:opacity-40 hover:bg-slate-50"
                    >
                      Previous
                    </button>
                    <button
                      disabled={page * PAGE_SIZE >= total}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-3 py-1.5 border border-brand-border rounded-lg disabled:opacity-40 hover:bg-slate-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>

    {selectedJob && (
      <JobDetailModal job={selectedJob} onClose={() => setSelectedJob(null)} />
    )}
    </>
  );
}
