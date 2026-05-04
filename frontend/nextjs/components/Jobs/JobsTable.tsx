import { useEffect, useMemo, useState } from "react";
import { CompanyContact, JobPosting } from "@/types/data";

interface JobsTableProps {
  title: string;
  jobs: JobPosting[];
  isLoading?: boolean;
  emptyMessage: string;
  totalCount?: number;
  subtitle?: string;
  sourceFilter?: string;
  onSourceFilterChange?: (value: string) => void;
  enableRoleFilter?: boolean;
  roleFilter?: string;
  onRoleFilterChange?: (value: string) => void;
  locationFilter?: string;
  onLocationFilterChange?: (value: string) => void;
  hasContactsFilter?: boolean;
  onHasContactsFilterChange?: (value: boolean) => void;
  contactTitleFilter?: string;
  onContactTitleFilterChange?: (value: string) => void;
  onRerunEnrichment?: () => void;
  isRerunningEnrichment?: boolean;
  onSendToInstantly?: () => void;
  isSendingToInstantly?: boolean;
  sentToInstantlyJobKeys?: string[];
  selectedJobKeys?: string[];
  onToggleJobSelection?: (job: JobPosting, checked: boolean) => void;
  onToggleAllVisible?: (jobs: JobPosting[], checked: boolean) => void;
  page?: number;
  pageSize?: number;
  onPreviousPage?: () => void;
  onNextPage?: () => void;
  isPaginated?: boolean;
}

function formatPostedDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
}

function formatSalary(job: JobPosting): string {
  const min = job.ai_salary_minvalue;
  const max = job.ai_salary_maxvalue;
  const currency = job.ai_salary_currency ?? "";
  if (min == null && max == null) {
    return "—";
  }
  if (min != null && max != null) {
    return `${currency} ${min.toLocaleString()} - ${max.toLocaleString()}`.trim();
  }
  return `${currency} ${(min ?? max ?? 0).toLocaleString()}`.trim();
}

function renderContact(contact: CompanyContact, index: number) {
  return (
    <div
      key={`${contact.email || contact.name || "contact"}-${index}`}
      className="rounded-lg border border-slate-800/80 bg-slate-900/70 px-4 py-3"
    >
      <p className="text-sm font-semibold text-slate-100">{contact.name || "Unknown contact"}</p>
      <p className="mt-1 text-xs text-slate-400">{contact.title || "No title"}</p>
      <p className="mt-1 text-xs text-indigo-300">{contact.email || "No email found"}</p>
    </div>
  );
}

function joinValues(values: Array<string | null | undefined> | null | undefined): string {
  if (!values || values.length === 0) {
    return "—";
  }
  const filtered = values.map((value) => String(value || "").trim()).filter(Boolean);
  return filtered.length > 0 ? filtered.join(", ") : "—";
}

function renderDetail(label: string, value: string | null | undefined) {
  return (
    <div className="rounded-lg border border-slate-800/80 bg-slate-900/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-100">{value && value.trim() ? value : "—"}</p>
    </div>
  );
}

const LOCATION_OPTIONS = ["", "United States", "India", "United Arab Emirates"];

