"use client";

import { apiFetch } from "@/utils/apiFetch";

import { useState, useEffect, useMemo } from "react";

const API_BASE = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  company_key: string;
  name: string;
  website_url?: string;
  linkedin_url?: string;
  organization_domain?: string;
  apollo_org_id?: string;
  hq?: string;
  source?: string;
  total_employees_count: number;
  icp_employees_count: number;
  employees_count: number;
  verified_emails_count: number;
  created_at: number;
  updated_at: number;
}

interface OutreachEntry {
  log_id: string;
  contact_key: string;
  company_key: string;
  contact_email?: string;
  contact_name?: string;
  contact_title?: string;
  company_name?: string;
  company_domain?: string;
  campaign_id?: string;
  sent_at: number;
  created_at: number;
}

interface CompanyOutreachStats {
  count: number;          // total outreach entries
  contacts: Set<string>;  // distinct contacts
  lastSent: number;       // most recent sent_at
  entries: OutreachEntry[];
}

type SortKey = "name" | "icp" | "employees" | "emails" | "contacted" | "last_contact" | "updated";
type FilterMode = "all" | "contacted" | "not_contacted";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(ts: number | undefined) {
  if (!ts) return "—";
  return new Date(ts < 1e12 ? ts * 1000 : ts).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function formatDomain(company: Company) {
  return company.organization_domain || company.website_url?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "—";
}

// ── Expanded row ───────────────────────────────────────────────────────────────

function ExpandedRow({ company, outreach }: { company: Company; outreach?: CompanyOutreachStats }) {
  const contactMap = new Map<string, OutreachEntry[]>();
  for (const e of outreach?.entries || []) {
    const key = e.contact_key;
    if (!contactMap.has(key)) contactMap.set(key, []);
    contactMap.get(key)!.push(e);
  }

  return (
    <tr>
      <td colSpan={9} className="bg-slate-50 px-6 py-4 border-b border-brand-border">
        <div className="grid grid-cols-3 gap-6">
          {/* Company details */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Details</p>
            <div className="space-y-1 text-xs text-slate-600">
              <p><span className="text-slate-400">Domain:</span> {formatDomain(company)}</p>
              <p><span className="text-slate-400">HQ:</span> {company.hq || "—"}</p>
              <p><span className="text-slate-400">Source:</span> {company.source || "—"}</p>
              {company.linkedin_url && (
                <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer"
                  className="text-brand-primary hover:underline">LinkedIn ↗</a>
              )}
              {company.website_url && (
                <a href={company.website_url} target="_blank" rel="noopener noreferrer"
                  className="ml-3 text-brand-primary hover:underline">Website ↗</a>
              )}
            </div>
          </div>

          {/* Enrichment stats */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Enrichment</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Total Employees", value: company.total_employees_count },
                { label: "ICP Contacts", value: company.icp_employees_count },
                { label: "Enriched", value: company.employees_count },
                { label: "Verified Emails", value: company.verified_emails_count },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white rounded-lg px-3 py-2 border border-slate-200">
                  <p className="text-lg font-bold text-brand-primary">{value}</p>
                  <p className="text-[10px] text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Outreach history */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Outreach History {outreach ? `(${outreach.count} sends)` : ""}
            </p>
            {!outreach || outreach.count === 0 ? (
              <p className="text-xs text-slate-400 italic">No outreach recorded.</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-auto">
                {Array.from(contactMap.entries()).map(([ck, entries]) => {
                  const latest = entries[entries.length - 1];
                  return (
                    <div key={ck} className="text-xs bg-white rounded border border-slate-200 px-3 py-2">
                      <p className="font-medium text-slate-700 truncate">{latest.contact_name || ck}</p>
                      {latest.contact_title && <p className="text-slate-400 truncate">{latest.contact_title}</p>}
                      <p className="text-slate-400 mt-0.5">
                        {entries.length}× sent · last {formatDate(latest.sent_at)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [outreachMap, setOutreachMap] = useState<Map<string, CompanyOutreachStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    fetchData();
  }, [page]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [compRes, outreachRes] = await Promise.all([
        apiFetch(`/api/companies?page=${page}&page_size=${PAGE_SIZE}`),
        apiFetch(`/api/outreach-log?limit=5000`),
      ]);

      if (!compRes.ok) throw new Error("Failed to load companies");
      const compData = await compRes.json();
      setCompanies(compData.companies || []);
      setTotalCompanies(compData.total || 0);

      // Build outreach map grouped by company_key
      const omap = new Map<string, CompanyOutreachStats>();
      if (outreachRes.ok) {
        const outreachData = await outreachRes.json();
        for (const entry of outreachData.entries || outreachData || []) {
          const ck = entry.company_key;
          if (!ck) continue;
          if (!omap.has(ck)) omap.set(ck, { count: 0, contacts: new Set(), lastSent: 0, entries: [] });
          const stats = omap.get(ck)!;
          stats.count++;
          stats.contacts.add(entry.contact_key);
          if (entry.sent_at > stats.lastSent) stats.lastSent = entry.sent_at;
          stats.entries.push(entry);
        }
      }
      setOutreachMap(omap);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    let list = companies;

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.name?.toLowerCase().includes(q) ||
        c.organization_domain?.toLowerCase().includes(q) ||
        c.hq?.toLowerCase().includes(q)
      );
    }

    // Contact filter
    if (filter === "contacted") list = list.filter((c) => outreachMap.has(c.company_key));
    if (filter === "not_contacted") list = list.filter((c) => !outreachMap.has(c.company_key));

    // Sort
    list = [...list].sort((a, b) => {
      let va: number | string = 0, vb: number | string = 0;
      switch (sort) {
        case "name": va = a.name || ""; vb = b.name || ""; break;
        case "icp": va = a.icp_employees_count; vb = b.icp_employees_count; break;
        case "employees": va = a.total_employees_count; vb = b.total_employees_count; break;
        case "emails": va = a.verified_emails_count; vb = b.verified_emails_count; break;
        case "contacted": va = outreachMap.get(a.company_key)?.count || 0; vb = outreachMap.get(b.company_key)?.count || 0; break;
        case "last_contact": va = outreachMap.get(a.company_key)?.lastSent || 0; vb = outreachMap.get(b.company_key)?.lastSent || 0; break;
        case "updated": va = a.updated_at; vb = b.updated_at; break;
      }
      if (typeof va === "string") return sortAsc ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });

    return list;
  }, [companies, outreachMap, search, filter, sort, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sort === key) setSortAsc((v) => !v);
    else { setSort(key); setSortAsc(false); }
  }

  function SortTh({ col, label }: { col: SortKey; label: string }) {
    const active = sort === col;
    return (
      <th
        className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-brand-secondary select-none whitespace-nowrap"
        onClick={() => toggleSort(col)}
      >
        {label}
        {active && <span className="ml-1 text-brand-primary">{sortAsc ? "↑" : "↓"}</span>}
      </th>
    );
  }

  const contactedCount = companies.filter((c) => outreachMap.has(c.company_key)).length;
  const totalPages = Math.ceil(totalCompanies / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-brand-secondary">Companies</h1>
            <p className="text-slate-500 text-sm mt-1">
              All enriched companies with ICP contacts and outreach history.
            </p>
          </div>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-primary border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Companies", value: totalCompanies },
            { label: "Contacted", value: contactedCount },
            { label: "Not Contacted", value: totalCompanies - contactedCount },
            { label: "Total Outreach Sends", value: Array.from(outreachMap.values()).reduce((s, v) => s + v.count, 0) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white border border-brand-border rounded-xl px-5 py-4 shadow-sm">
              <p className="text-2xl font-bold text-brand-primary">{value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white border border-brand-border rounded-xl px-5 py-4 mb-4 shadow-sm flex items-center gap-4">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, domain, or HQ..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setExpandedId(null); }}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
            />
          </div>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {([["all", "All"], ["contacted", "Contacted"], ["not_contacted", "Not Contacted"]] as [FilterMode, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFilter(val)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  filter === val ? "bg-white text-brand-secondary shadow-sm" : "text-slate-500 hover:text-brand-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 whitespace-nowrap">{filtered.length} shown</p>
        </div>

        {/* Table */}
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-slate-400">
              <svg className="animate-spin w-5 h-5 mr-2 text-brand-primary" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading companies...
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-red-500">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">
              No companies found.{" "}
              {filter !== "all" && <button onClick={() => setFilter("all")} className="text-brand-primary hover:underline">Clear filter</button>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-brand-border">
                  <tr>
                    <SortTh col="name" label="Company" />
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Domain</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">HQ</th>
                    <SortTh col="employees" label="Employees" />
                    <SortTh col="icp" label="ICP Contacts" />
                    <SortTh col="emails" label="Verified Emails" />
                    <SortTh col="contacted" label="Outreach Sends" />
                    <SortTh col="last_contact" label="Last Contacted" />
                    <SortTh col="updated" label="Updated" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {filtered.map((company) => {
                    const outreach = outreachMap.get(company.company_key);
                    const isExpanded = expandedId === company.id;
                    return (
                      <>
                        <tr
                          key={company.id}
                          onClick={() => setExpandedId(isExpanded ? null : company.id)}
                          className="hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          {/* Company name */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <svg className={`w-3.5 h-3.5 text-slate-300 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <div>
                                <p className="text-sm font-medium text-brand-secondary">{company.name || "—"}</p>
                              </div>
                            </div>
                          </td>

                          {/* Domain */}
                          <td className="px-4 py-3 text-xs text-slate-500 font-mono">{formatDomain(company)}</td>

                          {/* HQ */}
                          <td className="px-4 py-3 text-xs text-slate-500">{company.hq || "—"}</td>

                          {/* Employees */}
                          <td className="px-4 py-3 text-xs text-center">
                            <span className={`font-medium ${company.total_employees_count > 0 ? "text-slate-700" : "text-slate-300"}`}>
                              {company.total_employees_count > 0 ? company.total_employees_count.toLocaleString() : "—"}
                            </span>
                          </td>

                          {/* ICP contacts */}
                          <td className="px-4 py-3 text-center">
                            {company.icp_employees_count > 0 ? (
                              <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-xs font-semibold bg-brand-primary/10 text-brand-primary">
                                {company.icp_employees_count}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>

                          {/* Verified emails */}
                          <td className="px-4 py-3 text-center">
                            {company.verified_emails_count > 0 ? (
                              <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700">
                                {company.verified_emails_count}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>

                          {/* Outreach sends */}
                          <td className="px-4 py-3 text-center">
                            {outreach ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                                  {outreach.count}×
                                </span>
                                <span className="text-[10px] text-slate-400">{outreach.contacts.size} contact{outreach.contacts.size !== 1 ? "s" : ""}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>

                          {/* Last contacted */}
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {outreach ? formatDate(outreach.lastSent) : "—"}
                          </td>

                          {/* Updated */}
                          <td className="px-4 py-3 text-xs text-slate-400">
                            {formatDate(company.updated_at)}
                          </td>
                        </tr>
                        {isExpanded && (
                          <ExpandedRow key={`${company.id}-expanded`} company={company} outreach={outreach} />
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-slate-400">Page {page} of {totalPages} · {totalCompanies.toLocaleString()} total</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
