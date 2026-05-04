"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import JobDetailModal from "@/components/JobDetailModal";

const API_BASE = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = "idle" | "running" | "done" | "error";

interface StepState {
  status: StepStatus;
  input: string;
  output: any;
  error?: string;
  cost?: number;
  tokens?: { prompt: number; completion: number };
  elapsed?: number;
}

const INITIAL_STEP: StepState = {
  status: "idle",
  input: "",
  output: null,
};

// ─── Log types ────────────────────────────────────────────────────────────────

interface LogEntry {
  time: string;
  step: number;
  stepName: string;
  type: "start" | "done" | "error";
  elapsed?: number;
  detail: string;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function parseJsonInput(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function JsonViewer({ data }: { data: any }) {
  const [collapsed, setCollapsed] = useState(false);
  if (data === null || data === undefined) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute top-2 right-2 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 px-2 py-0.5 rounded"
      >
        {collapsed ? "expand" : "collapse"}
      </button>
      {!collapsed && (
        <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-auto max-h-96 font-mono whitespace-pre-wrap">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StepStatus }) {
  const map: Record<StepStatus, { label: string; cls: string }> = {
    idle: { label: "Idle", cls: "bg-gray-100 text-gray-500" },
    running: { label: "Running…", cls: "bg-blue-100 text-blue-700 animate-pulse" },
    done: { label: "Done", cls: "bg-green-100 text-green-700" },
    error: { label: "Error", cls: "bg-red-100 text-red-700" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ─── Session bar ──────────────────────────────────────────────────────────────

function SessionBar({ steps }: { steps: StepState[] }) {
  const labels = ["Jobs", "Companies", "People", "ICPs", "Emails", "Delivered"];
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl mb-6 overflow-x-auto">
      <span className="text-xs font-semibold text-gray-500 mr-2 shrink-0">Session:</span>
      {labels.map((label, i) => {
        const s = steps[i];
        const hasData = s?.output !== null;
        return (
          <div key={i} className="flex items-center gap-1 shrink-0">
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                hasData
                  ? "bg-brand-primary/10 border-brand-primary/30 text-brand-primary"
                  : "bg-white border-gray-200 text-gray-400"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${hasData ? "bg-brand-primary" : "bg-gray-300"}`} />
              {label}
            </div>
            {i < labels.length - 1 && <span className="text-gray-300 text-xs">→</span>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Jobs table renderer ──────────────────────────────────────────────────────

const JOB_SOURCE_COLORS: Record<string, string> = {
  linkedin: "bg-blue-50 text-blue-700 border-blue-200",
  naukri: "bg-purple-50 text-purple-700 border-purple-200",
  indeed: "bg-orange-50 text-orange-700 border-orange-200",
  ashby: "bg-green-50 text-green-700 border-green-200",
  greenhouse: "bg-teal-50 text-teal-700 border-teal-200",
  lever: "bg-rose-50 text-rose-700 border-rose-200",
};

function JobsTableGrid({ jobs, onSelect }: { jobs: any[]; onSelect: (job: any) => void }) {
  if (jobs.length === 0) {
    return <div className="px-4 py-8 text-center text-xs text-gray-400 italic">No jobs in this view.</div>;
  }
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-auto max-h-96">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-gray-500 w-8">#</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500">Title</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500">Company</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500">Location</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500">Posted</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500">Source</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500">Link</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map((job: any, i: number) => {
              const src = (job.source || job.source_type || "").toLowerCase();
              const sourceColor = JOB_SOURCE_COLORS[src] || "bg-gray-50 text-gray-600 border-gray-200";
              const location = job.display_location || job.locations_derived?.[0] || job.location || "—";
              const url = job.url || job.listing_url || job.apply_url || job.job_url;
              const posted = job.date_posted
                ? new Date(job.date_posted).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : "—";
              return (
                <tr key={i} onClick={() => onSelect(job)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                  <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-gray-800 max-w-[200px] truncate" title={job.title}>{job.title || "—"}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[160px] truncate" title={job.organization}>{job.organization || "—"}</td>
                  <td className="px-3 py-2 text-gray-500 max-w-[140px] truncate" title={location}>{location}</td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{posted}</td>
                  <td className="px-3 py-2">
                    {src && (
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium ${sourceColor}`}>
                        {src}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="text-brand-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        ↗
                      </a>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JobsTable({ data }: { data: any }) {
  const [jobTab, setJobTab] = useState<"unique" | "all">("unique");
  const [showJson, setShowJson] = useState(false);
  const [selectedJob, setSelectedJob] = useState<any>(null);

  const uniqueJobs: any[] = data?.unique_jobs || data?.jobs || data?.results || [];
  const allJobs: any[] = data?.all_jobs || data?.fetched_jobs || uniqueJobs;
  const allCount: number = data?.collected_count ?? data?.fetched_count ?? allJobs.length;

  const displayJobs = jobTab === "unique" ? uniqueJobs : allJobs;

  return (
    <div className="space-y-2">
      {/* Stats + tab row */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setJobTab("unique")}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors border ${
            jobTab === "unique"
              ? "bg-brand-primary text-white border-brand-primary"
              : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
          }`}
        >
          Unique ({uniqueJobs.length})
        </button>
        <button
          onClick={() => setJobTab("all")}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors border ${
            jobTab === "all"
              ? "bg-brand-primary text-white border-brand-primary"
              : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
          }`}
        >
          All ({allCount})
        </button>
        <button
          onClick={() => setShowJson((v) => !v)}
          className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline decoration-dashed"
        >
          {showJson ? "show table" : "show JSON"}
        </button>
      </div>

      {showJson ? (
        <JsonViewer data={data} />
      ) : (
        <JobsTableGrid jobs={displayJobs} onSelect={setSelectedJob} />
      )}

      {selectedJob && (
        <JobDetailModal job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </div>
  );
}

function SavedJobsPickerModal({
  jobs,
  loading,
  error,
  selectedJobKeys,
  onToggle,
  onClose,
  onConfirm,
}: {
  jobs: any[];
  loading: boolean;
  error?: string;
  selectedJobKeys: string[];
  onToggle: (jobKey: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const selectedSet = new Set(selectedJobKeys);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Choose Saved Jobs</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Select jobs to populate Step 2 input automatically.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {selectedJobKeys.length} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-500 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={selectedJobKeys.length === 0}
              className="px-3 py-1.5 rounded-lg bg-brand-primary text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use Selected Jobs
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="px-6 py-12 text-center text-sm text-gray-400">Loading saved jobs…</div>
          ) : error ? (
            <div className="px-6 py-12 text-center text-sm text-red-500">{error}</div>
          ) : jobs.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-gray-400">No saved jobs found.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 w-10">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 w-12">Pick</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500">Title</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500">Company</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500">Location</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500">Source</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job, index) => {
                  const jobKey = String(job.job_key || job.url || job.listing_url || `${job.source}-${job.id || index}`);
                  const selected = selectedSet.has(jobKey);
                  const source = String(job.source || "").toLowerCase();
                  const sourceColor = JOB_SOURCE_COLORS[source] || "bg-slate-50 text-slate-600 border-slate-200";
                  return (
                    <tr
                      key={jobKey}
                      onClick={() => onToggle(jobKey)}
                      className={`border-b border-gray-100 cursor-pointer transition-colors ${
                        selected ? "bg-brand-primary/5" : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="px-4 py-3 text-gray-400">{index + 1}</td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => onToggle(jobKey)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-gray-300 text-brand-primary focus:ring-brand-primary"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800 max-w-[280px] truncate" title={job.title}>
                        {job.title || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[220px] truncate" title={job.organization}>
                        {job.organization || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[220px] truncate" title={job.display_location}>
                        {job.display_location || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {source ? (
                          <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium ${sourceColor}`}>
                            {source}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function ExtractCompaniesOutput({
  data,
  onGenerateStep3,
}: {
  data: any;
  onGenerateStep3: () => void;
}) {
  const total = typeof data?.total === "number" ? data.total : Array.isArray(data?.companies) ? data.companies.length : 0;
  const inputJobs = typeof data?.input_jobs === "number" ? data.input_jobs : 0;
  const domainCount = Array.isArray(data?.companies)
    ? data.companies.filter((company: any) => String(company?.company_domain || "").trim()).length
    : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="text-xs text-gray-500">
          {total} companies extracted from {inputJobs} jobs
        </div>
        <button
          onClick={onGenerateStep3}
          className="px-3 py-1.5 rounded-lg bg-brand-primary text-white text-xs font-medium hover:bg-blue-800 transition-colors"
        >
          Generate Step 3 Input
        </button>
      </div>
      {total > 0 && domainCount === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No company domains are available in this output. Step 3 will try Apollo organization search first and then use resolved organization IDs or domains for people lookup.
        </div>
      )}
      <JsonViewer data={data} />
    </div>
  );
}

function ApolloDiscoveryOutput({
  data,
  onGenerateStep4,
}: {
  data: any;
  onGenerateStep4: () => void;
}) {
  const people = data?.people ?? data?.results?.people ?? [];
  const resolvedCompanies = data?.resolved_companies ?? data?.results?.resolved_companies ?? [];
  const peopleCount = Array.isArray(people) ? people.length : 0;
  const companyCount = Array.isArray(resolvedCompanies) ? resolvedCompanies.length : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="text-xs text-gray-500 space-x-3">
          <span>{peopleCount} people found</span>
          {companyCount > 0 && <span>· {companyCount} companies resolved</span>}
        </div>
        <button
          onClick={onGenerateStep4}
          className="px-3 py-1.5 rounded-lg bg-brand-primary text-white text-xs font-medium hover:bg-blue-800 transition-colors"
        >
          Generate Step 4 Input
        </button>
      </div>
      {peopleCount === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No people returned. Check that company names resolved correctly in Apollo and that the role / titles match.
        </div>
      )}
      <JsonViewer data={data} />
    </div>
  );
}

// ─── Step card ────────────────────────────────────────────────────────────────

interface CarryOption {
  label: string;
  targetStep: number;
  transform: (output: any) => string;
}

interface StepCardProps {
  step: number;
  title: string;
  description: string;
  cost: string;
  endpoint: string;
  inputPlaceholder: string;
  state: StepState;
  onRun: (input: string) => Promise<void>;
  onInputChange: (v: string) => void;
  carryOptions?: CarryOption[];
  onCarry?: (targetStep: number, value: string) => void;
  warning?: string;
  extraControls?: React.ReactNode;
  renderOutput?: (output: any) => React.ReactNode;
}

function StepCard({
  step,
  title,
  description,
  cost,
  endpoint,
  inputPlaceholder,
  state,
  onRun,
  onInputChange,
  carryOptions,
  onCarry,
  warning,
  extraControls,
  renderOutput,
}: StepCardProps) {
  const [showReq, setShowReq] = useState(false);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center text-white text-sm font-bold shrink-0">
            {step}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <StatusBadge status={state.status} />
          <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
            {cost}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-3">
        {warning && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <span className="text-base leading-none">⚠️</span>
            <span>{warning}</span>
          </div>
        )}

        {/* Endpoint pill */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowReq((s) => !s)}
            className="text-xs text-gray-400 hover:text-gray-600 underline decoration-dashed"
          >
            {showReq ? "hide" : "show"} request
          </button>
          <span className="text-gray-200">·</span>
          <code className="text-xs text-gray-400 font-mono">{endpoint}</code>
        </div>

        {showReq && (
          <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-300">
            <span className="text-blue-400">POST</span> {API_BASE}{endpoint}
            <br />
            <span className="text-gray-500">Content-Type: application/json</span>
            <br />
            <br />
            {state.input
              ? JSON.stringify(parseJsonInput(state.input) || state.input, null, 2)
              : <span className="text-gray-600">{"// paste input below"}</span>}
          </div>
        )}

        {/* Input */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Input (JSON)</label>
          <textarea
            rows={5}
            className="w-full font-mono text-xs border border-gray-200 rounded-lg p-3 resize-y focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary"
            placeholder={inputPlaceholder}
            value={state.input}
            onChange={(e) => onInputChange(e.target.value)}
          />
        </div>

        {extraControls}

        {/* Run button */}
        <div className="flex items-center gap-3">
          <button
            disabled={state.status === "running"}
            onClick={() => onRun(state.input)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-primary text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {state.status === "running" ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Running…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
                </svg>
                Run Step {step}
              </>
            )}
          </button>
          {state.elapsed !== undefined && (
            <span className="text-xs text-gray-400">{(state.elapsed / 1000).toFixed(1)}s</span>
          )}
          {state.cost !== undefined && (
            <span className="text-xs text-emerald-600 font-medium">${state.cost.toFixed(5)} cost</span>
          )}
          {state.tokens && (
            <span className="text-xs text-gray-400">
              {state.tokens.prompt + state.tokens.completion} tokens
            </span>
          )}
        </div>

        {/* Error */}
        {state.status === "error" && state.error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-mono whitespace-pre-wrap">
            {state.error}
          </div>
        )}

        {/* Output */}
        {state.output !== null && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-500">Output</label>
              {carryOptions && carryOptions.length > 0 && onCarry && (
                <div className="flex items-center gap-1.5">
                  {carryOptions.map((opt) => (
                    <button
                      key={opt.targetStep}
                      onClick={() => onCarry(opt.targetStep, opt.transform(state.output))}
                      className="text-xs px-2 py-0.5 rounded bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20 font-medium transition-colors"
                    >
                      → {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {renderOutput ? renderOutput(state.output) : <JsonViewer data={state.output} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const STEP_NAMES = ["Job Search", "Extract Companies", "Apollo People Discovery", "ICP Selection", "Enrich Contacts", "Generate Email", "Send to Instantly"];

export default function TestConsolePage() {
  // 6 steps: 1=JobSearch, 2=ExtractCompanies, 3=ApolloEnrich, 4=IcpSelect, 5=GenerateEmail, 6=InstantlySend
  const [steps, setSteps] = useState<StepState[]>(
    Array.from({ length: 7 }, () => ({ ...INITIAL_STEP }))
  );

  // Extra inputs for step 1
  const [jobSearchRole, setJobSearchRole] = useState("software engineer");
  const [jobSearchLocation, setJobSearchLocation] = useState("San Francisco");
  const [jobSearchMarket, setJobSearchMarket] = useState<"us" | "india">("us");
  const [jobSearchDateFilter, setJobSearchDateFilter] = useState<"24h" | "7d" | "30d">("7d");
  const [jobSearchType, setJobSearchType] = useState<"all" | "full_time" | "contract">("all");
  const [jobSearchLimit, setJobSearchLimit] = useState(20);
  const [selectedSources, setSelectedSources] = useState<string[]>(["ashby", "greenhouse", "lever"]);
  const [savedJobsModalOpen, setSavedJobsModalOpen] = useState(false);
  const [savedJobsLoading, setSavedJobsLoading] = useState(false);
  const [savedJobsError, setSavedJobsError] = useState<string>();
  const [savedJobsFromDb, setSavedJobsFromDb] = useState<any[]>([]);
  const [selectedSavedJobKeys, setSelectedSavedJobKeys] = useState<string[]>([]);

  const MARKET_SOURCES: Record<"us" | "india", { id: string; label: string }[]> = {
    us: [
      { id: "greenhouse", label: "Greenhouse" },
      { id: "ashby", label: "Ashby" },
      { id: "lever", label: "Lever" },
    ],
    india: [
      { id: "linkedin", label: "LinkedIn" },
      { id: "naukri", label: "Naukri" },
      { id: "indeed", label: "Indeed" },
    ],
  };

  function handleMarketChange(m: "us" | "india") {
    setJobSearchMarket(m);
    setSelectedSources(MARKET_SOURCES[m].map((s) => s.id));
  }

  function toggleSource(id: string) {
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function openSavedJobsModal() {
    setSavedJobsModalOpen(true);
    setSavedJobsLoading(true);
    setSavedJobsError(undefined);
    try {
      const res = await fetch(`${API_BASE}/api/jobs/saved?limit=200`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || data?.detail || "Failed to load saved jobs.");
      }
      const jobs = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data?.results) ? data.results : [];
      setSavedJobsFromDb(jobs);
      setSelectedSavedJobKeys([]);
    } catch (e: any) {
      setSavedJobsFromDb([]);
      setSelectedSavedJobKeys([]);
      setSavedJobsError(e.message || "Failed to load saved jobs.");
    } finally {
      setSavedJobsLoading(false);
    }
  }

  function toggleSavedJobSelection(jobKey: string) {
    setSelectedSavedJobKeys((prev) =>
      prev.includes(jobKey) ? prev.filter((key) => key !== jobKey) : [...prev, jobKey]
    );
  }

  function confirmSavedJobsSelection() {
    const selectedSet = new Set(selectedSavedJobKeys);
    const jobs = savedJobsFromDb.filter((job, index) => {
      const jobKey = String(job.job_key || job.url || job.listing_url || `${job.source}-${job.id || index}`);
      return selectedSet.has(jobKey);
    });
    setStep(1, { input: JSON.stringify({ jobs }, null, 2) });
    setSavedJobsModalOpen(false);
  }

  // Extra input for step 3
  const [apolloCompanyDomain, setApolloCompanyDomain] = useState("");
  const [apolloRole, setApolloRole] = useState("");

  // Step 3 — company search progress animation
  const [step3Progress, setStep3Progress] = useState<{ index: number; companies: string[] } | null>(null);

  useEffect(() => {
    if (steps[2].status !== "running") {
      setStep3Progress(null);
      return;
    }
    const parsed = parseJsonInput(steps[2].input);
    const companies: string[] = (parsed?.companies ?? []).map(
      (c: any) => c.company_name || c.company_domain || "Unknown"
    );
    if (!companies.length) return;
    setStep3Progress({ index: 0, companies });
    const interval = setInterval(() => {
      setStep3Progress((prev) => {
        if (!prev) return null;
        const next = prev.index + 1;
        return next >= prev.companies.length ? prev : { ...prev, index: next };
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [steps[2].status]);

  // Extra input for step 6 campaign id
  const [campaignId, setCampaignId] = useState("");

  // Session log + tab state
  const [sessionLogs, setSessionLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"steps" | "logs">("steps");
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessionLogs]);

  const setStep = useCallback((index: number, patch: Partial<StepState>) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }, []);

  const updateInput = (index: number) => (value: string) => {
    setStep(index, { input: value });
  };

  function appendLog(entry: LogEntry) {
    setSessionLogs((prev) => [...prev, entry]);
  }

  async function runStep(stepIndex: number, endpoint: string, buildBody: () => any) {
    const body = buildBody();
    const stepName = STEP_NAMES[stepIndex];
    const now = () => new Date().toLocaleTimeString();

    if (!body) {
      setStep(stepIndex, { status: "error", error: "Invalid JSON input" });
      appendLog({ time: now(), step: stepIndex + 1, stepName, type: "error", detail: "Invalid JSON input — step not started" });
      return;
    }
    setStep(stepIndex, { status: "running", error: undefined });
    appendLog({ time: now(), step: stepIndex + 1, stepName, type: "start", detail: `POST ${endpoint}` });
    const t0 = Date.now();
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = typeof data?.detail === "string"
          ? data.detail
          : data?.detail
            ? JSON.stringify(data.detail, null, 2)
            : JSON.stringify(data);
        throw new Error(detail);
      }
      const elapsed = Date.now() - t0;
      setStep(stepIndex, {
        status: "done",
        output: data,
        elapsed,
        cost: data.estimated_cost_usd,
        tokens: data.tokens_used?.prompt !== undefined
          ? { prompt: data.tokens_used.prompt, completion: data.tokens_used.completion }
          : undefined,
      });
      const summary = [
        data.estimated_cost_usd !== undefined ? `cost: $${data.estimated_cost_usd.toFixed(5)}` : null,
        data.tokens_used ? `tokens: ${(data.tokens_used.prompt || 0) + (data.tokens_used.completion || 0)}` : null,
        data.jobs ? `jobs: ${Array.isArray(data.jobs) ? data.jobs.length : data.jobs}` : null,
        data.collected_count != null ? `fetched: ${data.collected_count}` : null,
        data.companies ? `companies: ${Array.isArray(data.companies) ? data.companies.length : data.companies}` : null,
        data.results ? `results: ${Array.isArray(data.results) ? data.results.length : data.results}` : null,
        data.leads ? `leads: ${Array.isArray(data.leads) ? data.leads.length : data.leads}` : null,
      ].filter(Boolean).join(", ");
      appendLog({ time: now(), step: stepIndex + 1, stepName, type: "done", elapsed, detail: summary || "OK" });

      // Append per-actor debug_log entries from job search responses
      if (Array.isArray(data.debug_log)) {
        for (const entry of data.debug_log) {
          const src = entry.source || entry.actor || "actor";
          const status = entry.status || "unknown";
          const count = entry.count != null ? ` · ${entry.count} jobs` : "";
          const err = entry.error ? ` · error: ${entry.error}` : "";
          const secs = entry.elapsed_s != null ? ` (${Number(entry.elapsed_s).toFixed(1)}s)` : "";
          appendLog({
            time: now(),
            step: stepIndex + 1,
            stepName: src,
            type: status === "ok" || status === "success" ? "done" : status === "error" ? "error" : "start",
            detail: `${status}${count}${err}${secs}`,
          });
        }
      }
    } catch (e: any) {
      const elapsed = Date.now() - t0;
      setStep(stepIndex, { status: "error", error: e.message, elapsed });
      appendLog({ time: now(), step: stepIndex + 1, stepName, type: "error", elapsed, detail: e.message });
    }
  }

  function carryTo(targetStep: number, value: string) {
    setStep(targetStep, { input: value });
    // Scroll to the target card
    document.getElementById(`step-${targetStep + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Step runners ──

  function runStep1() {
    if (selectedSources.length === 0) {
      setStep(0, { status: "error", error: "Select at least one job source before running." });
      return;
    }
    return runStep(0, "/api/jobs", () => ({
      role: jobSearchRole,
      location: jobSearchLocation,
      market: jobSearchMarket,
      date_filter: jobSearchDateFilter,
      job_type: jobSearchType,
      max_jobs: jobSearchLimit,
      sources: selectedSources,
    }));
  }

  function runStep2() {
    return runStep(1, "/api/test/extract-companies", () => {
      const parsed = parseJsonInput(steps[1].input);
      if (parsed) return parsed;
      // Try to auto-wrap as jobs array
      return null;
    });
  }

  function runStep3() {
    return runStep(2, "/api/apollo/leads", () => {
      const parsed = parseJsonInput(steps[2].input);
      if (parsed) return parsed;
      if (apolloCompanyDomain) {
        return {
          companies: [{ company_domain: apolloCompanyDomain, company_name: "" }],
          role: apolloRole || jobSearchRole,
          return_all_people: true,
        };
      }
      return null;
    });
  }

  function runStep4() {
    return runStep(3, "/api/test/icp-select", () => {
      const parsed = parseJsonInput(steps[3].input);
      return parsed || null;
    });
  }

  function runStep5() {
    return runStep(4, "/api/test/enrich-contacts", () => {
      const parsed = parseJsonInput(steps[4].input);
      return parsed || null;
    });
  }

  function runStep6() {
    return runStep(5, "/api/test/generate-email", () => {
      const parsed = parseJsonInput(steps[5].input);
      return parsed || null;
    });
  }

  function runStep7() {
    return runStep(6, "/api/test/instantly-send", () => {
      const base = parseJsonInput(steps[6].input) || {};
      if (campaignId) base.campaign_id = campaignId;
      return Object.keys(base).length ? base : null;
    });
  }

  // ── Carry transforms ──

  function jobsToExtractInput(output: any): string {
    const jobs = output?.jobs || output?.results || [];
    return JSON.stringify({ jobs }, null, 2);
  }

  function companiesToApolloInput(output: any): string {
    const companies = output?.companies || [];
    return JSON.stringify(
      { companies: companies.slice(0, 25), role: jobSearchRole, return_all_people: true },
      null,
      2
    );
  }

  function apolloToIcpInput(output: any): string {
    const leads = output?.people ?? output?.results?.people ?? output?.results ?? output?.leads ?? output?.contacts ?? [];
    const role = jobSearchRole;
    const resolvedCompanies = output?.resolved_companies ?? output?.results?.resolved_companies ?? [];
    const company =
      resolvedCompanies[0]?.company_name || output?.companies?.[0]?.company_name || output?.company_name || "";
    return JSON.stringify({ people: leads, role, company_name: company }, null, 2);
  }

  function icpToEnrichInput(output: any): string {
    // Look up full Apollo person records for the top_3 using their 1-based index
    const top3 = output?.top_3 ?? [];
    const allPeople: any[] = steps[2].output?.people ?? steps[2].output?.results?.people ?? [];
    const selected = top3
      .map((p: any) => allPeople[p.index - 1])
      .filter(Boolean);
    return JSON.stringify({ people: selected }, null, 2);
  }

  function enrichToEmailInput(output: any): string {
    const contacts: any[] = output?.contacts ?? [];
    const contact = contacts[0] ?? {};
    const job = steps[0].output?.jobs?.[0] || steps[0].output?.results?.[0] || {};
    return JSON.stringify({ job, contact }, null, 2);
  }

  function emailToInstantlyInput(output: any): string {
    const payload = output?.instantly_payload || output;
    return JSON.stringify(
      { leads: [payload], campaign_id: campaignId || "" },
      null,
      2
    );
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Page header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-gray-900">Test Console</h1>
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">DEV</span>
          </div>
          <p className="text-sm text-gray-500">
            Test each pipeline stage independently. Output from one step can be carried into the next.
          </p>
        </div>

        <SessionBar steps={steps} />

        {/* Tab switcher */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm mb-5">
          {(["steps", "logs"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab
                  ? "bg-brand-primary text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {tab === "steps" ? "Steps" : `Logs${sessionLogs.length > 0 ? ` (${sessionLogs.length})` : ""}`}
            </button>
          ))}
        </div>

        {/* Logs tab */}
        {activeTab === "logs" && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Session Log</h3>
              <div className="flex items-center gap-3">
                {sessionLogs.length > 0 && (
                  <button
                    onClick={() => navigator.clipboard.writeText(
                      sessionLogs.map((e) => {
                        const icon = e.type === "done" ? "✓" : e.type === "error" ? "✗" : "→";
                        const elapsed = e.elapsed !== undefined ? ` (${(e.elapsed / 1000).toFixed(1)}s)` : "";
                        return `[${e.time}]  ${icon}  Step ${e.step} ${e.stepName}${elapsed}: ${e.detail}`;
                      }).join("\n")
                    )}
                    className="text-xs text-gray-400 hover:text-brand-primary transition-colors"
                  >
                    Copy all
                  </button>
                )}
                {sessionLogs.length > 0 && (
                  <button
                    onClick={() => setSessionLogs([])}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            {sessionLogs.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-gray-400">
                No log entries yet. Run a step to see activity here.
              </div>
            ) : (
              <div className="px-5 py-4 max-h-[560px] overflow-auto font-mono text-xs bg-slate-950 space-y-1.5">
                {sessionLogs.map((entry, i) => {
                  const icon = entry.type === "done" ? "✓" : entry.type === "error" ? "✗" : "→";
                  const color = entry.type === "done" ? "text-green-400" : entry.type === "error" ? "text-red-400" : "text-amber-400";
                  const elapsed = entry.elapsed !== undefined ? ` (${(entry.elapsed / 1000).toFixed(1)}s)` : "";
                  return (
                    <div key={i} className="flex gap-3 leading-relaxed">
                      <span className="text-slate-500 shrink-0">[{entry.time}]</span>
                      <span className={`${color} shrink-0`}>{icon}</span>
                      <span className="text-slate-300 shrink-0">Step {entry.step} <span className="text-slate-400">{entry.stepName}</span>{elapsed}</span>
                      <span className="text-slate-500">{entry.detail}</span>
                    </div>
                  );
                })}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        )}

        {activeTab === "steps" && <div className="space-y-5">
          {/* Step 1 — Job Search */}
          <div id="step-1">
            <StepCard
              step={1}
              title="Job Search"
              description="Scrape job listings from Apify actors (Ashby / Greenhouse / Lever / LinkedIn / Naukri / Indeed)"
              cost="~$0.50–2.00 per run"
              endpoint="/api/jobs"
              inputPlaceholder={"// Configured via the controls below — no manual JSON needed"}
              state={steps[0]}
              onRun={(_input) => runStep1() ?? Promise.resolve()}
              onInputChange={updateInput(0)}
              carryOptions={[{ label: "Step 2 (Extract)", targetStep: 1, transform: jobsToExtractInput }]}
              onCarry={carryTo}
              renderOutput={(output) => <JobsTable data={output} />}
              extraControls={
                <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs">
                  <div>
                    <label className="text-gray-500 font-medium block mb-1">Role / keyword</label>
                    <input
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-primary/40"
                      value={jobSearchRole}
                      onChange={(e) => setJobSearchRole(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-gray-500 font-medium block mb-1">Location</label>
                    <input
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-primary/40"
                      value={jobSearchLocation}
                      onChange={(e) => setJobSearchLocation(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-gray-500 font-medium block mb-1">Market</label>
                    <select
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none"
                      value={jobSearchMarket}
                      onChange={(e) => handleMarketChange(e.target.value as "us" | "india")}
                    >
                      <option value="us">US (Ashby, Greenhouse, Lever)</option>
                      <option value="india">India (LinkedIn, Naukri, Indeed)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-500 font-medium block mb-1">Date filter</label>
                    <select
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none"
                      value={jobSearchDateFilter}
                      onChange={(e) => setJobSearchDateFilter(e.target.value as "24h" | "7d" | "30d")}
                    >
                      <option value="24h">Past 24 hours</option>
                      <option value="7d">Past week</option>
                      <option value="30d">Past month</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-500 font-medium block mb-1">Job type</label>
                    <select
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none"
                      value={jobSearchType}
                      onChange={(e) => setJobSearchType(e.target.value as "all" | "full_time" | "contract")}
                    >
                      <option value="all">All</option>
                      <option value="full_time">Full-time</option>
                      <option value="contract">Contract</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-500 font-medium block mb-1">Max results</label>
                    <input
                      type="number"
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none"
                      value={jobSearchLimit}
                      onChange={(e) => setJobSearchLimit(Number(e.target.value))}
                      min={5}
                      max={500}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-gray-500 font-medium block mb-1.5">Active actors</label>
                    <div className="flex gap-2">
                      {MARKET_SOURCES[jobSearchMarket].map((src) => {
                        const active = selectedSources.includes(src.id);
                        return (
                          <button
                            key={src.id}
                            type="button"
                            onClick={() => toggleSource(src.id)}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                              active
                                ? "bg-brand-primary text-white border-brand-primary"
                                : "bg-white text-gray-400 border-gray-200 line-through"
                            }`}
                          >
                            {src.label}
                          </button>
                        );
                      })}
                    </div>
                    {selectedSources.length === 0 && (
                      <p className="text-[11px] text-red-500 mt-1">Select at least one actor.</p>
                    )}
                    <p className="text-[11px] text-gray-400 mt-1">
                      LinkedIn uses `publishedAt` (`r86400` / `r604800`) and `contractType` (`F` / `C`) when applicable.
                    </p>
                  </div>
                </div>
              }
            />
          </div>

          {/* Step 2 — Extract Companies */}
          <div id="step-2">
            <StepCard
              step={2}
              title="Extract Companies"
              description="Deduplicate jobs into unique company targets. Paste JSON from Step 1 or load from the DB."
              cost="Free (local)"
              endpoint="/api/test/extract-companies"
              inputPlaceholder={'{"jobs": [...]}'}
              state={steps[1]}
              onRun={runStep2}
              onInputChange={updateInput(1)}
              carryOptions={[{ label: "Step 3 (Apollo)", targetStep: 2, transform: companiesToApolloInput }]}
              onCarry={carryTo}
              renderOutput={(output) => (
                <ExtractCompaniesOutput
                  data={output}
                  onGenerateStep3={() => carryTo(2, companiesToApolloInput(output))}
                />
              )}
              extraControls={
                <button
                  className="text-xs text-brand-primary underline decoration-dashed hover:no-underline"
                  onClick={openSavedJobsModal}
                >
                  Load from DB (saved jobs)
                </button>
              }
            />
          </div>

          {/* Step 3 — Apollo Enrich */}
          <div id="step-3">
            <StepCard
              step={3}
              title="Apollo People Discovery"
              description="Resolve companies in Apollo, then return a broad employee pool for each company. Step 4 does the ICP shortlist."
              cost="~$0.01–0.05 per company"
              endpoint="/api/apollo/leads"
              inputPlaceholder={'{"companies": [{"company_name": "Acme", "company_domain": "acme.com"}], "role": "Software Engineer", "return_all_people": true}'}
              state={steps[2]}
              onRun={runStep3}
              onInputChange={updateInput(2)}
              carryOptions={[{ label: "Step 4 (ICP)", targetStep: 3, transform: apolloToIcpInput }]}
              onCarry={carryTo}
              renderOutput={(output) => (
                <ApolloDiscoveryOutput
                  data={output}
                  onGenerateStep4={() => carryTo(3, apolloToIcpInput(output))}
                />
              )}
              extraControls={
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs">
                    <div>
                      <label className="text-gray-500 font-medium block mb-1">Quick: company domain</label>
                      <input
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-primary/40"
                        placeholder="acme.com"
                        value={apolloCompanyDomain}
                        onChange={(e) => setApolloCompanyDomain(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-gray-500 font-medium block mb-1">Hiring role</label>
                      <input
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-primary/40"
                        placeholder="e.g. Software Engineer"
                        value={apolloRole}
                        onChange={(e) => setApolloRole(e.target.value)}
                      />
                    </div>
                  </div>
                  {step3Progress && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">Searching Apollo…</span>
                        <span className="text-blue-500">{step3Progress.index + 1} / {step3Progress.companies.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {step3Progress.companies.map((name, i) => (
                          <span
                            key={i}
                            className={`px-2 py-0.5 rounded-full border text-xs font-medium transition-colors ${
                              i < step3Progress.index
                                ? "bg-blue-100 border-blue-300 text-blue-600 line-through opacity-50"
                                : i === step3Progress.index
                                ? "bg-blue-600 border-blue-600 text-white animate-pulse"
                                : "bg-white border-blue-200 text-blue-400"
                            }`}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              }
            />
          </div>

          {/* Step 4 — ICP Selection */}
          <div id="step-4">
            <StepCard
              step={4}
              title="ICP Selection"
              description="Use OpenAI to shortlist the top 3 decision-makers from the people found at a company."
              cost="~$0.002 per company (gpt-4.1-mini)"
              endpoint="/api/test/icp-select"
              inputPlaceholder={'{"people": [...], "role": "Software Engineer", "company_name": "Acme"}'}
              state={steps[3]}
              onRun={runStep4}
              onInputChange={updateInput(3)}
              carryOptions={[{ label: "Step 5 (Enrich)", targetStep: 4, transform: icpToEnrichInput }]}
              onCarry={carryTo}
            />
          </div>

          {/* Step 5 — Enrich Contacts */}
          <div id="step-5">
            <StepCard
              step={5}
              title="Enrich Contacts"
              description="Fetch verified email addresses for the selected ICPs via Apollo bulk match."
              cost="~$0.01–0.05 per contact (Apollo credits)"
              endpoint="/api/test/enrich-contacts"
              inputPlaceholder={'{"people": [...]}'}
              state={steps[4]}
              onRun={runStep5}
              onInputChange={updateInput(4)}
              carryOptions={[{ label: "Step 6 (Email)", targetStep: 5, transform: enrichToEmailInput }]}
              onCarry={carryTo}
            />
          </div>

          {/* Step 6 — Generate Email */}
          <div id="step-6">
            <StepCard
              step={6}
              title="Generate Email"
              description="Generate personalized outreach email for a single job + contact pair using OpenAI."
              cost="~$0.001 per email (gpt-4.1-mini)"
              endpoint="/api/test/generate-email"
              inputPlaceholder={'{"job": {"job_title": "...", "company_name": "..."}, "contact": {"name": "...", "title": "...", "email": "..."}}'}
              state={steps[5]}
              onRun={runStep6}
              onInputChange={updateInput(5)}
              carryOptions={[{ label: "Step 7 (Send)", targetStep: 6, transform: emailToInstantlyInput }]}
              onCarry={carryTo}
            />
          </div>

          {/* Step 7 — Instantly Send */}
          <div id="step-7">
            <StepCard
              step={7}
              title="Send to Instantly"
              description="Deliver leads to an Instantly.ai campaign. This step actually sends — use with caution."
              cost="No API cost"
              endpoint="/api/test/instantly-send"
              inputPlaceholder={'{"leads": [...], "campaign_id": "..."}'}
              state={steps[6]}
              onRun={runStep7}
              onInputChange={updateInput(6)}
              warning="This step will actually deliver leads to Instantly.ai. Make sure you are using a test campaign."
              extraControls={
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs">
                  <label className="text-gray-500 font-medium block mb-1">
                    Campaign ID override (leave blank to use .env)
                  </label>
                  <input
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-primary/40 font-mono"
                    placeholder="campaign_xxxxxxxx (optional)"
                    value={campaignId}
                    onChange={(e) => setCampaignId(e.target.value)}
                  />
                </div>
              }
            />
          </div>
        </div>}

        {savedJobsModalOpen && (
          <SavedJobsPickerModal
            jobs={savedJobsFromDb}
            loading={savedJobsLoading}
            error={savedJobsError}
            selectedJobKeys={selectedSavedJobKeys}
            onToggle={toggleSavedJobSelection}
            onClose={() => setSavedJobsModalOpen(false)}
            onConfirm={confirmSavedJobsSelection}
          />
        )}
      </div>
    </div>
  );
}
