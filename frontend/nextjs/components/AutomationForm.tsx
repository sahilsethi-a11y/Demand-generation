"use client";

import { useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AutomationFormData {
  name: string;
  role: string;
  location: string;
  date_filter: "7d" | "30d";
  market: "us" | "india";
  job_type: string;
  sources: string[];
  max_companies: number;
  max_icps_per_company: number;
  campaign_id: string;
  titles: string[];
  auto_icp: boolean;
  auto_email: boolean;
  auto_send: boolean;
  interval_minutes: number;
  cron_expr: string;
  skip_contacted_companies: boolean;
  dedup_lookback_days: number;
}

const US_SOURCES = ["greenhouse", "ashby", "lever"];
const INDIA_SOURCES = ["linkedin", "naukri", "indeed"];

const INTERVAL_OPTIONS = [
  { value: 60, label: "Every 1 hour" },
  { value: 180, label: "Every 3 hours" },
  { value: 360, label: "Every 6 hours" },
  { value: 720, label: "Every 12 hours" },
  { value: 1440, label: "Every 24 hours" },
  { value: 2880, label: "Every 48 hours" },
  { value: 10080, label: "Every week" },
];

const DEDUP_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 0, label: "Never re-contact" },
];

const JOB_TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
];

export const DEFAULT_FORM_DATA: AutomationFormData = {
  name: "",
  role: "",
  location: "",
  date_filter: "7d",
  market: "us",
  job_type: "all",
  sources: US_SOURCES,
  max_companies: 100,
  max_icps_per_company: 5,
  campaign_id: "",
  titles: [],
  auto_icp: true,
  auto_email: true,
  auto_send: true,
  interval_minutes: 360,
  cron_expr: "",
  skip_contacted_companies: true,
  dedup_lookback_days: 90,
};

// ── Component ────────────────────────────────────────────────────────────────

interface AutomationFormProps {
  initialData?: Partial<AutomationFormData>;
  onSubmit: (data: AutomationFormData) => Promise<void>;
  submitLabel?: string;
  loading?: boolean;
}