export default function JobsTable({
  title,
  jobs,
  isLoading = false,
  emptyMessage,
  totalCount,
  subtitle,
  sourceFilter = "all",
  onSourceFilterChange,
  enableRoleFilter = false,
  roleFilter = "",
  onRoleFilterChange,
  locationFilter = "",
  onLocationFilterChange,
  hasContactsFilter = false,
  onHasContactsFilterChange,
  contactTitleFilter = "",
  onContactTitleFilterChange,
  onRerunEnrichment,
  isRerunningEnrichment = false,
  onSendToInstantly,
  isSendingToInstantly = false,
  sentToInstantlyJobKeys = [],
  selectedJobKeys = [],
  onToggleJobSelection,
  onToggleAllVisible,
  page = 1,
  pageSize = 100,
  onPreviousPage,
  onNextPage,
  isPaginated = false,
}: JobsTableProps) {
  const [selectedJob, setSelectedJob] = useState<JobPosting | null>(null);
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  const [generatedEmailPayload, setGeneratedEmailPayload] = useState<Record<string, unknown> | null>(null);
  const [generatedEmailError, setGeneratedEmailError] = useState<string | null>(null);
  const selectedJobKeySet = useMemo(() => new Set(selectedJobKeys), [selectedJobKeys]);
  const sentToInstantlyKeySet = useMemo(() => new Set(sentToInstantlyJobKeys), [sentToInstantlyJobKeys]);
  useEffect(() => {
    if (!selectedJob) {
      setGeneratedEmailPayload(null);
      setGeneratedEmailError(null);
      setIsGeneratingEmail(false);
      return;
    }
    const selectedKey =
      selectedJob.job_key || selectedJob.apply_url || selectedJob.url || `${selectedJob.source}-${selectedJob.id}`;
    const nextSelectedJob =
      jobs.find((job) => {
        const jobKey = job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`;
        return jobKey === selectedKey;
      }) ?? null;
    if (nextSelectedJob) {
      setSelectedJob(nextSelectedJob);
    }
  }, [jobs, selectedJob]);
  const filteredJobs = useMemo(() => {
    const roleQuery = roleFilter.trim().toLowerCase();
    const locationQuery = locationFilter.trim().toLowerCase();
    return jobs.filter((job) => {
      const matchesRole = roleQuery
        ? String(job.title || "").toLowerCase().includes(roleQuery)
        : true;
      const matchesLocation = locationQuery
        ? [
            job.display_location,
            ...(job.locations_derived || []),
            ...(job.countries_derived || []),
            ...(job.regions_derived || []),
            ...(job.cities_derived || []),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(locationQuery)
        : true;
      return matchesRole && matchesLocation;
    });
  }, [jobs, locationFilter, roleFilter]);
  const allVisibleSelected =
    filteredJobs.length > 0 &&
    filteredJobs.every((job) => {
      const jobKey = job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`;
      return selectedJobKeySet.has(jobKey);
    });
  const showPagination = isPaginated && typeof totalCount === "number" && totalCount > pageSize;
  const totalPages = totalCount ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;

  const handleGenerateEmail = async () => {
    if (!selectedJob) {
      return;
    }
    try {
      setIsGeneratingEmail(true);
      setGeneratedEmailError(null);
      const response = await fetch("/api/jobs/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job: selectedJob }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to generate outbound content.");
      }
      setGeneratedEmailPayload(data);
    } catch (error) {
      setGeneratedEmailError(error instanceof Error ? error.message : "Failed to generate outbound content.");
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  return (
    <>
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Jobs</p>
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {onSourceFilterChange && (
            <select
              value={sourceFilter}
              onChange={(event) => onSourceFilterChange(event.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 outline-none"
            >
              <option value="all">All sources</option>
              <option value="apollo">Apollo</option>
              <option value="ashby">Ashby</option>
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
            </select>
          )}
          {enableRoleFilter && (
            <input
              value={roleFilter}
              onChange={(event) => onRoleFilterChange?.(event.target.value)}
              placeholder="Filter by role"
              className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-500"
            />
          )}
          {onLocationFilterChange && (
            <select
              value={locationFilter}
              onChange={(event) => onLocationFilterChange(event.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 outline-none"
            >
              <option value="">All locations</option>
              {LOCATION_OPTIONS.filter(Boolean).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
          {onHasContactsFilterChange && (
            <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={hasContactsFilter}
                onChange={(event) => onHasContactsFilterChange(event.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
              />
              Has contacts
            </label>
          )}
          {onContactTitleFilterChange && (
            <input
              value={contactTitleFilter}
              onChange={(event) => onContactTitleFilterChange(event.target.value)}
              placeholder="Filter by contact title"
              className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-500"
            />
          )}
          {onRerunEnrichment && (
            <button
              type="button"
              onClick={onRerunEnrichment}
              disabled={isRerunningEnrichment || selectedJobKeys.length === 0}
              className="rounded-lg border border-slate-700/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRerunningEnrichment ? "Enriching..." : `Run Apollo on Selected${selectedJobKeys.length ? ` (${selectedJobKeys.length})` : ""}`}
            </button>
          )}
          {onSendToInstantly && (
            <button
              type="button"
              onClick={onSendToInstantly}
              disabled={isSendingToInstantly || selectedJobKeys.length === 0}
              className="rounded-lg border border-emerald-700/80 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSendingToInstantly ? "Sending..." : `Send to Instantly${selectedJobKeys.length ? ` (${selectedJobKeys.length})` : ""}`}
            </button>
          )}
          {typeof totalCount === "number" && (
            <div className="text-xs text-slate-500">
              {totalCount.toLocaleString()} saved jobs
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-[0.2em] text-slate-400">
              <tr>
                {onToggleJobSelection && (
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => onToggleAllVisible?.(filteredJobs, event.target.checked)}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
                      aria-label="Select all visible jobs"
                    />
                  </th>
                )}
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Contacts</th>
                <th className="px-4 py-3">Instantly</th>
                <th className="px-4 py-3">Posted</th>
                <th className="px-4 py-3">Salary</th>
                <th className="px-4 py-3 text-right">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={onToggleJobSelection ? 10 : 9} className="px-4 py-4 text-xs text-slate-400">
                    Loading jobs...
                  </td>
                </tr>
              ) : filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={onToggleJobSelection ? 10 : 9} className="px-4 py-4 text-xs text-slate-400">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => (
                  <tr
                    key={job.apply_url || job.url || `${job.source}-${job.id}`}
                    className="cursor-pointer hover:bg-slate-900/70"
                    onClick={() => setSelectedJob(job)}
                  >
                    {onToggleJobSelection && (
                      <td className="px-4 py-3 text-xs text-slate-300" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedJobKeySet.has(job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`)}
                          onChange={(event) => onToggleJobSelection(job, event.target.checked)}
                          className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
                          aria-label={`Select job ${job.title || "job"}`}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm font-semibold text-indigo-200">
                      {job.title || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {job.organization || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {job.display_location || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {job.source}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {job.contacts_count && job.contacts_count > 0
                        ? `${job.contacts_count} contacts`
                        : job.apollo_enrichment_status === "running" || job.apollo_enrichment_status === "queued"
                          ? "Pending"
                          : job.apollo_enrichment_status === "failed"
                            ? "Failed"
                            : "None"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {sentToInstantlyKeySet.has(job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`)
                        ? "Sent"
                        : "Not sent"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {formatPostedDate(job.date_posted)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {formatSalary(job)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs">
                      {job.apply_url || job.url ? (
                        <a
                          href={job.apply_url || job.url || undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="text-indigo-300 hover:underline"
                        >
                          Open
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showPagination && (
        <div className="flex items-center justify-end gap-3 text-xs text-slate-400">
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={onPreviousPage}
            disabled={page <= 1}
            className="rounded-full border border-slate-700/70 px-3 py-1 font-semibold text-slate-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={onNextPage}
            disabled={page >= totalPages}
            className="rounded-full border border-slate-700/70 px-3 py-1 font-semibold text-slate-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </section>
    {selectedJob && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
        onClick={() => setSelectedJob(null)}
      >
        <div
          className="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-950 p-6 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{selectedJob.title || "Job Details"}</h3>
              <p className="text-sm text-slate-400">
                {selectedJob.organization || "Unknown company"} • {selectedJob.source}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedJob(null)}
              className="rounded-full border border-slate-700/70 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
            >
              Close
            </button>
          </div>
          <div className="mt-6">
            <h4 className="text-sm font-semibold text-slate-100">Company Contacts</h4>
            {selectedJob.company_contacts && selectedJob.company_contacts.length > 0 ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {selectedJob.company_contacts.map(renderContact)}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                {selectedJob.apollo_enrichment_status === "running" || selectedJob.apollo_enrichment_status === "queued"
                  ? "Apollo enrichment is in progress for this company."
                  : "No company contacts are available for this job yet."}
              </p>
            )}
          </div>
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={handleGenerateEmail}
              disabled={isGeneratingEmail || !selectedJob.company_contacts || selectedJob.company_contacts.length === 0}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGeneratingEmail ? "Generating..." : "View Generated Content"}
            </button>
            {!selectedJob.company_contacts || selectedJob.company_contacts.length === 0 ? (
              <p className="text-xs text-slate-500">Generate content after Apollo contacts are available.</p>
            ) : null}
          </div>
          {generatedEmailError ? (
            <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
              {generatedEmailError}
            </div>
          ) : null}
          {generatedEmailPayload ? (
            <div className="mt-6 space-y-4 rounded-lg border border-slate-800/80 bg-slate-900/60 p-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-100">Generated Outbound Content</h4>
                <p className="mt-1 text-xs text-slate-400">
                  Deterministic contact selection, signal generation, QA, and Instantly-ready payload.
                </p>
              </div>
              <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800/80 bg-slate-950/70 p-4 text-xs text-slate-200">
                {JSON.stringify(generatedEmailPayload, null, 2)}
              </pre>
            </div>
          ) : null}
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {renderDetail("Company", selectedJob.organization)}
            {renderDetail("Source", selectedJob.source)}
            {renderDetail("Location", selectedJob.display_location || joinValues(selectedJob.locations_derived))}
            {renderDetail("Posted", formatPostedDate(selectedJob.date_posted))}
            {renderDetail("Salary", formatSalary(selectedJob))}
            {renderDetail(
              "Work Arrangement",
              selectedJob.ai_work_arrangement || (selectedJob.remote_derived ? "Remote" : null),
            )}
            {renderDetail("Experience", selectedJob.ai_experience_level)}
            {renderDetail("Employment Type", joinValues(selectedJob.ai_employment_type || selectedJob.employment_type))}
            {renderDetail("Company Domain", selectedJob.domain_derived)}
            {renderDetail("Company URL", selectedJob.organization_url || selectedJob.apply_url || selectedJob.url)}
          </div>
          {(selectedJob.ai_key_skills?.length || selectedJob.ai_benefits?.length || selectedJob.ai_keywords?.length) ? (
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {renderDetail("Key Skills", joinValues(selectedJob.ai_key_skills))}
              {renderDetail("Benefits", joinValues(selectedJob.ai_benefits))}
              {renderDetail("Keywords", joinValues(selectedJob.ai_keywords))}
            </div>
          ) : null}
          {selectedJob.ai_requirements_summary || selectedJob.ai_core_responsibilities || selectedJob.description_text ? (
            <div className="mt-6 space-y-4">
              {selectedJob.ai_requirements_summary ? (
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">Requirements Summary</h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                    {selectedJob.ai_requirements_summary}
                  </p>
                </div>
              ) : null}
              {selectedJob.ai_core_responsibilities ? (
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">Core Responsibilities</h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                    {selectedJob.ai_core_responsibilities}
                  </p>
                </div>
              ) : null}
              {selectedJob.description_text ? (
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">Description</h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                    {selectedJob.description_text}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          <details className="mt-6 rounded-lg border border-slate-800/80 bg-slate-900/50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-200">Raw Job JSON</summary>
            <pre className="mt-4 max-h-[40vh] overflow-auto whitespace-pre-wrap text-xs text-slate-200">
              {JSON.stringify(selectedJob, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    )}
    </>
  );
}
