import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";

const PAGE_SIZE = 100;

type SavedEmployee = {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  icp_reason?: string;
  generated_email_text?: string;
  generated_email_subjects?: string[];
  instantly_sent?: boolean;
  instantly_sent_at?: string;
  instantly_campaign_id?: string;
  generated_instantly_payload?: Record<string, unknown>;
  generated_outreach_result?: Record<string, unknown>;
};

type SavedCompanySummary = {
  id: string;
  name: string;
  website_url?: string;
  linkedin_url?: string;
  organization_domain?: string;
  apollo_org_id?: string;
  portfolio_companies?: string[];
  hq?: string;
  source?: string;
  total_employees_count?: number;
  icp_employees_count?: number;
  instantly_sent_icp_count?: number;
  employees_count?: number;
  verified_emails_count?: number;
};

type SavedCompanyDetail = SavedCompanySummary & {
  organization_domain?: string;
  apollo_org_id?: string;
  employees?: SavedEmployee[];
  all_employees?: SavedEmployee[];
};

type EmailTarget = {
  employee: SavedEmployee;
  company?: Pick<
    SavedCompanyDetail,
    'name' | 'website_url' | 'linkedin_url' | 'hq' | 'source'
  >;
};

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
  payload?: unknown;
  response?: unknown;
  note?: string;
  [key: string]: unknown;
};

type ApolloLogBundle = {
  request?: {
    endpoint: string;
    payload: Record<string, unknown>;
  };
  people_search?: ApolloDebugPayload | null;
  bulk_match?: ApolloDebugPayload | null;
};

type ApolloBulkMatch = {
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
};

const LOCATION_OPTIONS = ["", "United States", "India", "United Arab Emirates"];

function employeeIdentity(employee: SavedEmployee) {
  return `${employee.email || ""}-${employee.linkedin_url || ""}-${employee.name || ""}-${employee.title || ""}`.toLowerCase();
}

function classifyEmployeeType(employee: SavedEmployee) {
  const title = String(employee.title || "").toLowerCase();
  if (title.includes("partner") || title.includes("principal") || title.includes("associate") || title.includes("invest")) {
    return "investment";
  }
  if (title.includes("platform") || title.includes("operating") || title.includes("operations")) {
    return "platform";
  }
  if (title.includes("talent") || title.includes("recruit")) {
    return "talent";
  }
  if (title.includes("head") || title.includes("director") || title.includes("vp")) {
    return "leadership";
  }
  return "other";
}

