"use client";

import { apiFetch } from "@/utils/apiFetch";
import LoadingSpinner from "@/components/LoadingSpinner";

import { useState, useEffect, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";
const NEXT_API_BASE = "";

type Lead = {
  name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  icp_reason?: string;
  role_family?: string;
  confidence?: string;
  company_name?: string;
  company_key?: string;
  company_domain?: string;
  job_title?: string;
  // email gen fields (populated by pipeline)
  email_status?: "pending" | "generated" | "sent" | "failed";
  generated_subject?: string;
  generated_email?: string;
  instantly_sent?: boolean;
};

function IcpScoreBadge({ score }: { score: number }) {
  const color =
    score >= 200 ? "bg-brand-accent text-white" :
    score >= 150 ? "bg-blue-100 text-blue-700" :
    "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {score}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    generated: "bg-blue-50 text-blue-700 border-blue-200",
    sent: "bg-green-50 text-green-700 border-green-200",
    failed: "bg-red-50 text-red-600 border-red-200",
    pending: "bg-slate-50 text-slate-500 border-slate-200",
  };
  const labels: Record<string, string> = {
    generated: "Generated",
    sent: "Sent ✓",
    failed: "Failed",
    pending: "Pending",
  };
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${styles[status] || styles.pending}`}>
      {labels[status] || status}
    </span>
  );
}

export default function LeadsPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLead, setExpandedLead] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [sentStatus, setSentStatus] = useState<Record<string, boolean>>({});

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(`/api/companies?include_employees=true&page=1&page_size=200`).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setCompanies(data.companies || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // Flatten companies → leads
  const allLeads: (Lead & { _company_id: string; _company_name: string })[] = [];
  for (const company of companies) {
    const employees: Lead[] = company.employees || [];
    for (const emp of employees) {
      allLeads.push({
        ...emp,
        _company_id: company.id,
        _company_name: company.name || emp.company_name || "",
        company_domain: company.organization_domain || company.website_url || emp.company_domain,
      });
    }
  }

  const filtered = allLeads.filter((lead) => {
    const q = search.toLowerCase();
    return !q || [lead.name, lead.title, lead._company_name].some((f) => (f || "").toLowerCase().includes(q));
  });

  async function sendToInstantly(lead: Lead & { _company_name: string }) {
    const key = `${lead.email}-${lead._company_name}`;
    setSending((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await apiFetch(`/api/jobs/instantly`, {
        method: "POST",
        body: JSON.stringify({
          jobs: [{
            organization: lead._company_name,
            domain_derived: lead.company_domain,
            title: lead.job_title || lead.title,
            company_contacts: [lead],
          }],
        }),
      });
      if (res.ok) {
        setSentStatus((prev) => ({ ...prev, [key]: true }));
      }
    } finally {
      setSending((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-brand-secondary">Leads</h1>
            <p className="text-slate-500 text-sm mt-0.5">{filtered.length} ICP contacts identified</p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search name, title, company..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-2 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary w-64"
            />
            <button
              onClick={fetchLeads}
              className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-blue-800 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          {loading ? (
            <LoadingSpinner label="Loading leads..." />
          ) : filtered.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-slate-400 text-sm">No leads yet.</p>
              <a href="/pipeline" className="text-brand-primary text-sm mt-2 inline-block hover:underline">
                Run the pipeline to generate leads →
              </a>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-border bg-slate-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {filtered.map((lead, i) => {
                  const key = `${lead.email}-${lead._company_name}`;
                  const isExpanded = expandedLead === key;
                  const isSent = sentStatus[key] || lead.instantly_sent;
                  const isSending = sending[key];
                  const emailStatus = isSent ? "sent" : lead.email_status || (lead.generated_email ? "generated" : "pending");

                  return (
                    <>
                      <tr key={`row-${i}`} className={`transition-colors ${isExpanded ? "bg-blue-50/50" : "hover:bg-slate-50"}`}>
                        <td className="px-4 py-3 font-medium text-brand-secondary">
                          <div className="flex items-center gap-2">
                            {lead.linkedin_url && (
                              <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700" title="LinkedIn">
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                                </svg>
                              </a>
                            )}
                            <span className="truncate max-w-[140px]">{lead.name || "—"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 truncate max-w-[180px]">{lead.title || "—"}</td>
                        <td className="px-4 py-3 text-slate-500 truncate max-w-[160px]">{lead._company_name || "—"}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-[180px]">{lead.email || "—"}</td>
                        <td className="px-4 py-3"><StatusBadge status={emailStatus} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {lead.generated_email && (
                              <button
                                onClick={() => setExpandedLead(isExpanded ? null : key)}
                                className="text-xs px-2.5 py-1.5 border border-brand-border rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
                              >
                                {isExpanded ? "Hide Email" : "Preview Email"}
                              </button>
                            )}
                            {!isSent && lead.email && (
                              <button
                                onClick={() => sendToInstantly(lead)}
                                disabled={isSending}
                                className="text-xs px-2.5 py-1.5 bg-brand-primary text-white rounded-lg hover:bg-blue-800 transition-colors disabled:opacity-50"
                              >
                                {isSending ? "Sending..." : "Send →"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && lead.generated_email && (
                        <tr key={`expanded-${i}`}>
                          <td colSpan={6} className="px-6 py-4 bg-blue-50/30 border-b border-brand-border">
                            {lead.generated_subject && (
                              <p className="text-xs font-semibold text-slate-600 mb-2">
                                Subject: <span className="font-normal text-slate-700">{lead.generated_subject}</span>
                              </p>
                            )}
                            <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed bg-white border border-brand-border rounded-lg p-4 max-h-48 overflow-auto">
                              {lead.generated_email}
                            </pre>
                            {lead.icp_reason && (
                              <p className="text-xs text-slate-400 mt-2 italic">{lead.icp_reason}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
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