export default function AutomationForm({
  initialData,
  onSubmit,
  submitLabel = "Create Automation",
  loading = false,
}: AutomationFormProps) {
  const [form, setForm] = useState<AutomationFormData>({
    ...DEFAULT_FORM_DATA,
    ...initialData,
  });
  const [titlesInput, setTitlesInput] = useState((initialData?.titles || []).join(", "));
  const [useCustomCron, setUseCustomCron] = useState(!!initialData?.cron_expr);

  function update<K extends keyof AutomationFormData>(key: K, value: AutomationFormData[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-generate name when role+location+interval change
      if ((key === "role" || key === "location" || key === "interval_minutes") && !prev.name) {
        const role = key === "role" ? String(value) : prev.role;
        const loc = key === "location" ? String(value) : prev.location;
        const mins = key === "interval_minutes" ? Number(value) : prev.interval_minutes;
        const intervalLabel = INTERVAL_OPTIONS.find((o) => o.value === mins)?.label.replace("Every ", "") || `${mins}m`;
        if (role && loc) {
          next.name = `${role} / ${loc} / ${intervalLabel}`;
        }
      }
      return next;
    });
  }

  function handleMarketChange(market: "us" | "india") {
    const defaultSources = market === "us" ? US_SOURCES : INDIA_SOURCES;
    setForm((prev) => ({ ...prev, market, sources: defaultSources }));
  }

  function toggleSource(source: string) {
    setForm((prev) => ({
      ...prev,
      sources: prev.sources.includes(source)
        ? prev.sources.filter((s) => s !== source)
        : [...prev.sources, source],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const titles = titlesInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await onSubmit({ ...form, titles, cron_expr: useCustomCron ? form.cron_expr : "" });
  }

  const availableSources = form.market === "us" ? US_SOURCES : INDIA_SOURCES;
  const isValid = form.role.trim() && form.location.trim() && form.sources.length > 0;

  const inputCls =
    "w-full px-3 py-2 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary";
  const labelCls = "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5";
  const toggleBtnCls = (active: boolean) =>
    `flex-1 py-1.5 px-3 rounded-lg border text-sm font-medium transition-all ${
      active
        ? "bg-brand-primary text-white border-brand-primary"
        : "bg-white text-slate-600 border-brand-border hover:border-brand-primary"
    }`;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Name */}
      <div>
        <label className={labelCls}>Automation Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="e.g. SWE / San Francisco / 6h"
          className={inputCls}
        />
      </div>

      {/* Market */}
      <div>
        <label className={labelCls}>Market</label>
        <div className="flex gap-2">
          {(["us", "india"] as const).map((m) => (
            <button key={m} type="button" onClick={() => handleMarketChange(m)} className={toggleBtnCls(form.market === m)}>
              {m === "us" ? "🇺🇸 United States" : "🇮🇳 India"}
            </button>
          ))}
        </div>
      </div>

      {/* Role + Location */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Role / Job Title</label>
          <input
            type="text"
            value={form.role}
            onChange={(e) => update("role", e.target.value)}
            placeholder="e.g. Software Engineer"
            className={inputCls}
            required
          />
        </div>
        <div>
          <label className={labelCls}>Location</label>
          <input
            type="text"
            value={form.location}
            onChange={(e) => update("location", e.target.value)}
            placeholder={form.market === "us" ? "e.g. San Francisco" : "e.g. Bangalore"}
            className={inputCls}
            required
          />
        </div>
      </div>

      {/* Job Type */}
      <div>
        <label className={labelCls}>Job Type</label>
        <div className="flex flex-wrap gap-1.5">
          {JOB_TYPE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => update("job_type", value)}
              className={`py-1 px-2.5 rounded-lg border text-xs font-medium transition-all ${
                form.job_type === value
                  ? "bg-brand-primary text-white border-brand-primary"
                  : "bg-white text-slate-600 border-brand-border hover:border-brand-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Date Range */}
      <div>
        <label className={labelCls}>Date Range</label>
        <div className="flex gap-2">
          {(["7d", "30d"] as const).map((d) => (
            <button key={d} type="button" onClick={() => update("date_filter", d)} className={toggleBtnCls(form.date_filter === d)}>
              {d === "7d" ? "Last 7 days" : "Last 30 days"}
            </button>
          ))}
        </div>
      </div>

      {/* Sources */}
      <div>
        <label className={labelCls}>Job Sources</label>
        <div className="flex flex-wrap gap-3">
          {availableSources.map((source) => {
            const jobsPerActor = source === "lever" ? 100 : Math.max(200, form.max_companies * 4);
            return (
              <label key={source} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.sources.includes(source)}
                  onChange={() => toggleSource(source)}
                  className="w-4 h-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary"
                />
                <span className="text-sm text-slate-700 group-hover:text-brand-primary transition-colors capitalize">
                  {source}
                </span>
                <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 font-medium">
                  ~{jobsPerActor.toLocaleString()}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Schedule interval */}
      <div>
        <label className={labelCls}>Run Interval</label>
        {!useCustomCron ? (
          <div className="flex flex-wrap gap-1.5">
            {INTERVAL_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => update("interval_minutes", value)}
                className={`py-1 px-2.5 rounded-lg border text-xs font-medium transition-all ${
                  form.interval_minutes === value
                    ? "bg-brand-primary text-white border-brand-primary"
                    : "bg-white text-slate-600 border-brand-border hover:border-brand-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <input
            type="text"
            value={form.cron_expr}
            onChange={(e) => update("cron_expr", e.target.value)}
            placeholder="e.g. 0 9 * * 1-5  (9am Mon–Fri)"
            className={inputCls}
          />
        )}
        <button
          type="button"
          onClick={() => setUseCustomCron((v) => !v)}
          className="mt-1.5 text-xs text-brand-primary hover:underline"
        >
          {useCustomCron ? "← Use preset intervals" : "Use custom cron expression →"}
        </button>
      </div>

      {/* Dedup + Skip companies */}
      <div className="bg-slate-50 rounded-lg p-4 space-y-3 border border-slate-200">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Deduplication</p>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={form.skip_contacted_companies}
            onChange={(e) => update("skip_contacted_companies", e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary"
          />
          <div>
            <span className="text-sm text-slate-700 font-medium">Skip already-contacted companies</span>
            <p className="text-xs text-slate-400">Saves Apollo credits — won't re-enrich companies you've already outreached</p>
          </div>
        </label>

        <div>
          <label className={labelCls}>Contact lookback window</label>
          <div className="flex gap-2 flex-wrap">
            {DEDUP_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => update("dedup_lookback_days", value)}
                className={`py-1 px-2.5 rounded-lg border text-xs font-medium transition-all ${
                  form.dedup_lookback_days === value
                    ? "bg-brand-primary text-white border-brand-primary"
                    : "bg-white text-slate-600 border-brand-border hover:border-brand-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-1">Individual contacts within this window won't receive duplicate emails</p>
        </div>
      </div>

      {/* Pipeline options */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Max Companies</label>
          <select
            value={form.max_companies}
            onChange={(e) => update("max_companies", Number(e.target.value))}
            className={inputCls}
          >
            {[20, 50, 100, 150, 200].map((n) => (
              <option key={n} value={n}>{n} companies</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-slate-400">
            Fetches ~{Math.max(200, form.max_companies * 4).toLocaleString()} jobs/source · formula: max(200, companies × 4)
          </p>
        </div>
        <div>
          <label className={labelCls}>Max ICPs / Company</label>
          <select
            value={form.max_icps_per_company}
            onChange={(e) => update("max_icps_per_company", Number(e.target.value))}
            className={inputCls}
          >
            {[3, 5, 10].map((n) => (
              <option key={n} value={n}>{n} contacts</option>
            ))}
          </select>
        </div>
      </div>

      {/* Target titles */}
      <div>
        <label className={labelCls}>Target Titles (optional, comma-separated)</label>
        <input
          type="text"
          value={titlesInput}
          onChange={(e) => setTitlesInput(e.target.value)}
          placeholder="e.g. CTO, VP Engineering, Head of Engineering"
          className={inputCls}
        />
      </div>

      {/* Campaign ID */}
      <div>
        <label className={labelCls}>Instantly Campaign ID (optional)</label>
        <input
          type="text"
          value={form.campaign_id}
          onChange={(e) => update("campaign_id", e.target.value)}
          placeholder="Uses INSTANTLY_CAMPAIGN_ID env var if blank"
          className={inputCls}
        />
      </div>

      {/* Auto flags */}
      <div className="flex gap-6">
        {[
          { key: "auto_icp" as const, label: "Auto ICP Selection" },
          { key: "auto_email" as const, label: "Auto Email Generation" },
          { key: "auto_send" as const, label: "Auto Send to Instantly" },
        ].map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form[key] as boolean}
              onChange={(e) => update(key, e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary"
            />
            <span className="text-sm text-slate-600">{label}</span>
          </label>
        ))}
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={!isValid || loading}
        className="w-full py-2.5 bg-brand-primary text-white rounded-lg text-sm font-semibold hover:bg-blue-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
