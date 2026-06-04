"use client";

import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/utils/apiFetch";

// ── Role options ─────────────────────────────────────────────────────────────
const ROLE_OPTIONS = [
  "Software Engineer",
  "Senior Software Engineer",
  "Backend Engineer",
  "Senior Backend Engineer",
  "Frontend Engineer",
  "Senior Frontend Engineer",
  "Full Stack Engineer",
  "DevOps Engineer",
  "Site Reliability Engineer (SRE)",
  "Data Engineer",
  "Machine Learning Engineer",
  "Cloud Engineer",
  "Mobile Engineer",
  "iOS Engineer",
  "Android Engineer",
  "Engineering Manager",
  "Technical Lead",
  "Head of Engineering",
  "Product Manager",
  "QA Engineer",
];

// ── Location options per market ───────────────────────────────────────────────
const US_LOCATIONS = [
  "United States",
  "New York, NY",
  "San Francisco, CA",
  "Los Angeles, CA",
  "Chicago, IL",
  "Seattle, WA",
  "Austin, TX",
  "Boston, MA",
  "Denver, CO",
  "Atlanta, GA",
  "Miami, FL",
  "Dallas, TX",
  "Washington, DC",
  "San Jose, CA",
  "Portland, OR",
  "Remote",
];

const INDIA_LOCATIONS = [
  "India",
  "Bangalore",
  "Mumbai",
  "Delhi",
  "Hyderabad",
  "Pune",
  "Chennai",
  "Kolkata",
  "Noida",
  "Gurgaon",
  "Ahmedabad",
  "Remote",
];

// ── Cost reference data ─────────────────────────────────────────────────────
const ACTOR_COSTS = {
  us: {
    greenhouse: { label: "Greenhouse", costPer1k: 1.2, baseTip: "$1.20 / 1K jobs", minJobs: "min 200/run", jobTypeNote: "post-fetch filter" },
    ashby:      { label: "Ashby",      costPer1k: 2.0, baseTip: "$2.00 / 1K jobs", minJobs: "min 200/run", jobTypeNote: "post-fetch filter" },
    lever:      { label: "Lever",      costPer1k: 0.1, baseTip: "$0.10 / 1K jobs", minJobs: "max 100/run", jobTypeNote: "post-fetch filter" },
  },
  india: {
    linkedin: { label: "LinkedIn", costPer1k: null, flatNote: "$29.99/mo + CU usage", baseTip: "Flat $29.99/mo subscription + Apify compute units (~$0.025/run). Rental model retires Oct 2026.", minJobs: "up to 1,000/run", jobTypeNote: "API filter (full-time, part-time, contract, internship) · remote/hybrid post-fetch" },
    naukri:   { label: "Naukri",   costPer1k: 5.0,  baseTip: "$5.00 / 1K jobs", minJobs: "min 50/run",   jobTypeNote: "post-fetch filter" },
  },
} as const;

type Market = "us" | "india";
type StageStatus = "waiting" | "in_progress" | "done" | "error" | "skipped";

interface StageEvent {
  status: StageStatus;
  message: string;
  counts?: Record<string, number>;
  timestamp: number;
}

interface StageState {
  status: StageStatus;
  message: string;
  counts?: Record<string, number>;
  events: StageEvent[];
}

const STAGE_LABELS: Record<string, string> = {
  job_search: "Job Search",
  company_extraction: "Company Extraction",
  people_discovery: "People Discovery",
  icp_selection: "ICP Selection",
  email_enrichment: "Email Enrichment",
  email_generation: "Email Generation",
  instantly_send: "Send to Instantly",
};

