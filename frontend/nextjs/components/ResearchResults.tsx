import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import Report from './ResearchBlocks/Report';
import { preprocessOrderedData } from '../utils/dataProcessing';
import { Data } from '../types/data';
import { CompanyCardGrid, CompanyData } from './CompanyCardGrid';

interface ResearchResultsProps {
  orderedData: Data[];
  answer: string;
  allLogs: any[];
  chatBoxSettings: any;
  handleClickSuggestion: (value: string) => void;
  currentResearchId?: string;
  isProcessingChat?: boolean;
  onShareClick?: () => void;
  isLoading?: boolean;
}

type ApolloLead = {
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  organizationDomain?: string;
  organizationId?: string;
  companyName?: string;
};

type ApolloDebugPayload = {
  endpoint?: string;
  payload?: Record<string, unknown>;
  response?: Record<string, unknown>;
  note?: string;
  [key: string]: unknown;
};

type ApolloBulkMatch = {
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
};

type CompanyStatus = {
  exists: boolean;
  hasEmployees: boolean;
  statusLabel: string;
};

export const ResearchResults: React.FC<ResearchResultsProps> = ({
  orderedData,
  answer,
  allLogs,
  chatBoxSettings,
  handleClickSuggestion,
  currentResearchId,
  isProcessingChat = false,
  onShareClick,
  isLoading = false
}) => {
  const [isApolloModalOpen, setIsApolloModalOpen] = useState(false);
  const [apolloLeads, setApolloLeads] = useState<ApolloLead[]>([]);
  const [apolloCompany, setApolloCompany] = useState('');
  const [apolloError, setApolloError] = useState('');
  const [isApolloLoading, setIsApolloLoading] = useState(false);
  const [apolloDebug, setApolloDebug] = useState<ApolloDebugPayload | null>(null);
  const [showApolloDebug, setShowApolloDebug] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());
  const [enrichedCompanies, setEnrichedCompanies] = useState<CompanyData[]>([]);
  const [companyIdMap, setCompanyIdMap] = useState<Record<string, string>>({});
  const [isPortfolioLoading, setIsPortfolioLoading] = useState(false);
  const [isTitleModalOpen, setIsTitleModalOpen] = useState(false);
  const [companyStatuses, setCompanyStatuses] = useState<Record<string, CompanyStatus>>({});
  const [savedCompanyKeys, setSavedCompanyKeys] = useState<Set<string>>(new Set());
  const [apolloTitleInput, setApolloTitleInput] = useState(
    'Partner, General Partner, Managing Director, Investment Principal, Associate'
  );
  const [pendingCompanies, setPendingCompanies] = useState<CompanyData[]>([]);
  const normalizeDomain = (value?: string) => {
    if (!value) {
      return '';
    }
    try {
      const parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
      return parsed.hostname.replace(/^www\./, '');
    } catch (error) {
      return value.replace(/^www\./, '');
    }
  };

  const makeCompanyKey = (company: CompanyData) => {
    return normalizeDomain(company.websiteUrl) || company.name;
  };
  const groupedData = preprocessOrderedData(orderedData);
  const finalReport = groupedData
    .filter(data => data.type === 'reportBlock')
    .pop();
  const reportContent = finalReport?.content || answer || '';
  const companyResults = useMemo(() => {
    const attemptParseJson = (rawValue: string) => {
      if (!rawValue?.trim()) {
        return null;
      }

      try {
        return JSON.parse(rawValue);
      } catch (error) {
        const codeBlockMatch = rawValue.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (!codeBlockMatch?.[1]) {
          return null;
        }

        try {
          return JSON.parse(codeBlockMatch[1]);
        } catch (innerError) {
          return null;
        }
      }
    };

    const normalizePortfolioCompanies = (value: unknown) => {
      if (!value) {
        return undefined;
      }

      if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
      }

      if (typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }

      return undefined;
    };

    const normalizeCompany = (company: Record<string, unknown>): CompanyData | null => {
      const name = String(company.Name ?? company.name ?? '').trim();
      if (!name) {
        return null;
      }

      const portfolioCompanies = normalizePortfolioCompanies(
        company['Portfolio Companies'] ??
          company.portfolio_companies ??
          company.portfolioCompanies
      );

      return {
        name,
        websiteUrl: String(
          company['Website URL'] ?? company.website_url ?? company.websiteUrl ?? ''
        ).trim() || undefined,
        linkedinUrl: String(
          company['LinkedIn URL'] ?? company.linkedin_url ?? company.linkedinUrl ?? ''
        ).trim() || undefined,
        portfolioCompanies,
        hq: String(company.HQ ?? company.hq ?? company.headquarters ?? '').trim() || undefined,
        source: String(
          company.Source ??
            company.source ??
            company.source_url ??
            company.sourceUrl ??
            company['Source URL'] ??
            ''
        ).trim() || undefined,
      };
    };

    const parsedPayload = attemptParseJson(reportContent);
    if (!parsedPayload) {
      return [];
    }

    const collection = Array.isArray(parsedPayload)
      ? parsedPayload
      : parsedPayload?.companies ?? parsedPayload?.results ?? parsedPayload?.data;

    if (!Array.isArray(collection)) {
      return [];
    }

    const unique = new Set<string>();
    return collection
      .map((company: Record<string, unknown>) => normalizeCompany(company))
      .filter((company): company is CompanyData => !!company)
      .filter((company) => {
        const key = normalizeDomain(company.websiteUrl) || company.name.toLowerCase();
        if (unique.has(key)) {
          return false;
        }
        unique.add(key);
        return true;
      });
  }, [reportContent]);
  const showReport = !isLoading && companyResults.length === 0;
  const apiBaseUrl = process.env.NEXT_PUBLIC_GPTR_API_URL || 'http://localhost:8000';
  const displayCompanies = enrichedCompanies.length ? enrichedCompanies : companyResults;

  const allSelected =
    displayCompanies.length > 0 &&
    displayCompanies.every((company) => selectedCompanies.has(company.name));

  React.useEffect(() => {
    setSelectedCompanies(new Set());
  }, [companyResults]);

  useEffect(() => {
    setCompanyStatuses({});
    setSavedCompanyKeys(new Set());
  }, [companyResults]);

  useEffect(() => {
    setEnrichedCompanies(companyResults);
  }, [companyResults]);

  const saveCompany = async (company: CompanyData) => {
    try {
      const companyKey = makeCompanyKey(company);
      if (savedCompanyKeys.has(companyKey)) {
        return;
      }
      const payload = {
        id: company.companyId,
        name: company.name,
        website_url: company.websiteUrl,
        linkedin_url: company.linkedinUrl,
        portfolio_companies: company.portfolioCompanies,
        hq: company.hq,
        source: company.source,
        apollo_org_id: company.apolloOrgId,
        organization_domain: normalizeDomain(company.organizationDomain || company.websiteUrl),
      };
      const response = await fetch(`${apiBaseUrl}/api/companies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const companyId = data?.id;
      const existing = Boolean(data?.existing);
      const employeesCount = typeof data?.employees_count === 'number' ? data.employees_count : 0;
      if (!companyId) {
        return;
      }
      setCompanyIdMap((prev) => ({
        ...prev,
        [makeCompanyKey(company)]: companyId,
      }));
      setEnrichedCompanies((prev) =>
        prev.map((item) =>
          item.name === company.name ? { ...item, companyId } : item
        )
      );
      setCompanyStatuses((prev) => ({
        ...prev,
        [company.name]: {
          exists: existing,
          hasEmployees: employeesCount > 0,
          statusLabel: existing ? 'Already saved' : 'New',
        },
      }));
      setSavedCompanyKeys((prev) => {
        const next = new Set(prev);
        next.add(companyKey);
        return next;
      });
    } catch (error) {
      return;
    }
  };

  useEffect(() => {
    if (!enrichedCompanies.length) {
      return;
    }
    enrichedCompanies.forEach((company) => {
      void saveCompany(company);
    });
  }, [enrichedCompanies, savedCompanyKeys]);

  useEffect(() => {
    if (chatBoxSettings?.company_search_provider !== 'apollo') {
      return;
    }
    if (!companyResults.length) {
      return;
    }
    const companiesToEnrich = companyResults.map((company) => ({
      name: company.name,
      website_url: company.websiteUrl,
    }));
    const fetchPortfolioCompanies = async () => {
      try {
        setIsPortfolioLoading(true);
        const response = await fetch(`${apiBaseUrl}/api/companies/portfolio-search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ companies: companiesToEnrich }),
        });
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        setEnrichedCompanies((prev) =>
          prev.map((company) => {
            const match = results.find((item: any) => item.name === company.name);
            if (!match) {
              return company;
            }
            const portfolioCompanies = Array.isArray(match.portfolio_companies)
              ? match.portfolio_companies
              : company.portfolioCompanies;
            return {
              ...company,
              portfolioCompanies,
            };
          })
        );
      } catch (error) {
        return;
      } finally {
        setIsPortfolioLoading(false);
      }
    };

    void fetchPortfolioCompanies();
  }, [companyResults, chatBoxSettings?.company_search_provider]);

  const handleToggleSelect = (company: CompanyData) => {
    setSelectedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(company.name)) {
        next.delete(company.name);
      } else {
        next.add(company.name);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedCompanies(new Set());
      return;
    }

    setSelectedCompanies(new Set(displayCompanies.map((company) => company.name)));
  };

  const parseApolloTitles = (input: string) => {
    return input
      .split(',')
      .map((title) => title.trim())
      .filter(Boolean);
  };

  const normalizeCompanyKey = (value?: string) => {
    return value?.trim().toLowerCase() ?? '';
  };

  const titleOptions = [
    'Partner',
    'General Partner',
    'Managing Director',
    'Investment Principal',
    'Associate',
  ];

  const handleApolloSearch = async (companies: CompanyData[], titles?: string[]) => {
    const domains = companies
      .map((company) => company.websiteUrl || company.name)
      .filter(Boolean);

    if (!domains.length) {
      toast.error('Please select a company with a name or website URL.');
      return;
    }

    try {
      setIsApolloModalOpen(true);
      const companyLabel =
        companies.length === 1
          ? companies[0].name
          : `Bulk Enrichment (${companies.length} companies)`;
      setApolloCompany(companyLabel || 'Selected Companies');
      setApolloLeads([]);
      setApolloError('');
      setApolloDebug(null);
      setShowApolloDebug(false);
      setIsApolloLoading(true);
      setIsTitleModalOpen(false);
      const requestUrl = `${apiBaseUrl}/api/apollo/leads`;
      const requestPayload = {
        domains,
        titles: titles && titles.length ? titles : undefined,
      };
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const errorPayload = await response.json();
        throw new Error(errorPayload?.error || 'Apollo search failed.');
      }

      const data = await response.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      const bulkDebug = data?.debug?.bulk_match as ApolloDebugPayload | undefined;
      if (bulkDebug) {
        setApolloDebug(bulkDebug);
      }
      const leads = results
        .map((lead: Record<string, string>) => {
          const first = lead['First Name']?.trim() || '';
          const last = lead['Last Name']?.trim() || '';
          const combined = `${first} ${last}`.trim();
          const name =
            combined ||
            lead.name ||
            lead.full_name ||
            lead.Email ||
            lead.email ||
            lead['LinkedIn URL'] ||
            lead.linkedin_url ||
            'Unknown Lead';
          const title = lead.Title || lead.title || lead.designation;
          const email =
            lead.Email ||
            lead.email ||
            lead['Work Email'] ||
            lead.work_email ||
            lead['Personal Email'] ||
            lead.personal_email;
          const phone = lead.Phone || lead.phone || lead.phone_number;
          const linkedinUrl =
            lead['LinkedIn URL'] ||
            lead.linkedin_url ||
            lead.linkedinUrl ||
            lead.linkedin;
          return {
            name,
            title,
            email,
            phone,
            linkedinUrl,
            organizationDomain:
              lead['Organization Domain'] || lead.organization_domain,
            organizationId: lead['Organization ID'] || lead.organization_id,
            companyName: lead.Company || lead.company,
          };
        })
        .filter((lead: ApolloLead | null): lead is ApolloLead => !!lead);
      const peopleResponses = data?.debug?.people_search?.responses;
      const debugLeads = Array.isArray(peopleResponses)
        ? peopleResponses
            .flatMap((response: any) => response?.people || [])
            .map((person: any) => {
              const first = person?.first_name || '';
              const last = person?.last_name || '';
              const combinedName = `${first} ${last}`.trim() || person?.name || 'Unknown Lead';
              const organization = person?.organization || {};
              return {
                name: combinedName,
                title: person?.title,
                email:
                  person?.email ||
                  person?.work_email ||
                  person?.personal_email ||
                  person?.email_address,
                phone: person?.phone_number,
                linkedinUrl: person?.linkedin_url || person?.linkedin,
                organizationDomain:
                  organization?.primary_domain || organization?.domain || organization?.website_url,
                organizationId: organization?.id,
                companyName: organization?.name,
              };
            })
        : [];
      const bulkMatches = Array.isArray(bulkDebug?.response?.matches)
        ? (bulkDebug?.response?.matches as ApolloBulkMatch[])
        : [];
      const bulkMatchLeads: ApolloLead[] = bulkMatches.map((match: ApolloBulkMatch) => {
        const combinedName = [match.first_name, match.last_name]
          .filter(Boolean)
          .join(' ')
          .trim();
        const fallbackCompany = companies.length === 1 ? companies[0] : undefined;
        return {
          name: combinedName || 'Unknown Lead',
          title: match.title,
          email: match.email,
          linkedinUrl: match.linkedin_url,
          companyName: fallbackCompany?.name,
          organizationDomain:
            fallbackCompany?.organizationDomain || fallbackCompany?.websiteUrl,
        };
      });
      const bulkMatchLookup = new Map(
        bulkMatchLeads.map((lead: ApolloLead) => [normalizeCompanyKey(lead.name), lead])
      );
      const leadsWithBulkMatch = leads.map((lead) => {
        const matched = bulkMatchLookup.get(normalizeCompanyKey(lead.name));
        return {
          ...lead,
          title: lead.title ?? matched?.title,
          email: lead.email ?? matched?.email,
          linkedinUrl: lead.linkedinUrl ?? matched?.linkedinUrl,
        };
      });
      const resolvedLeads = leadsWithBulkMatch.length
        ? leadsWithBulkMatch
        : bulkMatchLeads.length
        ? bulkMatchLeads
        : debugLeads;
      setApolloLeads(resolvedLeads);
      const companyLookup = new Map<string, string>();
      const fallbackCompanyId =
        companies.length === 1
          ? companies[0].companyId || companyIdMap[makeCompanyKey(companies[0])]
          : undefined;
      companies.forEach((company) => {
        const companyId = company.companyId || companyIdMap[makeCompanyKey(company)];
        if (!companyId) {
          return;
        }
        companyLookup.set(normalizeCompanyKey(company.name), companyId);
        const domainKey = normalizeDomain(company.organizationDomain || company.websiteUrl);
        if (domainKey) {
          companyLookup.set(normalizeCompanyKey(domainKey), companyId);
        }
      });
      const employeesByCompanyId = new Map<string, ApolloLead[]>();
      resolvedLeads.forEach((lead: ApolloLead) => {
        const domainKey = normalizeCompanyKey(
          normalizeDomain(lead.organizationDomain)
        );
        const companyKey = normalizeCompanyKey(lead.companyName);
        const companyId =
          companyLookup.get(domainKey) ||
          companyLookup.get(companyKey) ||
          (domainKey ? companyIdMap[domainKey] : undefined) ||
          (companyKey ? companyIdMap[companyKey] : undefined) ||
          fallbackCompanyId;
        if (!companyId) {
          return;
        }
        const existing = employeesByCompanyId.get(companyId) || [];
        employeesByCompanyId.set(companyId, [...existing, lead]);
      });
      await Promise.all(
        Array.from(employeesByCompanyId.entries()).map(async ([companyId, employees]) => {
          await fetch(`${apiBaseUrl}/api/companies/${companyId}/employees`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              employees: employees.map((employee) => ({
                name: employee.name,
                title: employee.title,
                email: employee.email,
                phone: employee.phone,
                linkedin_url: employee.linkedinUrl,
              })),
            }),
          });
        })
      );
      const updatedCompanyIds = new Set(employeesByCompanyId.keys());
      if (updatedCompanyIds.size) {
        setCompanyStatuses((prev) => {
          const next = { ...prev };
          companies.forEach((company) => {
            const companyId = company.companyId || companyIdMap[makeCompanyKey(company)];
            if (!companyId || !updatedCompanyIds.has(companyId)) {
              return;
            }
            const existingStatus = next[company.name];
            next[company.name] = {
              exists: existingStatus?.exists ?? false,
              hasEmployees: true,
              statusLabel: existingStatus?.statusLabel ?? 'New',
            };
          });
          return next;
        });
      }
      const apolloUpdates = resolvedLeads
        .map((lead: ApolloLead) => {
          const domainKey = normalizeCompanyKey(
            normalizeDomain(lead.organizationDomain)
          );
          const companyKey = normalizeCompanyKey(lead.companyName);
          const companyId =
            companyLookup.get(domainKey) ||
            companyLookup.get(companyKey) ||
            (domainKey ? companyIdMap[domainKey] : undefined) ||
            (companyKey ? companyIdMap[companyKey] : undefined) ||
            fallbackCompanyId;
          if (!companyId || !lead.organizationId) {
            return null;
          }
          return { id: companyId, apollo_org_id: lead.organizationId };
        })
        .filter(Boolean) as { id: string; apollo_org_id: string }[];
      await Promise.all(
        apolloUpdates.map(async (payload) => {
          await fetch(`${apiBaseUrl}/api/companies`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });
        })
      );
      toast.success(`Apollo search complete for ${companyLabel}.`);
    } catch (error) {
      console.error('Apollo search error:', error);
      toast.error('Apollo search failed. Check the console for details.');
      setApolloError(
        error instanceof Error ? error.message : 'Apollo search failed.'
      );
    } finally {
      setIsApolloLoading(false);
    }
  };

  const handleSelectCompany = (company: CompanyData) => {
    setPendingCompanies([company]);
    setIsTitleModalOpen(true);
  };

  const handleBulkEnrich = () => {
    const selected = displayCompanies.filter((company) =>
      selectedCompanies.has(company.name)
    );

    if (!selected.length) {
      toast.error('Select at least one company to enrich.');
      return;
    }

    setPendingCompanies(selected);
    setIsTitleModalOpen(true);
  };

  const handleTitleModalSubmit = async () => {
    const titles = parseApolloTitles(apolloTitleInput);
    if (!pendingCompanies.length) {
      setIsTitleModalOpen(false);
      return;
    }
    await handleApolloSearch(pendingCompanies, titles);
    setPendingCompanies([]);
    setIsTitleModalOpen(false);
  };

  const progressUpdates = useMemo(() => {
    return orderedData
      .filter((item: any) => item?.type === 'logs')
      .map((item: any) => {
        if (typeof item?.output === 'string' && item.output.trim()) {
          return item.output.trim();
        }
        if (typeof item?.content === 'string' && item.content.trim()) {
          return item.content.trim();
        }
        return '';
      })
      .filter(Boolean)
      .slice(-4);
  }, [orderedData]);

  const showProgressPopup = isLoading && companyResults.length === 0;

  return (
    <>
      <CompanyCardGrid
        companies={displayCompanies}
        onSelectCompany={handleSelectCompany}
        selectedCompanies={selectedCompanies}
        onToggleSelect={handleToggleSelect}
        onToggleSelectAll={handleToggleSelectAll}
        onBulkEnrich={handleBulkEnrich}
        isLoading={isLoading || isPortfolioLoading}
        companyStatuses={companyStatuses}
      />
      {showProgressPopup && (
        <div className="fixed bottom-6 right-6 z-40 w-full max-w-sm rounded-2xl border border-slate-700/70 bg-slate-950/90 p-4 text-xs text-slate-200 shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
            Discovery running
          </p>
          <p className="mt-1 text-sm text-slate-300">
            We’re tracking companies and verifying sources.
          </p>
          <div className="mt-3 space-y-2">
            {progressUpdates.length > 0 ? (
              progressUpdates.map((update, index) => (
                <p key={`${update}-${index}`} className="text-xs text-slate-400">
                  {update}
                </p>
              ))
            ) : (
              <p className="text-xs text-slate-400">
                Searching for matching firms and validating details.
              </p>
            )}
          </div>
        </div>
      )}
      {isTitleModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setIsTitleModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-700/60 bg-slate-950 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Select roles to enrich</h3>
                <p className="text-sm text-slate-400">
                  {pendingCompanies.length
                    ? `Targeting ${pendingCompanies.length} company${pendingCompanies.length > 1 ? 'ies' : ''}`
                    : 'Choose Apollo titles'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTitleModalOpen(false)}
                className="rounded-full border border-slate-700/70 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Titles
                </label>
                <textarea
                  value={apolloTitleInput}
                  onChange={(event) => setApolloTitleInput(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  rows={3}
                />
                <p className="mt-2 text-[11px] text-slate-500">Separate titles with commas.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {titleOptions.map((title) => (
                  <button
                    key={title}
                    type="button"
                    onClick={() => {
                      const titles = parseApolloTitles(apolloTitleInput);
                      if (!titles.includes(title)) {
                        setApolloTitleInput([...titles, title].join(', '));
                      }
                    }}
                    className="rounded-full border border-slate-700/80 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                  >
                    {title}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsTitleModalOpen(false)}
                  className="rounded-lg border border-slate-700/70 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleTitleModalSubmit}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
                >
                  Start Apollo enrichment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isApolloModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setIsApolloModalOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-950 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Apollo Leads</h3>
                <p className="text-sm text-slate-400">{apolloCompany}</p>
              </div>
              <div className="flex items-center gap-2">
                {apolloDebug && (
                  <button
                    type="button"
                    onClick={() => setShowApolloDebug((prev) => !prev)}
                    className="rounded-full border border-teal-200/40 px-3 py-1 text-xs font-semibold text-teal-100 transition hover:bg-teal-200/10"
                  >
                    {showApolloDebug ? 'Hide debug' : 'Show debug'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsApolloModalOpen(false)}
                  className="rounded-full border border-slate-700/70 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {isApolloLoading && (
                <p className="text-sm text-slate-300">Fetching leads...</p>
              )}
              {!isApolloLoading && apolloError && (
                <p className="text-sm text-rose-300">{apolloError}</p>
              )}
              {!isApolloLoading && !apolloError && apolloLeads.length === 0 && (
                <p className="text-sm text-slate-400">No leads returned.</p>
              )}
              {!isApolloLoading && apolloLeads.length > 0 && (
                <ul className="space-y-3">
                  {apolloLeads.map((lead: ApolloLead, index: number) => (
                    <li
                      key={`${lead.name}-${index}`}
                      className="rounded-lg border border-slate-800/80 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
                    >
                      <p className="text-sm font-semibold text-white">{lead.name}</p>
                      {lead.title && (
                        <p className="text-xs text-slate-300">{lead.title}</p>
                      )}
                      <div className="mt-2 space-y-1 text-xs text-slate-300">
                        {lead.email && <p>Email: {lead.email}</p>}
                        {lead.phone && <p>Number: {lead.phone}</p>}
                        {lead.linkedinUrl && (
                          <a
                            href={lead.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-teal-200 underline-offset-4 hover:underline"
                          >
                            LinkedIn
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!isApolloLoading && apolloDebug && showApolloDebug && (() => {
                const bulkResponse =
                  (apolloDebug.response as Record<string, unknown> | undefined) ?? {};
                const totalRequested = bulkResponse.total_requested_enrichments;
                const matches = Array.isArray(bulkResponse.matches)
                  ? (bulkResponse.matches as ApolloBulkMatch[])
                  : [];
                return (
                  <div className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-900/80 p-3 text-xs text-slate-200">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        Bulk enrichment response
                      </p>
                    </div>
                    <div className="space-y-1 text-xs text-slate-300">
                      <p>
                        Total requested enrichments:{' '}
                        <span className="font-semibold text-slate-100">
                          {typeof totalRequested === 'number' ? totalRequested : 'N/A'}
                        </span>
                      </p>
                    </div>
                    {matches.length > 0 ? (
                      <ul className="space-y-2">
                        {matches.map((match, index) => (
                          <li
                            key={`apollo-match-${index}`}
                            className="rounded-md border border-slate-800/80 bg-slate-950/70 p-2"
                          >
                            <p className="font-semibold text-slate-100">
                              {[match.first_name, match.last_name]
                                .filter(Boolean)
                                .join(' ') || 'Unknown lead'}
                            </p>
                            {match.title && (
                              <p className="text-[11px] text-slate-400">
                                {String(match.title)}
                              </p>
                            )}
                            <div className="mt-1 space-y-1 text-[11px] text-slate-300">
                              <p>Email: {match.email ? String(match.email) : 'N/A'}</p>
                              <p>
                                LinkedIn:{' '}
                                {match.linkedin_url ? (
                                  <a
                                    href={String(match.linkedin_url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-teal-200 underline-offset-4 hover:underline"
                                  >
                                    {String(match.linkedin_url)}
                                  </a>
                                ) : (
                                  'N/A'
                                )}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">
                        {JSON.stringify(bulkResponse, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      {showReport && (
        <Report
          answer={reportContent}
          researchId={currentResearchId}
          showHeader={false}
          title="Investor Details"
        />
      )}
    </>
  );
}; 