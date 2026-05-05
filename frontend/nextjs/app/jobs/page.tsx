"use client";

import { apiFetch } from "@/utils/apiFetch";

import { useState, useEffect, useCallback } from "react";
import JobDetailModal from "@/components/JobDetailModal";

const API_BASE = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

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
  ashby: "bg-violet-50 text-violet-700 border-violet-200",
  lever: "bg-blue-50 text-blue-700 border-blue-200",
  linkedin: "bg-sky-50 text-sky-700 border-sky-200",
  naukri: "bg-orange-50 text-orange-700 border-orange-200",
  indeed: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

function StatusBadge({ hasContacts }: { hasContacts: boolean }) {
  if (hasContacts) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Leads
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-200">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      New
    </span>
  );
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selectedJob, setSelectedJob] = useState<any>(null);

  const PAGE_SIZE = 50;

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
      // Build counts per source from returned jobs
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

  const sources = ["all", "greenhouse", "ashby", "lever", "linkedin", "naukri", "indeed"];

  return (
    <>
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-7xl mx-auto px-6 py-8">
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

        {/* Jobs table */}
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          {loading ? (
            <div className="px-6 py-12 text-center text-slate-400 text-sm">Loading jobs...</div>
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
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Company</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Posted</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {jobs.map((job, i) => (
                    <tr
                      key={i}
                      onClick={() => setSelectedJob(job)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-brand-secondary truncate max-w-[180px]">
                        {job.organization || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-700 truncate max-w-[220px]">
                        {job.title || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 truncate max-w-[160px]">
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
                      <td className="px-4 py-3">
                        <StatusBadge hasContacts={!!(job.contacts && job.contacts.length > 0)} />
                      </td>
                    </tr>
                  ))}
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
