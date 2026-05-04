import React from "react";
import { Globe, ShieldCheck, Users } from "lucide-react";

export interface CompanyData {
  name: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  portfolioCompanies?: string[];
  hq?: string;
  source?: string;
  employees?: string | number;
  verifiedEmails?: string | number;
  companyId?: string;
  apolloOrgId?: string;
  organizationDomain?: string;
}

interface CompanyCardGridProps {
  companies: CompanyData[];
  onSelectCompany?: (company: CompanyData) => void;
  selectedCompanies?: Set<string>;
  onToggleSelect?: (company: CompanyData) => void;
  onToggleSelectAll?: () => void;
  onBulkEnrich?: () => void;
  isLoading?: boolean;
  companyStatuses?: Record<string, { statusLabel: string; exists: boolean; hasEmployees: boolean }>;
}

export const CompanyCardGrid: React.FC<CompanyCardGridProps> = ({
  companies,
  onSelectCompany,
  selectedCompanies,
  onToggleSelect,
  onToggleSelectAll,
  onBulkEnrich,
  isLoading = false,
  companyStatuses,
}) => {
  if (!companies.length && !isLoading) {
    return null;
  }

  const selectedCount = selectedCompanies?.size ?? 0;
  const allSelected =
    selectedCompanies &&
    companies.length > 0 &&
    companies.every((company) => selectedCompanies.has(company.name));
  const skeletonRows = Array.from({ length: 5 });

  return (
    <section className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
            Company Results
          </h2>
          <p className="text-xs text-slate-500">
            {companies.length} firms discovered
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            Selected: <span className="font-semibold text-slate-100">{selectedCount}</span>
          </span>
          <button
            type="button"
            onClick={onBulkEnrich}
            disabled={selectedCount === 0}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Bulk Enrich in Apollo
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-[0.2em] text-slate-400">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={!!allSelected}
                    onChange={onToggleSelectAll}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-500"
                  />
                </th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">HQ</th>
                <th className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-slate-500" />
                    Website
                  </div>
                </th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-slate-500" />
                    Employees
                  </div>
                </th>
                <th className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-slate-500" />
                    Verified Emails
                  </div>
                </th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {isLoading
                ? skeletonRows.map((_, index) => (
                    <tr key={`skeleton-${index}`} className="animate-pulse">
                      {Array.from({ length: 9 }).map((__, cellIndex) => (
                        <td key={cellIndex} className="px-4 py-3">
                          <div className="h-3 w-full rounded bg-slate-800/70"></div>
                        </td>
                      ))}
                    </tr>
                  ))
                : companies.map((company) => (
                    <tr key={company.name} className="hover:bg-slate-900/70">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedCompanies?.has(company.name) ?? false}
                          onChange={() => onToggleSelect?.(company)}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-semibold text-slate-100">
                            {company.name}
                          </p>
                          {company.linkedinUrl && (
                            <a
                              href={company.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-indigo-300 hover:underline"
                            >
                              LinkedIn
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        {company.hq || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {company.websiteUrl ? (
                          <a
                            href={company.websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-300 hover:underline"
                          >
                            {company.websiteUrl.replace(/^https?:\/\//, '')}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        {company.source || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        {company.employees ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        {company.verifiedEmails ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        {companyStatuses?.[company.name] ? (
                          <div className="space-y-1">
                            <span className="inline-flex items-center rounded-full border border-slate-700/60 bg-slate-900/60 px-2 py-0.5 text-[11px] font-semibold text-slate-200">
                              {companyStatuses[company.name].statusLabel}
                            </span>
                            <p className="text-[11px] text-slate-500">
                              {companyStatuses[company.name].hasEmployees
                                ? 'Employees stored'
                                : 'No employees yet'}
                            </p>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(() => {
                          const status = companyStatuses?.[company.name];
                          const buttonLabel = status?.hasEmployees
                            ? 'Update Employees'
                            : 'Enrich';
                          return (
                            <button
                              type="button"
                              onClick={() => onSelectCompany?.(company)}
                              className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/20"
                            >
                              {buttonLabel}
                            </button>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};