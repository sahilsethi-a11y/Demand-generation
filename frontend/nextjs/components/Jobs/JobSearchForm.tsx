import { JobPosting } from "@/types/data";

export type JobSearchSource = "ashby" | "greenhouse" | "lever" | "apollo";
export type JobDateFilter = "7d" | "30d";
export type JobTypeFilter =
  | "all"
  | "full_time"
  | "part_time"
  | "contract"
  | "internship"
  | "remote"
  | "hybrid"
  | "onsite";

interface JobSearchFormProps {
  role: string;
  location: string;
  dateFilter: JobDateFilter;
  jobType: JobTypeFilter;
  sources: JobSearchSource[];
  useApolloEnrichment: boolean;
  isLoading: boolean;
  onRoleChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onDateFilterChange: (value: JobDateFilter) => void;
  onJobTypeChange: (value: JobTypeFilter) => void;
  onSourcesChange: (value: JobSearchSource[]) => void;
  onApolloEnrichmentChange: (value: boolean) => void;
  onSubmit: () => void;
  lastRunSummary?: {
    collectedCount: number;
    uniqueCount: number;
    savedTotal: number;
  } | null;
  latestResults?: JobPosting[];
}

const SOURCE_OPTIONS: Array<{ value: JobSearchSource; label: string }> = [
  { value: "ashby", label: "Ashby" },
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "apollo", label: "Apollo" },
];

const LOCATION_OPTIONS = ["United States", "India", "United Arab Emirates"] as const;

export default function JobSearchForm({
  role,
  location,
  dateFilter,
  jobType,
  sources,
  useApolloEnrichment,
  isLoading,
  onRoleChange,
  onLocationChange,
  onDateFilterChange,
  onJobTypeChange,
  onSourcesChange,
  onApolloEnrichmentChange,
  onSubmit,
  lastRunSummary,
  latestResults,
}: JobSearchFormProps) {
  const toggleSource = (source: JobSearchSource) => {
    if (sources.includes(source)) {
      onSourcesChange(sources.filter((value) => value !== source));
      return;
    }
    onSourcesChange([...sources, source]);
  };

  return (
    <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Job Search
          </p>
          <h2 className="mt-2 text-base font-semibold text-slate-100">Run a multi-platform search</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Search Ashby, Greenhouse, and Lever through Apify-backed workflows and save deduplicated jobs into the shared SQL store.
          </p>
        </div>
        {lastRunSummary && (
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 px-4 py-3 text-xs text-slate-300">
            <p>{lastRunSummary.uniqueCount} unique jobs in last run</p>
            <p className="mt-1 text-slate-500">
              {lastRunSummary.collectedCount} collected, {lastRunSummary.savedTotal} total saved
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Role</span>
          <input
            value={role}
            onChange={(event) => onRoleChange(event.target.value)}
            placeholder="Product Manager"
            className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Location</span>
          <select
            value={location}
            onChange={(event) => onLocationChange(event.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            {LOCATION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Date Posted</span>
          <select
            value={dateFilter}
            onChange={(event) => onDateFilterChange(event.target.value as JobDateFilter)}
            className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="7d">Less than 7 days</option>
            <option value="30d">Less than 30 days</option>
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Job Type</span>
          <select
            value={jobType}
            onChange={(event) => onJobTypeChange(event.target.value as JobTypeFilter)}
            className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="all">All job types</option>
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
            <option value="contract">Contract</option>
            <option value="internship">Internship</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">Onsite</option>
          </select>
        </label>
      </div>

      <div className="mt-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Sources</p>
        <div className="flex flex-wrap gap-3">
          {SOURCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            >
              <input
                type="checkbox"
                checked={sources.includes(option.value)}
                onChange={() => toggleSource(option.value)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <label className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={useApolloEnrichment}
            onChange={(event) => onApolloEnrichmentChange(event.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
          />
          <span>
            Run Apollo employee enrichment and generate personalised content after jobs are fetched
          </span>
        </label>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          {latestResults && latestResults.length > 0
            ? `Latest discovery run returned ${latestResults.length} fetched jobs.`
            : "Discovery results will appear below after the search completes."}
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isLoading || !role.trim() || !location.trim() || sources.length === 0}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Searching..." : "Search Jobs"}
        </button>
      </div>
    </section>
  );
}