function StatusDot({ status }: { status: StageStatus }) {
  const colors: Record<StageStatus, string> = {
    waiting: "bg-status-neutral",
    in_progress: "bg-status-warning animate-pulse",
    done: "bg-status-success",
    error: "bg-status-error",
    skipped: "bg-status-neutral opacity-50",
  };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${colors[status]}`} />;
}

function StatusBadge({ status }: { status: StageStatus }) {
  const styles: Record<StageStatus, string> = {
    waiting: "text-slate-400 text-xs",
    in_progress: "text-amber-600 text-xs font-medium",
    done: "text-green-600 text-xs font-medium",
    error: "text-red-600 text-xs font-medium",
    skipped: "text-slate-400 text-xs",
  };
  const labels: Record<StageStatus, string> = {
    waiting: "WAITING",
    in_progress: "IN PROGRESS",
    done: "DONE",
    error: "ERROR",
    skipped: "SKIPPED",
  };
  return <span className={styles[status]}>{labels[status]}</span>;
}

export default function PipelinePage() {
  const [market, setMarket] = useState<Market>("us");
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [dateFilter, setDateFilter] = useState<"7d" | "30d">("7d");
  const [jobType, setJobType] = useState("all");
  const [selectedSources, setSelectedSources] = useState<string[]>(["greenhouse", "ashby", "lever"]);
  const [maxCompanies, setMaxCompanies] = useState(100);
  const [autoSend, setAutoSend] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [customRole, setCustomRole] = useState("");
  const [moreRunsPrompt, setMoreRunsPrompt] = useState<{ emailsGenerated: number } | null>(null);

  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [stages, setStages] = useState<Record<string, StageState>>({});
  const [pipelineStatus, setPipelineStatus] = useState<string>("idle");
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [outreachResults, setOutreachResults] = useState<any[]>([]);
  const [companyDetails, setCompanyDetails] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"progress" | "companies" | "logs">("progress");
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [companySubTab, setCompanySubTab] = useState<Record<string, "people" | "icps" | "emails">>({});

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Resume active run after tab switch
  useEffect(() => {
    const savedId = sessionStorage.getItem("pipeline_run_id");
    if (!savedId) return;
    setRunId(savedId);
    setRunning(true);
    setPipelineStatus("running");

    async function resumePoll() {
      const statusRes = await apiFetch(`/api/pipeline/status/${savedId}`).catch(() => null);
      if (!statusRes?.ok) return;
      const status = await statusRes.json();
      const stageMap: Record<string, StageState> = {};
      for (const event of status.events || []) {
        const s: StageStatus = event.status === "done" ? "done" : event.status === "error" ? "error" : event.status === "skipped" ? "skipped" : event.status === "in_progress" ? "in_progress" : "waiting";
        if (!stageMap[event.stage]) {
          stageMap[event.stage] = { status: s, message: event.message, counts: event.counts, events: [] };
        } else {
          stageMap[event.stage].status = s;
          stageMap[event.stage].message = event.message;
          if (event.counts) stageMap[event.stage].counts = event.counts;
        }
        stageMap[event.stage].events.push({ status: s, message: event.message, counts: event.counts, timestamp: event.timestamp });
      }
      setStages(stageMap);
      if (status.company_details) setCompanyDetails(status.company_details);
      if (status.status === "completed" || status.status === "failed") {
        setPipelineStatus(status.status);
        setSummary(status.summary || null);
        setOutreachResults(status.outreach_results || []);
        setCompanyDetails(status.company_details || []);
        setRunning(false);
        sessionStorage.removeItem("pipeline_run_id");
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }

    resumePoll();
    pollRef.current = setInterval(resumePoll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Update sources and reset location when market changes
  useEffect(() => {
    if (market === "us") {
      setSelectedSources(["greenhouse", "ashby", "lever"]);
    } else {
      setSelectedSources(["linkedin", "naukri"]);
    }
    setLocation("");
    setMoreRunsPrompt(null);
  }, [market]);

  // Scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const availableSources = market === "us" ? ACTOR_COSTS.us : ACTOR_COSTS.india;

  function toggleSource(source: string) {
    setSelectedSources((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]
    );
  }

  // India: 100 jobs total split equally across selected actors.
  // US: keep the existing formula.
  const INDIA_INITIAL_JOBS = 100;
  const TARGET_EMAILS = 250;
  const jobsPerActor = market === "india"
    ? Math.ceil(INDIA_INITIAL_JOBS / Math.max(1, selectedSources.length))
    : Math.max(200, maxCompanies * 4);

  function estimateCost() {
    let total = 0;
    let hasFlat = false;
    // For India, estimate up to 4 top-up fetches (100 + 4×50 = 300 jobs total)
    const estimatedTotalJobs = market === "india"
      ? Math.ceil(300 / Math.max(1, selectedSources.length))
      : jobsPerActor;
    for (const source of selectedSources) {
      const info = (availableSources as any)[source];
      if (!info) continue;
      if (info.costPer1k != null) {
        total += (estimatedTotalJobs / 1000) * info.costPer1k;
      } else {
        hasFlat = true;
      }
    }
    // India: ~100 companies × 3 ICPs × $0.05; US: max_companies × 5 ICPs × $0.05
    const estimatedCompanies = market === "india" ? Math.ceil(TARGET_EMAILS / 3) : maxCompanies;
    const apolloCost = (estimatedCompanies * 3 * 0.05).toFixed(2);
    return { variable: total.toFixed(2), apollo: apolloCost, hasFlat };
  }

  const resolvedRole = role === "__custom__" ? customRole.trim() : role.trim();

  async function startPipeline() {
    if (!resolvedRole || !location.trim()) return;
    setMoreRunsPrompt(null);
    setRunning(true);
    setRunId(null);
    setStages({});
    setSummary(null);
    setLogs([]);
    setOutreachResults([]);
    setCompanyDetails([]);
    setExpandedCompany(null);
    setCompanySubTab({});
    setPipelineStatus("starting");
    setActiveTab("progress");

    const res = await apiFetch("/api/pipeline/run", {
      method: "POST",
      body: JSON.stringify({
        role: resolvedRole,
        location: location.trim(),
        date_filter: dateFilter,
        job_type: jobType,
        market,
        sources: selectedSources,
        auto_icp: true,
        auto_email: true,
        auto_send: autoSend,
        test_mode: testMode,
        max_companies: maxCompanies,
        max_icps_per_company: 3,
        campaign_id: null,
        ...(market === "india" && { target_emails: TARGET_EMAILS }),
      }),
    }).catch(() => null);

    if (!res?.ok) {
      setPipelineStatus("error");
      setRunning(false);
      return;
    }

    const data = await res.json();
    const id = data.run_id as string;
    setRunId(id);
    setPipelineStatus("running");
    sessionStorage.setItem("pipeline_run_id", id);

    async function pollOnce() {
      const statusRes = await apiFetch(`/api/pipeline/status/${id}`).catch(() => null);
      if (!statusRes?.ok) return;
      const status = await statusRes.json();

      // Rebuild stage state from events — accumulate all events per stage
      const stageMap: Record<string, StageState> = {};
      for (const event of status.events || []) {
        const s: StageStatus = event.status === "done" ? "done" : event.status === "error" ? "error" : event.status === "skipped" ? "skipped" : event.status === "in_progress" ? "in_progress" : "waiting";
        if (!stageMap[event.stage]) {
          stageMap[event.stage] = { status: s, message: event.message, counts: event.counts, events: [] };
        } else {
          stageMap[event.stage].status = s;
          stageMap[event.stage].message = event.message;
          if (event.counts) stageMap[event.stage].counts = event.counts;
        }
        stageMap[event.stage].events.push({ status: s, message: event.message, counts: event.counts, timestamp: event.timestamp });
      }
      setStages(stageMap);

      // Build log from events
      const newLogs = (status.events || []).map((e: any) => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        const stageName = STAGE_LABELS[e.stage] || e.stage;
        const countsStr = e.counts && Object.keys(e.counts).length > 0
          ? "  [" + Object.entries(e.counts).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(", ") + "]"
          : "";
        const icon = e.status === "done" ? "✓" : e.status === "error" ? "✗" : e.status === "in_progress" ? "→" : e.status === "skipped" ? "–" : "·";
        return `[${time}]  ${icon}  ${stageName}: ${e.message}${countsStr}`;
      });
      setLogs(newLogs);

      if (status.company_details) setCompanyDetails(status.company_details);

      if (status.status === "completed" || status.status === "failed") {
        setPipelineStatus(status.status);
        setSummary(status.summary || null);
        setOutreachResults(status.outreach_results || []);
        setCompanyDetails(status.company_details || []);
        setRunning(false);
        sessionStorage.removeItem("pipeline_run_id");
        if (pollRef.current) clearInterval(pollRef.current);
        // For India market: prompt user before running another batch instead of auto top-up
        if (market === "india" && status.status === "completed") {
          const emailCount = (status.outreach_results || []).length;
          if (emailCount < TARGET_EMAILS) {
            setMoreRunsPrompt({ emailsGenerated: emailCount });
          }
        }
      }
    }

    // Poll immediately, then every 2s
    pollOnce();
    pollRef.current = setInterval(pollOnce, 2000);
  }

  function abortPipeline() {
    if (pollRef.current) clearInterval(pollRef.current);
    setRunning(false);
    setPipelineStatus("aborted");
    sessionStorage.removeItem("pipeline_run_id");
  }

  const cost = estimateCost();
  const allStageKeys = ["job_search", "company_extraction", "people_discovery", "icp_selection", "email_enrichment", "email_generation", "instantly_send"];

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-brand-secondary">Demand Generation Pipeline</h1>
          <p className="text-slate-500 text-sm mt-1">
            One-click: job signals → ICP enrichment → personalised outreach → Instantly
          </p>
        </div>

        {/* Run Form */}
        {!running && pipelineStatus === "idle" && (
          <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
            {/* Market + Inputs */}
            <div className="px-6 py-5 border-b border-brand-border">
              <div className="grid grid-cols-2 gap-4 mb-4">
                {/* Market */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Market</label>
                  <div className="flex gap-2">
                    {(["us", "india"] as Market[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMarket(m)}
                        className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                          market === m
                            ? "bg-brand-primary text-white border-brand-primary"
                            : "bg-white text-slate-600 border-brand-border hover:border-brand-primary"
                        }`}
                      >
                        {m === "us" ? "🇺🇸 United States" : "🇮🇳 India"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date Range */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Date Range</label>
                  <div className="flex gap-2">
                    {(["7d", "30d"] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDateFilter(d)}
                        className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                          dateFilter === d
                            ? "bg-brand-primary text-white border-brand-primary"
                            : "bg-white text-slate-600 border-brand-border hover:border-brand-primary"
                        }`}
                      >
                        {d === "7d" ? "Last 7 days" : "Last 30 days"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Role / Job Title</label>
                  <select
                    value={role}
                    onChange={(e) => { setRole(e.target.value); if (e.target.value !== "__custom__") setCustomRole(""); }}
                    className="w-full px-3 py-2.5 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white"
                  >
                    <option value="">Select a role…</option>
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                    <option value="__custom__">Other (type below)</option>
                  </select>
                  {role === "__custom__" && (
                    <input
                      type="text"
                      value={customRole}
                      onChange={(e) => setCustomRole(e.target.value)}
                      placeholder="Enter custom role…"
                      className="w-full mt-2 px-3 py-2.5 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Location</label>
                  <select
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full px-3 py-2.5 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white"
                  >
                    <option value="">Select a location…</option>
                    {(market === "us" ? US_LOCATIONS : INDIA_LOCATIONS).map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Job Type</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "all", label: "All Types" },
                    { value: "full_time", label: "Full-time" },
                    { value: "part_time", label: "Part-time" },
                    { value: "contract", label: "Contract" },
                    { value: "internship", label: "Internship" },
                    { value: "remote", label: "Remote" },
                    { value: "hybrid", label: "Hybrid" },
                    { value: "onsite", label: "On-site" },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setJobType(value)}
                      className={`py-1.5 px-3 rounded-lg border text-sm font-medium transition-all ${
                        jobType === value
                          ? "bg-brand-primary text-white border-brand-primary"
                          : "bg-white text-slate-600 border-brand-border hover:border-brand-primary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sources */}
            <div className="px-6 py-5 border-b border-brand-border">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Job Sources</label>
              <div className="space-y-2.5">
                {Object.entries(availableSources).map(([key, info]) => {
                  const actorJobs = key === "lever" ? 100 : jobsPerActor;
                  const actorLabel = market === "india"
                    ? `~${actorJobs} jobs (initial)`
                    : `~${actorJobs.toLocaleString()} jobs`;
                  const infoTyped = info as typeof info & { minJobs: string; jobTypeNote: string };
                  return (
                    <label key={key} className="flex items-start gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={selectedSources.includes(key)}
                        onChange={() => toggleSource(key)}
                        className="w-4 h-4 mt-0.5 rounded border-slate-300 text-brand-primary focus:ring-brand-primary flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-700 group-hover:text-brand-primary transition-colors">
                            {info.label}
                          </span>
                          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-medium">
                            {infoTyped.minJobs}
                          </span>
                          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 font-medium">
                            {actorLabel}
                          </span>
                          <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                            {info.costPer1k != null ? `$${info.costPer1k}/1K` : (info as any).flatNote}
                          </span>
                          <span className="text-xs text-slate-400" title={info.baseTip}>ⓘ</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400">{infoTyped.jobTypeNote}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Advanced + Cost Estimate */}
            <div className="px-6 py-5 border-b border-brand-border bg-slate-50">
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Estimated Run Cost</label>
              </div>
              <div className="space-y-1.5 text-sm">
                {Object.entries(availableSources)
                  .filter(([key]) => selectedSources.includes(key))
                  .map(([key, info]) => {
                    // For India cost display use max possible (100 + 4×50 = 300 total / n_actors)
                    const maxPerActor = market === "india"
                      ? Math.ceil(300 / Math.max(1, selectedSources.length))
                      : (key === "lever" ? 100 : jobsPerActor);
                    return (
                      <div key={key} className="flex justify-between text-slate-600">
                        <span>
                          {info.label}{" "}
                          <span className="text-slate-400 text-xs">
                            ({market === "india" ? `up to ${maxPerActor} jobs` : `${maxPerActor.toLocaleString()} jobs`})
                          </span>
                        </span>
                        <span className="font-medium">
                          {info.costPer1k != null
                            ? `~$${((maxPerActor / 1000) * info.costPer1k).toFixed(2)}`
                            : (info as any).flatNote}
                        </span>
                      </div>
                    );
                  })}
                <div className="flex justify-between text-slate-600">
                  <span>Apollo (ICP enrichment)</span>
                  <span className="font-medium">~${cost.apollo}</span>
                </div>
                <div className="pt-1.5 mt-1.5 border-t border-slate-200 flex justify-between font-semibold text-brand-secondary">
                  <span>Total estimate</span>
                  <span>~${(parseFloat(cost.variable) + parseFloat(cost.apollo)).toFixed(2)}{cost.hasFlat ? " + flat fees" : ""}</span>
                </div>
              </div>
            </div>

            {/* Pipeline options + Start */}
            <div className="px-6 py-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  {market === "india" ? (
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Daily Email Target</label>
                      <div className="px-3 py-2 border border-brand-border rounded-lg text-sm bg-slate-50 text-brand-secondary font-semibold">
                        {TARGET_EMAILS} emails / day
                      </div>
                      <p className="mt-1.5 text-xs text-slate-400">
                        Fetches {INDIA_INITIAL_JOBS} jobs split across {selectedSources.length} actor{selectedSources.length !== 1 ? "s" : ""}
                        {" "}(~{jobsPerActor}/each), tops up in batches of 50 until {TARGET_EMAILS} emails are ready
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Max Companies</label>
                      <select
                        value={maxCompanies}
                        onChange={(e) => setMaxCompanies(Number(e.target.value))}
                        className="px-3 py-2 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
                      >
                        {[20, 50, 100, 150, 200].map((n) => (
                          <option key={n} value={n}>{n} companies</option>
                        ))}
                      </select>
                      <p className="mt-1.5 text-xs text-slate-400">
                        Fetches ~{jobsPerActor.toLocaleString()} jobs/source · formula: max(200, companies × 4)
                      </p>
                    </div>
                  )}
                  <div className="flex flex-col gap-2.5 mt-4">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoSend}
                        onChange={(e) => setAutoSend(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary"
                      />
                      <span className="text-sm text-slate-600">Auto-send to Instantly</span>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={testMode}
                        onChange={(e) => setTestMode(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
                      />
                      <span className="text-sm text-slate-600 group-hover:text-amber-700 transition-colors">
                        Test mode
                      </span>
                      {testMode && (
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-600 leading-none">
                          1 company · 3 ICPs
                        </span>
                      )}
                    </label>
                  </div>
                </div>
                <button
                  onClick={startPipeline}
                  disabled={!resolvedRole || !location.trim() || selectedSources.length === 0}
                  className="flex items-center gap-2 px-6 py-2.5 bg-brand-primary text-white rounded-lg text-sm font-semibold hover:bg-blue-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Start Pipeline
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Live Pipeline Progress */}
        {(running || pipelineStatus === "completed" || pipelineStatus === "failed" || pipelineStatus === "aborted") && (
          <div className="space-y-4">
            {/* Header bar */}
            <div className="bg-white border border-brand-border rounded-xl px-6 py-4 flex items-center justify-between shadow-sm">
              <div>
                <h2 className="text-sm font-semibold text-brand-secondary flex items-center gap-2">
                  Pipeline Run · {resolvedRole} · {location} · {market.toUpperCase()}
                  {testMode && (
                    <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-600 leading-none">
                      TEST
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {pipelineStatus === "running" ? "Running..." : pipelineStatus === "completed" ? "Completed" : pipelineStatus === "failed" ? "Failed" : "Aborted"}
                </p>
              </div>
              <div className="flex gap-2">
                {running && (
                  <button
                    onClick={abortPipeline}
                    className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    Abort
                  </button>
                )}
                {!running && (
                  <button
                    onClick={() => { setPipelineStatus("idle"); setStages({}); setSummary(null); setLogs([]); setOutreachResults([]); setCompanyDetails([]); setExpandedCompany(null); setCompanySubTab({}); sessionStorage.removeItem("pipeline_run_id"); }}
                    className="px-4 py-2 text-sm font-medium text-brand-primary border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    New Run
                  </button>
                )}
              </div>
            </div>

            {/* More runs prompt — India market only, shown when emails < target */}
            {moreRunsPrompt && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 flex items-center justify-between shadow-sm">
                <div>
                  <p className="text-sm font-semibold text-amber-800">
                    {moreRunsPrompt.emailsGenerated} of {TARGET_EMAILS} emails generated
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    This run is short of the daily target. Would you like to run another batch to top up?
                  </p>
                </div>
                <div className="flex gap-2 ml-4 flex-shrink-0">
                  <button
                    onClick={() => { setMoreRunsPrompt(null); startPipeline(); }}
                    className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
                  >
                    Yes, run another batch
                  </button>
                  <button
                    onClick={() => setMoreRunsPrompt(null)}
                    className="px-4 py-2 text-sm font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors"
                  >
                    No, I&apos;m done
                  </button>
                </div>
              </div>
            )}

            {/* Tab switcher */}
            <div className="flex gap-1 bg-white border border-brand-border rounded-xl p-1 shadow-sm">
              {([
                { id: "progress", label: "Progress" },
                { id: "companies", label: `Companies${companyDetails.length > 0 ? ` (${companyDetails.length})` : ""}` },
                { id: "logs", label: `Logs${logs.length > 0 ? ` (${logs.length})` : ""}` },
              ] as { id: "progress" | "companies" | "logs"; label: string }[]).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === id
                      ? "bg-brand-primary text-white shadow-sm"
                      : "text-slate-500 hover:text-brand-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Progress tab */}
            {activeTab === "progress" && (<>

            {/* Stage timeline */}
            <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
              {allStageKeys.map((key, idx) => {
                const stage = stages[key];
                const status: StageStatus = stage?.status || "waiting";
                const hasEvents = stage?.events && stage.events.length > 0;
                return (
                  <div key={key} className={`px-6 py-4 ${idx < allStageKeys.length - 1 ? "border-b border-brand-border" : ""} ${status === "in_progress" ? "bg-amber-50/40" : status === "done" ? "bg-green-50/30" : status === "error" ? "bg-red-50/30" : ""}`}>
                    {/* Stage header row */}
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 text-xs font-medium w-5 text-right flex-shrink-0">{idx + 1}</span>
                      <StatusDot status={status} />
                      <span className={`text-sm font-semibold flex-1 ${status === "in_progress" ? "text-amber-700" : status === "done" ? "text-green-700" : status === "error" ? "text-red-700" : "text-slate-400"}`}>
                        {STAGE_LABELS[key]}
                      </span>
                      <StatusBadge status={status} />
                    </div>

                    {/* In-progress bar */}
                    {status === "in_progress" && (
                      <div className="mt-2 ml-8 h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-400 rounded-full animate-pulse" style={{ width: "60%" }} />
                      </div>
                    )}

                    {/* Latest message */}
                    {stage?.message && (
                      <p className={`mt-1.5 ml-8 text-xs ${status === "error" ? "text-red-600" : "text-slate-600"}`}>
                        {stage.message}
                      </p>
                    )}

                    {/* Counts */}
                    {stage?.counts && Object.keys(stage.counts).length > 0 && (
                      <div className="mt-1 ml-8 flex flex-wrap gap-x-3 gap-y-0.5">
                        {Object.entries(stage.counts).map(([k, v]) => (
                          <span key={k} className="text-xs text-slate-500">
                            <span className="font-medium text-brand-secondary">{v}</span> {k.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Event history (for stages with multiple events) */}
                    {hasEvents && stage.events.length > 1 && (
                      <div className="mt-2 ml-8 space-y-0.5 border-l-2 border-slate-100 pl-3">
                        {stage.events.map((ev, evIdx) => {
                          const evTime = new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                          const icon = ev.status === "done" ? "✓" : ev.status === "error" ? "✗" : ev.status === "in_progress" ? "→" : "·";
                          const color = ev.status === "done" ? "text-green-600" : ev.status === "error" ? "text-red-500" : ev.status === "in_progress" ? "text-amber-600" : "text-slate-400";
                          return (
                            <div key={evIdx} className="flex items-baseline gap-2">
                              <span className={`text-xs font-mono flex-shrink-0 ${color}`}>{icon}</span>
                              <span className="text-xs text-slate-500 flex-1">{ev.message}</span>
                              {ev.counts && Object.keys(ev.counts).length > 0 && (
                                <span className="text-xs text-slate-400 flex-shrink-0">
                                  [{Object.entries(ev.counts).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(", ")}]
                                </span>
                              )}
                              <span className="text-xs text-slate-300 flex-shrink-0 font-mono">{evTime}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Waiting placeholder */}
                    {status === "waiting" && (
                      <p className="mt-1 ml-8 text-xs text-slate-300 italic">
                        {idx === 0 && running && Object.keys(stages).length === 0
                          ? "Starting pipeline…"
                          : "Waiting for previous step…"}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            {summary && (
              <div className="bg-white border border-brand-border rounded-xl px-6 py-5 shadow-sm">
                <h3 className="text-sm font-semibold text-brand-secondary mb-3">Run Summary</h3>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: "Jobs Found", value: summary.jobs_found },
                    { label: "Companies", value: summary.companies },
                    { label: "ICPs Identified", value: summary.icps },
                    { label: "Emails Generated", value: summary.emails_generated },
                    { label: "Emails Approved", value: summary.emails_approved },
                    { label: "Leads Sent", value: summary.leads_sent },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-slate-50 rounded-lg px-4 py-3">
                      <p className="text-2xl font-bold text-brand-primary">{value ?? 0}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Outreach preview */}
            {outreachResults.length > 0 && (
              <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-brand-border">
                  <h3 className="text-sm font-semibold text-brand-secondary">Generated Outreach</h3>
                </div>
                <div className="divide-y divide-brand-border max-h-80 overflow-auto">
                  {outreachResults.map((r, i) => (
                    <div key={i} className="px-6 py-3 flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-brand-secondary truncate">{r.icp_name || "—"}</p>
                        <p className="text-xs text-slate-500 truncate">{r.icp_title} · {r.company}</p>
                        {r.subject_1 && <p className="text-xs text-slate-400 mt-1 italic truncate">"{r.subject_1}"</p>}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        r.qa_status === "passed" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                      }`}>
                        {r.qa_status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            </>)}

            {/* Companies tab */}
            {activeTab === "companies" && (
              <div className="space-y-3">
                {companyDetails.length === 0 ? (
                  <div className="bg-white border border-brand-border rounded-xl px-6 py-12 text-center text-sm text-slate-400 shadow-sm">
                    {running ? "Waiting for people discovery to start..." : "No company data available."}
                  </div>
                ) : companyDetails.map((co: any) => {
                  const ckey = co.company_key;
                  const isOpen = expandedCompany === ckey;
                  const subTab = companySubTab[ckey] || "people";
                  const emailCount = (co.emails || []).length;
                  const icpCount = (co.icps || []).length;
                  const peopleCount = co.people_count || (co.all_people || []).length;
                  return (
                    <div key={ckey} className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
                      {/* Company header — click to expand */}
                      <button
                        onClick={() => setExpandedCompany(isOpen ? null : ckey)}
                        className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-brand-secondary truncate">
                            {co.company_name || co.company_domain || ckey}
                          </p>
                          {co.company_domain && (
                            <p className="text-xs text-slate-400 mt-0.5">{co.company_domain}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                            {peopleCount} people
                          </span>
                          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                            {icpCount} ICPs
                          </span>
                          {emailCount > 0 && (
                            <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                              {emailCount} emails
                            </span>
                          )}
                          <svg className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </button>

                      {/* Expanded detail */}
                      {isOpen && (
                        <div className="border-t border-brand-border">
                          {/* Sub-tab bar */}
                          <div className="flex border-b border-brand-border bg-slate-50">
                            {([
                              { id: "people", label: `All People (${peopleCount})` },
                              { id: "icps", label: `ICPs (${icpCount})` },
                              { id: "emails", label: `Emails (${emailCount})` },
                            ] as { id: "people" | "icps" | "emails"; label: string }[]).map(({ id, label }) => (
                              <button
                                key={id}
                                onClick={() => setCompanySubTab((prev) => ({ ...prev, [ckey]: id }))}
                                className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                                  subTab === id
                                    ? "border-brand-primary text-brand-primary"
                                    : "border-transparent text-slate-500 hover:text-brand-secondary"
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>

                          {/* People sub-tab */}
                          {subTab === "people" && (
                            <div className="divide-y divide-brand-border max-h-72 overflow-auto">
                              {(co.all_people || []).length === 0 ? (
                                <p className="px-5 py-6 text-xs text-slate-400 text-center">No people data available.</p>
                              ) : (co.all_people || []).map((p: any, i: number) => (
                                <div key={i} className="px-5 py-2.5 flex items-center gap-3">
                                  <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                                    <span className="text-xs text-slate-500 font-medium">{(p.name || "?")[0]?.toUpperCase()}</span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-700">{p.name || "—"}</p>
                                    <p className="text-xs text-slate-400 truncate">{p.title || "—"}</p>
                                  </div>
                                  {p.linkedin_url && (
                                    <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline flex-shrink-0">
                                      LinkedIn
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* ICPs sub-tab */}
                          {subTab === "icps" && (
                            <div className="divide-y divide-brand-border max-h-72 overflow-auto">
                              {(co.icps || []).length === 0 ? (
                                <p className="px-5 py-6 text-xs text-slate-400 text-center">No ICPs shortlisted.</p>
                              ) : (co.icps || []).map((icp: any, i: number) => (
                                <div key={i} className="px-5 py-3">
                                  <div className="flex items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-semibold text-brand-secondary">{icp.name || "—"}</p>
                                      <p className="text-xs text-slate-500">{icp.title || "—"}</p>
                                    </div>
                                    {icp.email ? (
                                      <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded font-mono flex-shrink-0">{icp.email}</span>
                                    ) : (
                                      <span className="text-xs text-slate-300 flex-shrink-0">No email</span>
                                    )}
                                  </div>
                                  {icp.icp_reason && (
                                    <p className="mt-1 text-xs text-slate-400 italic">{icp.icp_reason}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Emails sub-tab */}
                          {subTab === "emails" && (
                            <div className="divide-y divide-brand-border max-h-96 overflow-auto">
                              {(co.emails || []).length === 0 ? (
                                <p className="px-5 py-6 text-xs text-slate-400 text-center">
                                  {emailCount === 0 && running ? "Email generation pending..." : "No emails generated."}
                                </p>
                              ) : (co.emails || []).map((em: any, i: number) => (
                                <div key={i} className="px-5 py-4">
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-semibold text-brand-secondary">{em.name}</p>
                                      <p className="text-xs text-slate-400">{em.title} · {em.email}</p>
                                    </div>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                                      em.approved ? "bg-green-50 text-green-700" : "bg-red-50 text-red-500"
                                    }`}>
                                      {em.qa_status || (em.approved ? "passed" : "failed")}
                                    </span>
                                  </div>
                                  {em.subject_1 && (
                                    <p className="text-xs font-medium text-slate-600 mb-1">
                                      <span className="text-slate-400">Subject: </span>{em.subject_1}
                                    </p>
                                  )}
                                  {em.subject_2 && (
                                    <p className="text-xs text-slate-500 mb-1">
                                      <span className="text-slate-400">Alt: </span>{em.subject_2}
                                    </p>
                                  )}
                                  {em.body && (
                                    <pre className="mt-2 text-xs text-slate-600 whitespace-pre-wrap font-sans bg-slate-50 rounded-lg px-3 py-2.5 max-h-48 overflow-auto border border-slate-100">
                                      {em.body}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Logs tab */}
            {activeTab === "logs" && (
              <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
                <div className="px-6 py-3 border-b border-brand-border flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pipeline Log</h3>
                  {logs.length > 0 && (
                    <button
                      onClick={() => navigator.clipboard.writeText(logs.join("\n"))}
                      className="text-xs text-slate-400 hover:text-brand-primary transition-colors"
                    >
                      Copy all
                    </button>
                  )}
                </div>
                {logs.length === 0 ? (
                  <div className="px-6 py-8 text-center text-xs text-slate-400">No log entries yet.</div>
                ) : (
                  <div className="px-6 py-4 max-h-[480px] overflow-auto font-mono text-xs bg-slate-950 space-y-1">
                    {logs.map((line, i) => {
                      const isError = line.includes("  ✗  ");
                      const isDone = line.includes("  ✓  ");
                      const isRunning = line.includes("  →  ");
                      const color = isError
                        ? "text-red-400"
                        : isDone
                        ? "text-green-400"
                        : isRunning
                        ? "text-amber-400"
                        : "text-slate-400";
                      return (
                        <div key={i} className={`${color} leading-relaxed`}>
                          {line}
                        </div>
                      );
                    })}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
