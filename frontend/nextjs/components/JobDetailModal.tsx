"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

const SOURCE_COLORS: Record<string, string> = {
  linkedin:   "bg-sky-50 text-sky-700 border-sky-200",
  naukri:     "bg-orange-50 text-orange-700 border-orange-200",
  indeed:     "bg-indigo-50 text-indigo-700 border-indigo-200",
  ashby:      "bg-violet-50 text-violet-700 border-violet-200",
  greenhouse: "bg-emerald-50 text-emerald-700 border-emerald-200",
  lever:      "bg-blue-50 text-blue-700 border-blue-200",
};

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-slate-700 break-words">{value}</p>
    </div>
  );
}

function LinkField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-brand-primary hover:underline break-all"
      >
        {value} ↗
      </a>
    </div>
  );
}

type ModalTab = "details" | "contacts" | "emails";

export default function JobDetailModal({
  job,
  onClose,
}: {
  job: any;
  onClose: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [activeTab, setActiveTab] = useState<ModalTab>("details");
  const [contacts, setContacts] = useState<any[]>([]);
  const [emails, setEmails] = useState<any[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const handleGenerateEmail = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/jobs/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate email.");
      const contact = data.contact_selection?.contact;
      const emailGen = data.email_generation;
      const qa = data.qa;
      if (!emailGen) {
        throw new Error("Email generation returned no content. Check that an OpenAI API key is configured.");
      }
      const newEmail = {
        contact_name: contact?.name || job.organization || "—",
        contact_title: contact?.title || "—",
        contact_email: contact?.email || "—",
        subject_1: emailGen.subject_options?.[0] || "",
        subject_2: emailGen.subject_options?.[1] || "",
        body: emailGen.full_email_text || "",
        approved: qa?.approved_for_export ?? false,
        qa_status: qa?.qa_status || "failed",
      };
      setEmails((prev) => [newEmail, ...prev]);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Failed to generate email.");
    } finally {
      setGenerating(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Load contacts + emails when tab switches to contacts or emails
  useEffect(() => {
    const companyKey = job?.company_key;
    if (!companyKey || (activeTab !== "contacts" && activeTab !== "emails")) return;
    if (contacts.length > 0 || emails.length > 0) return; // already loaded
    setPeopleLoading(true);
    fetch(`${API_BASE}/api/companies/${encodeURIComponent(companyKey)}/people`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setContacts(data.contacts || []);
          setEmails(data.emails || []);
        }
      })
      .finally(() => setPeopleLoading(false));
  }, [activeTab, job?.company_key, contacts.length, emails.length]);

  if (!job) return null;

  const source = (job.source || "").toLowerCase();
  const sourceColor = SOURCE_COLORS[source] || "bg-slate-50 text-slate-600 border-slate-200";

  const skills: string[] = Array.isArray(job.ai_key_skills)
    ? job.ai_key_skills
    : typeof job.tagsAndSkills === "string"
    ? job.tagsAndSkills.split(",").map((s: string) => s.trim()).filter(Boolean)
    : [];

  const salary = job.salary_raw
    || (job.salaryDetail && !job.salaryDetail.hideSalary && job.salaryDetail.maximumSalary > 0
      ? `${job.salaryDetail.currency} ${job.salaryDetail.minimumSalary.toLocaleString()}–${job.salaryDetail.maximumSalary.toLocaleString()}`
      : null);

  const experience = job.experience_text
    || job.experienceText
    || (job.min_experience != null && job.max_experience != null
      ? `${job.min_experience}–${job.max_experience} yrs`
      : null);

  const employmentType = Array.isArray(job.employment_type)
    ? job.employment_type.join(", ")
    : job.employment_type || null;

  const datePosted = job.date_posted
    ? new Date(job.date_posted).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;

  const contactCount = job.contacts_count || (job.company_contacts || []).length || contacts.length;
  const emailCount = emails.length;

  const tabs: { id: ModalTab; label: string }[] = [
    { id: "details", label: "Job Details" },
    { id: "contacts", label: `ICPs${contactCount > 0 ? ` (${contactCount})` : ""}` },
    { id: "emails", label: `Emails${emailCount > 0 ? ` (${emailCount})` : ""}` },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-start gap-3 min-w-0">
            {job.organization_logo && (
              <img
                src={job.organization_logo}
                alt=""
                className="w-10 h-10 rounded-lg border border-slate-100 object-contain shrink-0 bg-white"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 leading-tight">{job.title || "Untitled"}</h2>
              <p className="text-sm text-slate-500 mt-0.5">{job.organization || "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${sourceColor}`}>
              {source || "unknown"}
            </span>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-slate-100 bg-slate-50">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === id
                  ? "border-brand-primary text-brand-primary"
                  : "border-transparent text-slate-500 hover:text-brand-secondary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">

          {/* ── Details tab ──────────────────────────────────────────── */}
          {activeTab === "details" && (
            <div className="px-6 py-5 space-y-5">
              {/* Quick stats chips */}
              <div className="flex flex-wrap gap-2">
                {job.display_location && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                    📍 {job.display_location}
                  </span>
                )}
                {datePosted && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                    📅 {datePosted}
                  </span>
                )}
                {experience && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                    🎯 {experience}
                  </span>
                )}
                {employmentType && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                    💼 {employmentType}
                  </span>
                )}
                {salary && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                    💰 {salary}
                  </span>
                )}
                {job.remote_derived && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
                    🌐 Remote
                  </span>
                )}
                {job.company_rating && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                    ⭐ {job.company_rating} company rating
                  </span>
                )}
              </div>

              {/* Skills */}
              {skills.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map((skill, i) => (
                      <span key={i} className="text-xs bg-brand-primary/5 text-brand-primary border border-brand-primary/20 rounded px-2 py-0.5">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              {job.description_text && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Description</p>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line line-clamp-[12]">
                    {job.description_text}
                  </p>
                </div>
              )}

              {/* Links */}
              <div className="grid grid-cols-1 gap-3">
                <LinkField label="Job Listing" value={job.listing_url || job.url || job.jdURL} />
                <LinkField label="Apply URL" value={job.apply_url !== (job.listing_url || job.url) ? job.apply_url : null} />
                <LinkField label="Company Page" value={job.organization_url || job.companyJobsUrl} />
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Job ID" value={job.id || job.jobId} />
                <Field label="Source Domain" value={job.source_domain} />
                <Field label="Company Domain" value={job.domain_derived} />
                <Field label="Work Arrangement" value={job.ai_work_arrangement} />
                <Field label="Experience Level" value={job.experience_level} />
                <Field label="Sector" value={job.sector} />
                <Field label="Work Type" value={job.work_type} />
                <Field label="Applications" value={job.applications_count} />
                <Field label="Date Modified" value={job.date_modified} />
                <Field label="Company Slug" value={job.company_slug} />
              </div>

              {/* LinkedIn poster info */}
              {(job.poster_name || job.poster_profile_url) && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Posted By</p>
                  <div className="flex items-center gap-2 text-sm">
                    {job.poster_name && <span className="text-slate-700 font-medium">{job.poster_name}</span>}
                    {job.poster_profile_url && (
                      <a href={job.poster_profile_url} target="_blank" rel="noopener noreferrer"
                        className="text-brand-primary hover:underline text-xs">
                        LinkedIn ↗
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Raw JSON toggle */}
              <div>
                <button
                  onClick={() => setShowRaw((v) => !v)}
                  className="text-xs text-slate-400 hover:text-slate-600 underline decoration-dashed"
                >
                  {showRaw ? "hide" : "show"} raw payload
                </button>
                {showRaw && (
                  <pre className="mt-2 bg-slate-950 text-slate-300 rounded-lg p-4 text-xs overflow-auto max-h-72 font-mono whitespace-pre-wrap">
                    {JSON.stringify(job.raw_payload || job, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* ── Contacts / ICPs tab ───────────────────────────────────── */}
          {activeTab === "contacts" && (
            <div>
              {peopleLoading ? (
                <div className="px-6 py-12 text-center text-sm text-slate-400">Loading contacts...</div>
              ) : contacts.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <p className="text-sm text-slate-400">No contacts found for this company.</p>
                  <p className="text-xs text-slate-300 mt-1">Run the pipeline to discover ICPs.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {contacts.map((c, i) => (
                    <div key={i} className="px-6 py-4">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-sm font-semibold text-slate-500">
                            {(c.name || "?")[0]?.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-800">{c.name || "—"}</p>
                            {c.email && (
                              <span className="text-xs font-mono text-green-700 bg-green-50 px-2 py-0.5 rounded">
                                {c.email}
                              </span>
                            )}
                            {!c.email && (
                              <span className="text-xs text-slate-300">No email</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{c.title || "—"}</p>
                          {c.icp_reason && (
                            <p className="text-xs text-slate-400 italic mt-1">{c.icp_reason}</p>
                          )}
                          {(c.seniority || c.department) && (
                            <div className="flex gap-2 mt-1.5">
                              {c.seniority && (
                                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">{c.seniority}</span>
                              )}
                              {c.department && (
                                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">{c.department}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                          {c.linkedin_url && (
                            <a
                              href={c.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-sky-600 hover:underline"
                            >
                              LinkedIn ↗
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Emails tab ────────────────────────────────────────────── */}
          {activeTab === "emails" && (
            <div>
              {peopleLoading ? (
                <div className="px-6 py-12 text-center text-sm text-slate-400">Loading emails...</div>
              ) : emails.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <p className="text-sm text-slate-400">No emails generated for this company yet.</p>
                  <p className="text-xs text-slate-300 mt-1">Run the pipeline with email generation enabled.</p>
                  <button
                    onClick={handleGenerateEmail}
                    disabled={generating}
                    className="mt-4 px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {generating ? "Generating…" : "Generate Email"}
                  </button>
                  {generateError && (
                    <p className="mt-3 text-xs text-red-500">{generateError}</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="px-6 py-3 flex items-center justify-between border-b border-slate-100 bg-slate-50">
                    <p className="text-xs text-slate-400">{emails.length} email{emails.length !== 1 ? "s" : ""} generated</p>
                    <button
                      onClick={handleGenerateEmail}
                      disabled={generating}
                      className="px-3 py-1.5 bg-brand-primary text-white rounded-lg text-xs font-medium hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {generating ? "Generating…" : "+ Generate Email"}
                    </button>
                  </div>
                  {generateError && (
                    <p className="px-6 py-2 text-xs text-red-500 bg-red-50 border-b border-red-100">{generateError}</p>
                  )}
                <div className="divide-y divide-slate-100">
                  {emails.map((em, i) => (
                    <div key={i} className="px-6 py-4">
                      {/* Contact header */}
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-slate-500">
                            {(em.contact_name || "?")[0]?.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-800">{em.contact_name || "—"}</p>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              em.approved ? "bg-green-50 text-green-700" : "bg-red-50 text-red-500"
                            }`}>
                              {em.qa_status || (em.approved ? "passed" : "failed")}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">{em.contact_title} · {em.contact_email || "—"}</p>
                        </div>
                        <button
                          onClick={() => setExpandedEmail(expandedEmail === i ? null : i)}
                          className="text-xs text-brand-primary hover:underline flex-shrink-0"
                        >
                          {expandedEmail === i ? "Collapse" : "View email"}
                        </button>
                      </div>

                      {/* Subject lines */}
                      {em.subject_1 && (
                        <div className="ml-10 space-y-1 mb-2">
                          <p className="text-xs text-slate-700">
                            <span className="font-semibold text-slate-400">Subject: </span>{em.subject_1}
                          </p>
                          {em.subject_2 && (
                            <p className="text-xs text-slate-500">
                              <span className="font-semibold text-slate-400">Alt: </span>{em.subject_2}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Email body (expandable) */}
                      {expandedEmail === i && em.body && (
                        <pre className="ml-10 mt-2 text-xs text-slate-600 whitespace-pre-wrap font-sans bg-slate-50 rounded-lg px-3 py-3 border border-slate-100">
                          {em.body}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
                </>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex gap-2">
            {(job.listing_url || job.url || job.jdURL) && (
              <a
                href={job.listing_url || job.url || job.jdURL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-blue-800 transition-colors"
              >
                View Job ↗
              </a>
            )}
            {job.apply_url && job.apply_url !== (job.listing_url || job.url) && (
              <a
                href={job.apply_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 border border-brand-border text-brand-primary rounded-lg text-sm font-medium hover:bg-blue-50 transition-colors"
              >
                Apply ↗
              </a>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