const SavedCompaniesTable = () => {
  const [companies, setCompanies] = useState<SavedCompanySummary[]>([]);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentPageSize, setCurrentPageSize] = useState(PAGE_SIZE);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [locationFilter, setLocationFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState<"all" | "with" | "without">("all");
  const [instantlyFilter, setInstantlyFilter] = useState<"all" | "sent" | "not_sent">("all");
  const [selectedCompany, setSelectedCompany] = useState<SavedCompanyDetail | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<"icps" | "all">("icps");
  const [allEmployeeTypeFilter, setAllEmployeeTypeFilter] = useState<"all" | "investment" | "platform" | "talent" | "leadership" | "other">("all");
  const [isApolloModalOpen, setIsApolloModalOpen] = useState(false);
  const [apolloLeads, setApolloLeads] = useState<ApolloLead[]>([]);
  const [apolloCompany, setApolloCompany] = useState("");
  const [apolloError, setApolloError] = useState("");
  const [isApolloLoading, setIsApolloLoading] = useState(false);
  const [isBulkSendingToInstantly, setIsBulkSendingToInstantly] = useState(false);
  const [apolloLogs, setApolloLogs] = useState<ApolloLogBundle | null>(null);
  const [showApolloDebug, setShowApolloDebug] = useState(false);
  const [apolloStatusMessage, setApolloStatusMessage] = useState("");
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [generatedEmail, setGeneratedEmail] = useState('');
  const [generatedInstantlyPayload, setGeneratedInstantlyPayload] = useState<Record<string, unknown> | null>(null);
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);
  const apiBaseUrl = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

  const fetchCompanies = useCallback(async (page: number = currentPage) => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams({
        include_employees: "false",
        page: String(page),
        page_size: String(PAGE_SIZE),
        employee_filter: employeeFilter,
      });
      if (locationFilter.trim()) {
        params.set("location_query", locationFilter.trim());
      }
      const response = await fetch(`${apiBaseUrl}/api/companies?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to load companies.");
      }
      const data = await response.json();
      const list = Array.isArray(data?.companies) ? data.companies : [];
      setCompanies(list);
      setTotalCompanies(typeof data?.total === "number" ? data.total : 0);
      setCurrentPage(typeof data?.page === "number" ? data.page : page);
      setCurrentPageSize(typeof data?.page_size === "number" ? data.page_size : PAGE_SIZE);
    } catch (error) {
      return;
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, currentPage, employeeFilter, locationFilter]);

  const persistCompany = useCallback(async (company: SavedCompanyDetail) => {
    const response = await fetch("/api/companies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(company),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Failed to update company.");
    }
    const nextCompany = data?.company ?? company;
    setSelectedCompany(nextCompany);
    await fetchCompanies(currentPage);
    return nextCompany as SavedCompanyDetail;
  }, [currentPage, fetchCompanies]);

  useEffect(() => {
    void fetchCompanies();
    const interval = window.setInterval(fetchCompanies, 30000);
    return () => window.clearInterval(interval);
  }, [fetchCompanies]);

  const filteredCompanies = useMemo(() => {
    if (instantlyFilter === "all") {
      return companies;
    }
    return companies.filter((company) =>
      instantlyFilter === "sent"
        ? Number(company.instantly_sent_icp_count || 0) > 0
        : Number(company.instantly_sent_icp_count || 0) === 0
    );
  }, [companies, instantlyFilter]);

  useEffect(() => {
    setSelectedCompanyIds((current) => current.filter((id) => filteredCompanies.some((company) => company.id === id)));
  }, [filteredCompanies]);

  const selectedCompanyIdSet = useMemo(() => new Set(selectedCompanyIds), [selectedCompanyIds]);
  const allVisibleSelected =
    filteredCompanies.length > 0 && filteredCompanies.every((company) => selectedCompanyIdSet.has(company.id));

  const handleOpenDetails = async (company: SavedCompanySummary) => {
    setIsDetailOpen(true);
    setIsDetailLoading(true);
    setDetailTab("icps");
    setAllEmployeeTypeFilter("all");
    setSelectedCompany(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/companies/${company.id}`);
      if (!response.ok) {
        throw new Error("Failed to load company details.");
      }
      const data = await response.json();
      setSelectedCompany(data?.company ?? null);
    } catch (error) {
      setSelectedCompany(null);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleCloseEmailModal = () => {
    setIsEmailModalOpen(false);
    setIsEmailLoading(false);
    setEmailError('');
    setGeneratedEmail('');
    setGeneratedInstantlyPayload(null);
    setEmailTarget(null);
  };

  const normalizeDomain = (value?: string) => {
    if (!value) {
      return "";
    }
    try {
      const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
      return parsed.hostname.replace(/^www\./, "");
    } catch {
      return value.replace(/^www\./, "");
    }
  };

  const handleApolloSearch = async (company: SavedCompanySummary) => {
    const domains = [
      normalizeDomain(company.organization_domain),
      normalizeDomain(company.website_url),
    ]
      .filter((value) => value && value.includes("."))
      .filter((value, index, values) => values.indexOf(value) === index);

    if (!domains.length) {
      const message = "This company needs a valid website or organization domain before Apollo employee enrichment can run.";
      setApolloError(message);
      setApolloLogs({
        request: {
          endpoint: `${apiBaseUrl}/api/companies/${company.id}/apollo-employees`,
          payload: {
            domains: [],
            strategy: "Fetch all employees, then shortlist the best investor contacts.",
            company_name: company.name,
          },
        },
        people_search: {
          note: "Apollo request was not sent because no valid domain was available.",
        },
        bulk_match: {
          note: "Bulk match did not run because people search was skipped.",
        },
      });
      setIsApolloModalOpen(true);
      setApolloCompany(company.name || "Selected Company");
      setShowApolloDebug(true);
      setApolloStatusMessage(message);
      toast.error(message);
      return;
    }

    try {
      setIsApolloModalOpen(true);
      setApolloCompany(company.name || "Selected Company");
      setApolloLeads([]);
      setApolloError("");
      setApolloLogs(null);
      setShowApolloDebug(false);
      setIsApolloLoading(true);
      const requestPayload = {
        strategy: "Fetch all employees, then shortlist the best investor contacts.",
      };
      setApolloStatusMessage("Fetching all employees from Apollo.");
      setApolloLogs({
        request: {
          endpoint: `${apiBaseUrl}/api/companies/${company.id}/apollo-employees`,
          payload: requestPayload,
        },
        people_search: {
          note: "Fetching all employees from Apollo and ranking the best investor contacts...",
        },
        bulk_match: {
          note: "Saving shortlisted Apollo contacts back to this company...",
        },
      });

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 60000);
      const response = await fetch(`${apiBaseUrl}/api/companies/${company.id}/apollo-employees`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      if (!response.ok) {
        const errorPayload = await response.json();
        throw new Error(errorPayload?.error || "Apollo search failed.");
      }
      const data = await response.json();
      setApolloStatusMessage(
        `Apollo found ${Number(data?.people_count || 0).toLocaleString()} employees and saved ${Number(data?.enriched_count || 0).toLocaleString()} shortlisted contacts.`
      );
      setApolloLogs({
        request: {
          endpoint: `${apiBaseUrl}/api/companies/${company.id}/apollo-employees`,
          payload: requestPayload,
        },
        people_search: {
          note: `Fetched ${Number(data?.people_count || 0).toLocaleString()} employees from Apollo.`,
        },
        bulk_match: {
          note: `Shortlisted ${Number(data?.enriched_count || 0).toLocaleString()} contacts and saved them to the company.`,
        },
      });
      const employees = Array.isArray(data?.company?.employees) ? data.company.employees : [];
      const resolvedLeads = employees.map((employee: Record<string, string>) => ({
        name: employee.name || "Unknown Lead",
        title: employee.title,
        email: employee.email,
        phone: employee.phone,
        linkedinUrl: employee.linkedin_url,
        organizationDomain: data?.company?.organization_domain || company.organization_domain || company.website_url,
        organizationId: data?.company?.apollo_org_id,
        companyName: data?.company?.name || company.name,
      })) as ApolloLead[];
      setApolloLeads(resolvedLeads);

      await fetchCompanies();
      if (selectedCompany?.id === company.id) {
        await handleOpenDetails(company);
      }
      toast.success(`Apollo search complete for ${company.name}.`);
    } catch (error) {
      console.error("Apollo search error:", error);
      toast.error("Apollo search failed. Check the console for details.");
      setApolloError(
        error instanceof Error
          ? error.name === "AbortError"
            ? "Apollo search timed out after 60 seconds."
            : error.message
          : "Apollo search failed."
      );
      setApolloStatusMessage(
        error instanceof Error && error.name === "AbortError"
          ? "Apollo search timed out after 60 seconds."
          : "Apollo search failed."
      );
      setApolloLogs((current) =>
        current
          ? {
              ...current,
              people_search: current.people_search ?? { note: "No response received." },
              bulk_match: current.bulk_match ?? { note: "No response received." },
            }
          : current
      );
    } finally {
      setIsApolloLoading(false);
    }
  };

  const handleToggleCompanySelection = (company: SavedCompanySummary, checked: boolean) => {
    setSelectedCompanyIds((current) =>
      checked ? Array.from(new Set([...current, company.id])) : current.filter((value) => value !== company.id)
    );
  };

  const handleToggleAllVisible = (checked: boolean) => {
    const visibleIds = filteredCompanies.map((company) => company.id);
    setSelectedCompanyIds((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...visibleIds]));
      }
      const visibleSet = new Set(visibleIds);
      return current.filter((value) => !visibleSet.has(value));
    });
  };

  const totalPages = Math.max(1, Math.ceil(totalCompanies / currentPageSize));
  const showPagination = totalCompanies > currentPageSize;

  const handleBulkApolloEnrichment = () => {
    const selectedCompanies = filteredCompanies.filter((company) => selectedCompanyIdSet.has(company.id));
    if (!selectedCompanies.length) {
      toast.error("Select at least one company to enrich.");
      return;
    }
    void (async () => {
      for (const [index, company] of selectedCompanies.entries()) {
        setApolloStatusMessage(`Processing company ${index + 1}/${selectedCompanies.length}: ${company.name}`);
        await handleApolloSearch(company);
      }
      setApolloStatusMessage(`Apollo enrichment complete for ${selectedCompanies.length} selected companies.`);
      await fetchCompanies();
      toast.success(`Apollo enrichment complete for ${selectedCompanies.length} compan${selectedCompanies.length === 1 ? "y" : "ies"}.`);
    })();
  };

  const handleBulkSendToInstantly = async () => {
    const selectedCompanies = filteredCompanies.filter((company) => selectedCompanyIdSet.has(company.id));
    if (!selectedCompanies.length) {
      toast.error("Select at least one company to send.");
      return;
    }

    try {
      setIsBulkSendingToInstantly(true);
      const detailedCompanies = await Promise.all(
        selectedCompanies.map(async (company) => {
          const response = await fetch(`${apiBaseUrl}/api/companies/${company.id}`);
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data?.detail || `Failed to load ${company.name}`);
          }
          return data?.company;
        })
      );

      for (const company of detailedCompanies) {
        if (Array.isArray(company?.employees) && company.employees.length > 0) {
          continue;
        }
        const response = await fetch(`${apiBaseUrl}/api/companies/${company.id}/apollo-employees`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.detail || `Apollo enrichment failed for ${company.name}`);
        }
      }

      const refreshedCompanies = await Promise.all(
        selectedCompanies.map(async (company) => {
          const response = await fetch(`${apiBaseUrl}/api/companies/${company.id}`);
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data?.detail || `Failed to reload ${company.name}`);
          }
          return data?.company;
        })
      );

      const response = await fetch("/api/companies/instantly", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignId: "4ca0b9f8-77a5-49fb-92e3-d428ffa8dbf9",
          companies: refreshedCompanies,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to send investor firms to Instantly.");
      }
      await fetchCompanies(currentPage);
      if (selectedCompany?.id) {
        const refreshedSelected = selectedCompanies.find((company) => company.id === selectedCompany.id);
        if (refreshedSelected) {
          await handleOpenDetails(refreshedSelected);
        }
      }
      toast.success(`Sent ${Number(data?.sent_count || 0)} investor lead${Number(data?.sent_count || 0) === 1 ? "" : "s"} to Instantly.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send investor firms to Instantly.");
    } finally {
      setIsBulkSendingToInstantly(false);
    }
  };

  const handleGenerateEmail = async (employee: SavedEmployee, forceRegenerate: boolean = false) => {
    if (!selectedCompany) {
      return;
    }
    setIsEmailModalOpen(true);
    setEmailError('');
    const companyDetails = {
      name: selectedCompany.name,
      website_url: selectedCompany.website_url,
      linkedin_url: selectedCompany.linkedin_url,
      hq: selectedCompany.hq,
      source: selectedCompany.source,
    };
    setEmailTarget({ employee, company: companyDetails });
    if (!forceRegenerate && employee.generated_email_text) {
      setIsEmailLoading(false);
      setGeneratedEmail(employee.generated_email_text);
      setGeneratedInstantlyPayload(employee.generated_instantly_payload || null);
      return;
    }
    setIsEmailLoading(true);
    setGeneratedEmail('');
    setGeneratedInstantlyPayload(null);
    try {
      const response = await fetch('/api/companies/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company: {
            ...selectedCompany,
            employees: [employee],
          },
        }),
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload?.error || 'Failed to generate email.');
      }
      const data = await response.json();
      const emailText = String(data?.email_generation?.full_email_text || '').trim();
      const emailSubjects = Array.isArray(data?.email_generation?.subject_options)
        ? data.email_generation.subject_options.map(String)
        : [];
      setGeneratedEmail(emailText);
      setGeneratedInstantlyPayload(
        data?.instantly_payload && typeof data.instantly_payload === "object"
          ? data.instantly_payload
          : null
      );
      if (emailText) {
        const nextCompany: SavedCompanyDetail = {
          ...selectedCompany,
          employees: (selectedCompany.employees || []).map((current) =>
            employeeIdentity(current) === employeeIdentity(employee)
              ? {
                  ...current,
                  generated_email_text: emailText,
                  generated_email_subjects: emailSubjects,
                  generated_instantly_payload:
                    data?.instantly_payload && typeof data.instantly_payload === "object"
                      ? data.instantly_payload
                      : current.generated_instantly_payload,
                  generated_outreach_result: data && typeof data === "object" ? data : current.generated_outreach_result,
                }
              : current
          ),
        };
        await persistCompany(nextCompany);
      }
    } catch (error) {
      setEmailError(
        error instanceof Error ? error.message : 'Failed to generate email.'
      );
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handlePromoteToIcp = async (employee: SavedEmployee) => {
    if (!selectedCompany) {
      return;
    }
    const currentIcps = selectedCompany.employees || [];
    if (currentIcps.some((current) => employeeIdentity(current) === employeeIdentity(employee))) {
      toast.error("This employee is already listed in ICPs.");
      return;
    }
    try {
      const nextCompany: SavedCompanyDetail = {
        ...selectedCompany,
        employees: [
          ...currentIcps,
          {
            ...employee,
            icp_reason: employee.icp_reason || "Moved manually from all employees to ICPs.",
          },
        ],
        icp_employees_count: currentIcps.length + 1,
      };
      await persistCompany(nextCompany);
      toast.success("Employee moved to ICPs.");
      setDetailTab("icps");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move employee to ICPs.");
    }
  };

  const filteredAllEmployees = useMemo(() => {
    const allEmployees = selectedCompany?.all_employees || [];
    if (allEmployeeTypeFilter === "all") {
      return allEmployees;
    }
    return allEmployees.filter((employee) => classifyEmployeeType(employee) === allEmployeeTypeFilter);
  }, [allEmployeeTypeFilter, selectedCompany]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Companies</p>
          <h2 className="text-sm font-semibold text-slate-100">Saved Companies</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {selectedCompanyIds.length} selected
          </span>
          <span className="text-xs text-slate-500">
            {totalCompanies.toLocaleString()} stored
          </span>
          <button
            type="button"
            onClick={handleBulkApolloEnrichment}
            disabled={selectedCompanyIds.length === 0 || isApolloLoading}
            className="rounded-full border border-emerald-700/70 px-3 py-1 text-xs font-semibold text-emerald-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isApolloLoading ? "Enriching..." : "Run Apollo on Selected"}
          </button>
          <button
            type="button"
            onClick={handleBulkSendToInstantly}
            disabled={selectedCompanyIds.length === 0 || isBulkSendingToInstantly}
            className="rounded-full border border-indigo-700/70 px-3 py-1 text-xs font-semibold text-indigo-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBulkSendingToInstantly ? "Sending..." : "Send to Instantly"}
          </button>
          {isLoading && (
            <span className="text-xs text-slate-500">Refreshing...</span>
          )}
          <button
            type="button"
            onClick={() => void fetchCompanies(currentPage)}
            className="rounded-full border border-slate-700/70 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-slate-900"
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <select
          value={locationFilter}
          onChange={(event) => {
            setLocationFilter(event.target.value);
            setCurrentPage(1);
          }}
          className="w-full max-w-[220px] rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-100 outline-none"
        >
          <option value="">All HQ locations</option>
          {LOCATION_OPTIONS.filter(Boolean).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          value={employeeFilter}
          onChange={(event) => {
            setEmployeeFilter(event.target.value as typeof employeeFilter);
            setCurrentPage(1);
          }}
          className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-200"
        >
          <option value="all">All employees</option>
          <option value="with">With employees</option>
          <option value="without">No employees</option>
        </select>
        <select
          value={instantlyFilter}
          onChange={(event) => {
            setInstantlyFilter(event.target.value as typeof instantlyFilter);
          }}
          className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-200"
        >
          <option value="all">All Instantly states</option>
          <option value="sent">Sent to Instantly</option>
          <option value="not_sent">Not sent to Instantly</option>
        </select>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-[0.2em] text-slate-400">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(event) => handleToggleAllVisible(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
                    aria-label="Select all visible companies"
                  />
                </th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">HQ</th>
                <th className="px-4 py-3">Website</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Total Employees</th>
                <th className="px-4 py-3">ICPs</th>
                <th className="px-4 py-3">Instantly</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {isLoading && filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-4 text-xs text-slate-400">
                    Loading saved companies...
                  </td>
                </tr>
              ) : filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-4 text-xs text-slate-400">
                    No saved companies match these filters.
                  </td>
                </tr>
              ) : (
                filteredCompanies.map((company) => (
                  <tr key={company.id} className="hover:bg-slate-900/70">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedCompanyIdSet.has(company.id)}
                        onChange={(event) => handleToggleCompanySelection(company, event.target.checked)}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
                        aria-label={`Select company ${company.name}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-100">
                      {company.name}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {company.hq || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {company.website_url ? (
                        <a
                          href={company.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-300 hover:underline"
                        >
                          {company.website_url.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {company.source || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {company.total_employees_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {company.icp_employees_count ?? company.employees_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {`${company.instantly_sent_icp_count ?? 0}(${company.icp_employees_count ?? 0}) sent`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void handleApolloSearch(company)}
                          disabled={!company.name && !company.website_url && !company.organization_domain}
                          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Find Apollo Employees
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDetails(company)}
                          className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/20"
                        >
                          View
                        </button>
                      </div>
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
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
            disabled={currentPage <= 1 || isLoading}
            className="rounded-full border border-slate-700/70 px-3 py-1 font-semibold text-slate-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))}
            disabled={currentPage >= totalPages || isLoading}
            className="rounded-full border border-slate-700/70 px-3 py-1 font-semibold text-slate-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
      {isDetailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setIsDetailOpen(false)}
        >
          <div
            className="w-full max-w-3xl max-h-[80vh] overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-950 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Company Details</h3>
                <p className="text-sm text-slate-400">
                  {selectedCompany?.name || "Loading company"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailOpen(false)}
                className="rounded-full border border-slate-700/70 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-6 text-xs text-slate-200">
              {isDetailLoading ? (
                <p className="text-sm text-slate-400">Loading company details...</p>
              ) : selectedCompany ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-800/80 bg-slate-900/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        Website
                      </p>
                      <p className="mt-2 text-sm text-slate-100">
                        {selectedCompany.website_url ? (
                          <a
                            href={selectedCompany.website_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-300 hover:underline"
                          >
                            {selectedCompany.website_url}
                          </a>
                        ) : (
                          "—"
                        )}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800/80 bg-slate-900/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        LinkedIn
                      </p>
                      <p className="mt-2 text-sm text-slate-100">
                        {selectedCompany.linkedin_url ? (
                          <a
                            href={selectedCompany.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-300 hover:underline"
                          >
                            {selectedCompany.linkedin_url}
                          </a>
                        ) : (
                          "—"
                        )}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800/80 bg-slate-900/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        HQ
                      </p>
                      <p className="mt-2 text-sm text-slate-100">
                        {selectedCompany.hq || "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800/80 bg-slate-900/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        Source
                      </p>
                      <p className="mt-2 text-sm text-slate-100">
                        {selectedCompany.source || "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleApolloSearch(selectedCompany)}
                      disabled={
                        (!selectedCompany.name && !selectedCompany.website_url && !selectedCompany.organization_domain)
                      }
                      className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Find employees from Apollo
                    </button>
                  </div>
                  <div className="rounded-lg border border-slate-800/80 bg-slate-900/70 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Portfolio Companies
                    </p>
                    {selectedCompany.portfolio_companies?.length ? (
                      <ul className="mt-3 grid gap-2 text-xs text-slate-200 sm:grid-cols-2">
                        {selectedCompany.portfolio_companies.map((portfolio) => (
                          <li
                            key={portfolio}
                            className="rounded-md border border-slate-800/70 bg-slate-950/70 px-2 py-1"
                          >
                            {portfolio}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">No portfolio companies listed.</p>
                    )}
                  </div>
                  <div className="rounded-lg border border-slate-800/80 bg-slate-900/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                          Employee Views
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          {selectedCompany.total_employees_count ?? selectedCompany.all_employees?.length ?? 0} raw Apollo employees and {selectedCompany.icp_employees_count ?? selectedCompany.employees?.length ?? 0} enriched ICPs stored for this company.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailTab("icps")}
                          className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${detailTab === "icps" ? "bg-indigo-500/20 text-indigo-100 border border-indigo-400/40" : "border border-slate-700/70 text-slate-300 hover:bg-slate-800"}`}
                        >
                          ICPs (Apollo enriched)
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetailTab("all")}
                          className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${detailTab === "all" ? "bg-indigo-500/20 text-indigo-100 border border-indigo-400/40" : "border border-slate-700/70 text-slate-300 hover:bg-slate-800"}`}
                        >
                          All Employees (raw Apollo)
                        </button>
                      </div>
                    </div>

                    {detailTab === "icps" ? (
                      selectedCompany.employees?.length ? (
                        <div className="mt-3 space-y-3">
                          {selectedCompany.employees.map((employee, index) => {
                            const email =
                              employee.email ||
                              (employee as { Email?: string }).Email ||
                              (employee as { work_email?: string }).work_email ||
                              (employee as { personal_email?: string }).personal_email;
                            const title =
                              employee.title ||
                              (employee as { Title?: string }).Title ||
                              (employee as { designation?: string }).designation;
                            const linkedin =
                              employee.linkedin_url ||
                              (employee as { linkedinUrl?: string }).linkedinUrl ||
                              (employee as { linkedin?: string }).linkedin;
                            const normalizedEmployee: SavedEmployee = {
                              ...employee,
                              name: employee.name,
                              title,
                              email,
                              phone: employee.phone,
                              linkedin_url: linkedin,
                            };
                            return (
                              <div
                                key={`${email ?? employee.name ?? "employee"}-${index}`}
                                className="rounded-md border border-slate-800/70 bg-slate-950/70 p-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-100">
                                      {employee.name || "Unnamed contact"}
                                    </p>
                                    {title && (
                                      <p className="text-xs text-slate-400">{title}</p>
                                    )}
                                  </div>
                                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${employee.instantly_sent ? "bg-emerald-500/20 text-emerald-100" : "bg-slate-800 text-slate-300"}`}>
                                    {employee.instantly_sent ? "Sent to Instantly" : "Not sent"}
                                  </span>
                                </div>
                                <div className="mt-2 space-y-1 text-[11px] text-slate-300">
                                  {email && <p>Email: {email}</p>}
                                  {employee.phone && <p>Phone: {employee.phone}</p>}
                                  {employee.icp_reason && <p>Why ICP: {employee.icp_reason}</p>}
                                  {linkedin && (
                                    <p>
                                      LinkedIn:{" "}
                                      <a
                                        href={linkedin}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-300 hover:underline"
                                      >
                                        {linkedin}
                                      </a>
                                    </p>
                                  )}
                                  {employee.instantly_sent_at && <p>Sent at: {new Date(employee.instantly_sent_at).toLocaleString()}</p>}
                                </div>
                              {employee.generated_email_text && (
                                  <div className="mt-3 rounded-md border border-slate-800/70 bg-slate-900/70 p-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                      Generated Content
                                    </p>
                                    <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-100">
                                      {employee.generated_email_text}
                                    </pre>
                                  </div>
                                )}
                                {employee.generated_instantly_payload && (
                                  <div className="mt-3 rounded-md border border-slate-800/70 bg-slate-900/70 p-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                      Instantly Ready Payload
                                    </p>
                                    <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px] text-slate-100">
                                      {JSON.stringify(employee.generated_instantly_payload, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleGenerateEmail(normalizedEmployee)}
                                    className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/20"
                                  >
                                    {employee.generated_email_text ? "View generated content" : "Generate content"}
                                  </button>
                                  {employee.generated_email_text && (
                                    <button
                                      type="button"
                                      onClick={() => handleGenerateEmail(normalizedEmployee, true)}
                                      className="rounded-md border border-slate-700/70 px-3 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-800"
                                    >
                                      Regenerate
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-slate-400">No ICPs stored yet.</p>
                      )
                    ) : (
                      <div className="mt-3 space-y-3">
                        <div className="flex justify-end">
                          <select
                            value={allEmployeeTypeFilter}
                            onChange={(event) => setAllEmployeeTypeFilter(event.target.value as typeof allEmployeeTypeFilter)}
                            className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-200"
                          >
                            <option value="all">All employee types</option>
                            <option value="investment">Investment</option>
                            <option value="platform">Platform / Operations</option>
                            <option value="talent">Talent / Recruiting</option>
                            <option value="leadership">Leadership</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        {filteredAllEmployees.length ? (
                          filteredAllEmployees.map((employee, index) => {
                            const alreadyIcp = (selectedCompany.employees || []).some(
                              (current) => employeeIdentity(current) === employeeIdentity(employee)
                            );
                            return (
                              <div
                                key={`${employee.email ?? employee.name ?? "all-employee"}-${index}`}
                                className="rounded-md border border-slate-800/70 bg-slate-950/70 p-3"
                              >
                                <p className="text-sm font-semibold text-slate-100">
                                  {employee.name || "Unnamed employee"}
                                </p>
                                {employee.title && (
                                  <p className="text-xs text-slate-400">{employee.title}</p>
                                )}
                                <div className="mt-2 space-y-1 text-[11px] text-slate-300">
                                  {employee.email && <p>Email: {employee.email}</p>}
                                  {employee.linkedin_url && (
                                    <p>
                                      LinkedIn:{" "}
                                      <a
                                        href={employee.linkedin_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-300 hover:underline"
                                      >
                                        {employee.linkedin_url}
                                      </a>
                                    </p>
                                  )}
                                  <p>Employee type: {classifyEmployeeType(employee)}</p>
                                </div>
                                <div className="mt-3">
                                  <button
                                    type="button"
                                    onClick={() => void handlePromoteToIcp(employee)}
                                    disabled={alreadyIcp}
                                    className="rounded-md border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold text-indigo-100 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {alreadyIcp ? "Already in ICPs" : "Move to ICPs"}
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-slate-400">No employees match this filter.</p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-400">No details available.</p>
              )}
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
                {apolloLogs && (
                  <button
                    type="button"
                    onClick={() => setShowApolloDebug((prev) => !prev)}
                    className="rounded-full border border-teal-200/40 px-3 py-1 text-xs font-semibold text-teal-100 transition hover:bg-teal-200/10"
                  >
                    {showApolloDebug ? "Hide logs" : "Display log"}
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
                <p className="text-sm text-slate-300">Fetching all Apollo employees and shortlisting the best outreach contacts...</p>
              )}
              {apolloStatusMessage && (
                <p className="text-sm text-slate-400">{apolloStatusMessage}</p>
              )}
              {!isApolloLoading && apolloError && (
                <p className="text-sm text-rose-300">{apolloError}</p>
              )}
              {!isApolloLoading && !apolloError && apolloLeads.length === 0 && (
                <p className="text-sm text-slate-400">No leads returned.</p>
              )}
              {!isApolloLoading && apolloLeads.length > 0 && (
                <ul className="space-y-3">
                  {apolloLeads.map((lead, index) => (
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
              {apolloLogs && showApolloDebug && (
                <div className="space-y-4 rounded-lg border border-slate-800/80 bg-slate-900/80 p-3 text-xs text-slate-200">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Request
                    </p>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800/80 bg-slate-950/70 p-3 text-[11px] text-slate-200">
                      {JSON.stringify(apolloLogs.request, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                      People Search
                    </p>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800/80 bg-slate-950/70 p-3 text-[11px] text-slate-200">
                      {JSON.stringify(apolloLogs.people_search, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Bulk Match
                    </p>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800/80 bg-slate-950/70 p-3 text-[11px] text-slate-200">
                      {JSON.stringify(apolloLogs.bulk_match, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {isEmailModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={handleCloseEmailModal}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-950 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Targeted email</h3>
                <p className="text-sm text-slate-400">
                  {emailTarget?.employee?.name || 'Selected employee'}
                  {emailTarget?.company?.name ? ` · ${emailTarget.company.name}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseEmailModal}
                className="rounded-full border border-slate-700/70 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-4 text-sm text-slate-200">
              {isEmailLoading && (
                <p className="text-sm text-slate-300">Drafting the outreach email...</p>
              )}
              {!isEmailLoading && emailError && (
                <p className="text-sm text-rose-300">{emailError}</p>
              )}
              {!isEmailLoading && !emailError && !generatedEmail && (
                <p className="text-sm text-slate-400">No email generated yet.</p>
              )}
              {!isEmailLoading && generatedEmail && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-800/80 bg-slate-900/60 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Generated email
                    </p>
                    <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-100">
                      {generatedEmail}
                    </pre>
                  </div>
                  {generatedInstantlyPayload && (
                    <div className="rounded-lg border border-slate-800/80 bg-slate-900/60 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        Full Instantly Ready Payload
                      </p>
                      <pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs text-slate-100">
                        {JSON.stringify(generatedInstantlyPayload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default SavedCompaniesTable;
