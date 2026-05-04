import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import {
  BarChart3,
  Briefcase,
  Building2,
  ChevronDown,
  Compass,
  Home,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import SavedCompaniesTable from "@/components/SavedCompaniesTable";
import InvestorFilters from "@/components/Task/InvestorFilters";
import JobSearchForm, {
  JobDateFilter,
  JobSearchSource,
  JobTypeFilter,
} from "@/components/Jobs/JobSearchForm";
import JobsTable from "@/components/Jobs/JobsTable";
import { ChatBoxSettings, Data, JobPosting } from "@/types/data";

interface CopilotResearchContentProps {
  orderedData: Data[];
  answer: string;
  allLogs: any[];
  chatBoxSettings: ChatBoxSettings;
  loading: boolean;
  isStopped: boolean;
  promptValue?: string;
  setPromptValue?: Dispatch<SetStateAction<string>>;
  chatPromptValue: string;
  setChatPromptValue: Dispatch<SetStateAction<string>>;
  investorType?: string;
  setInvestorType?: Dispatch<SetStateAction<string>>;
  hqCountry?: string;
  setHqCountry?: Dispatch<SetStateAction<string>>;
  industry?: string;
  setIndustry?: Dispatch<SetStateAction<string>>;
  companyCount?: number;
  setCompanyCount?: Dispatch<SetStateAction<number>>;
  companySearchProvider?: string;
  setCompanySearchProvider?: (value: string) => void;
  handleDisplayResult: (question: string) => void;
  handleChat: (message: string) => void;
  handleClickSuggestion: (value: string) => void;
  currentResearchId?: string;
  onShareClick?: () => void;
  reset?: () => void;
  isProcessingChat?: boolean;
  onNewResearch?: () => void;
  toggleSidebar?: () => void;
}

type ActiveSection = "home" | "discovery" | "jobs" | "companies" | "content";
type HomePanel = "investor" | "jobs";
type AnalyticsSummary = {
  jobsSent: number;
  companiesSent: number;
  sentJobKeys: string[];
  sentCompanyIds: string[];
};
type ParsedCompany = {
  name: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  portfolioCompanies?: string[];
  hq?: string;
  source?: string;
};
type SavedCompanySummary = {
  id: string;
  name: string;
  website_url?: string;
  linkedin_url?: string;
  organization_domain?: string;
  hq?: string;
  source?: string;
  employees_count?: number;
};
type SavedCompanyDetail = SavedCompanySummary & {
  portfolio_companies?: string[];
  employees?: Array<{
    name?: string;
    title?: string;
    email?: string;
    linkedin_url?: string;
  }>;
};
type DiscoveryKind = "jobs" | "companies" | null;
const PAGE_SIZE = 100;
const COMPANY_PAGE_SIZE = 100;
const JOB_REFERENCE_STORAGE_KEY = "jobReferenceContent";
const COMPANY_REFERENCE_STORAGE_KEY = "companyReferenceContent";
const JOB_REFERENCE_DEFAULT = `EMB Global outreach for job search workflow:

Use this content to generate outreach to the best hiring ICPs for companies that have active job postings.

Core EMB Global positioning:
- Accelerated Onboarding: Deploy project-ready talent who deliver from day one. Cut ramp-up time and start seeing meaningful progress without the usual hiring delays.
- All-in-One Talent Pool: From frontend to AI, access a dynamic bench of experts. Get the right specialist, for the right task, exactly when you need them most.
- Real-Time Optimization: Monitor tasks, timesheets, and team output instantly. Gain full visibility and take smarter, faster decisions with real insights built into the workflow.

Email objective:
- The email should position EMB Global as a partner that can help the company fulfil the role in the job posting with relevant technical resources.
- The email should be written for the right ICPs involved in hiring decisions for that role.
- Keep the message direct, useful, and tied to the active hiring need rather than generic staffing language.`;
const COMPANY_REFERENCE_DEFAULT = `EMB Global outreach for organisation search workflow:

Use this content to generate partnership outreach to the best ICPs at investor firms, platform teams, talent teams, and related decision-makers.

Core EMB Global positioning:
- Accelerated Onboarding: Deploy project-ready talent who deliver from day one. Cut ramp-up time and start seeing meaningful progress without the usual hiring delays.
- All-in-One Talent Pool: From frontend to AI, access a dynamic bench of experts. Get the right specialist, for the right task, exactly when you need them most.
- Real-Time Optimization: Monitor tasks, timesheets, and team output instantly. Gain full visibility and take smarter, faster decisions with real insights built into the workflow.

Email objective:
- The email should initiate a partnership conversation with EMB Global.
- The partnership angle is that EMB Global provides technical resources and execution support that can help portfolio companies hire and deliver faster.
- The email should be written for the right ICPs who influence portfolio talent, platform, operating, or partnership decisions.
- Keep the message concise, partnership-led, and focused on practical value for the firm and its portfolio.`;

const navigationItems: Array<{
  label: string;
  icon: LucideIcon;
  section: ActiveSection;
  badge?: "savedJobs";
}> = [
  { label: "Home", icon: Home, section: "home" },
  { label: "Discovery", icon: Compass, section: "discovery" },
  { label: "Jobs", icon: Briefcase, section: "jobs", badge: "savedJobs" },
  { label: "Companies", icon: Building2, section: "companies" },
  { label: "Reference Content", icon: Users, section: "content" },
  { label: "Settings", icon: Settings, section: "home" },
  { label: "API Usage", icon: BarChart3, section: "home" },
];

export default function CopilotResearchContent({
  orderedData,
  answer,
  loading,
  investorType,
  setInvestorType,
  hqCountry,
  setHqCountry,
  industry,
  setIndustry,
  companyCount,
  setCompanyCount,
  companySearchProvider,
  setCompanySearchProvider,
  handleDisplayResult,
  currentResearchId,
  onShareClick,
  onNewResearch,
}: CopilotResearchContentProps) {
  const parseCompanyResults = useCallback((rawValue: string): ParsedCompany[] => {
    const attemptParseJson = (input: string) => {
      if (!input?.trim()) {
        return null;
      }
      try {
        return JSON.parse(input);
      } catch {
        const codeBlockMatch = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (!codeBlockMatch?.[1]) {
          return null;
        }
        try {
          return JSON.parse(codeBlockMatch[1]);
        } catch {
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
      if (typeof value === "string") {
        return value.split(",").map((item) => item.trim()).filter(Boolean);
      }
      return undefined;
    };

    const parsedPayload = attemptParseJson(rawValue);
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
      .map((company: Record<string, unknown>) => {
        const name = String(company.Name ?? company.name ?? "").trim();
        if (!name) {
          return null;
        }
        const websiteUrl = String(
          company["Website URL"] ?? company.website_url ?? company.websiteUrl ?? ""
        ).trim() || undefined;
        const key = (websiteUrl || name).toLowerCase();
        if (unique.has(key)) {
          return null;
        }
        unique.add(key);
        return {
          name,
          websiteUrl,
          linkedinUrl: String(
            company["LinkedIn URL"] ?? company.linkedin_url ?? company.linkedinUrl ?? ""
          ).trim() || undefined,
          portfolioCompanies: normalizePortfolioCompanies(
            company["Portfolio Companies"] ?? company.portfolio_companies ?? company.portfolioCompanies
          ),
          hq: String(company.HQ ?? company.hq ?? company.headquarters ?? "").trim() || undefined,
          source: String(
            company.Source ?? company.source ?? company.source_url ?? company.sourceUrl ?? company["Source URL"] ?? ""
          ).trim() || undefined,
        };
      })
      .filter((company) => company !== null) as ParsedCompany[];
  }, []);

  const [activeSection, setActiveSection] = useState<ActiveSection>("home");
  const [openHomePanel, setOpenHomePanel] = useState<HomePanel | null>(null);
  const [jobRole, setJobRole] = useState("");
  const [jobLocation, setJobLocation] = useState("United States");
  const [jobDateFilter, setJobDateFilter] = useState<JobDateFilter>("7d");
  const [jobType, setJobType] = useState<JobTypeFilter>("all");
  const [jobSources, setJobSources] = useState<JobSearchSource[]>(["ashby", "greenhouse", "lever"]);
  const [useApolloEnrichment, setUseApolloEnrichment] = useState(false);
  const [runCompanyApolloEnrichmentAndContent, setRunCompanyApolloEnrichmentAndContent] = useState(false);
  const [pushCompaniesToInstantlyAfterSearch, setPushCompaniesToInstantlyAfterSearch] = useState(false);
  const [jobDiscoveryResults, setJobDiscoveryResults] = useState<JobPosting[]>([]);
  const [savedJobs, setSavedJobs] = useState<JobPosting[]>([]);
  const [savedJobsTotal, setSavedJobsTotal] = useState(0);
  const [savedJobsPage, setSavedJobsPage] = useState(1);
  const [savedJobsSourceFilter, setSavedJobsSourceFilter] = useState("all");
  const [savedJobsRoleFilter, setSavedJobsRoleFilter] = useState("");
  const [savedJobsLocationFilter, setSavedJobsLocationFilter] = useState("");
  const [savedJobsHasContactsFilter, setSavedJobsHasContactsFilter] = useState(false);
  const [savedJobsContactTitleFilter, setSavedJobsContactTitleFilter] = useState("");
  const [selectedSavedJobKeys, setSelectedSavedJobKeys] = useState<string[]>([]);
  const [isSavedJobsLoading, setIsSavedJobsLoading] = useState(false);
  const [isJobSearchLoading, setIsJobSearchLoading] = useState(false);
  const [isRerunningApollo, setIsRerunningApollo] = useState(false);
  const [isSendingToInstantly, setIsSendingToInstantly] = useState(false);
  const [jobSearchError, setJobSearchError] = useState<string | null>(null);
  const [instantlyStatusMessage, setInstantlyStatusMessage] = useState<string | null>(null);
  const [jobDebugLog, setJobDebugLog] = useState<Record<string, unknown>[]>([]);
  const [latestJobResponse, setLatestJobResponse] = useState<Record<string, unknown> | null>(null);
  const [showJobDebug, setShowJobDebug] = useState(false);
  const [showJobResponseLog, setShowJobResponseLog] = useState(false);
  const [apolloEnrichmentRunId, setApolloEnrichmentRunId] = useState<string | null>(null);
  const [apolloEnrichmentStatus, setApolloEnrichmentStatus] = useState<Record<string, unknown> | null>(null);
  const [isJobsApolloModalOpen, setIsJobsApolloModalOpen] = useState(false);
  const [showJobsApolloLogs, setShowJobsApolloLogs] = useState(false);
  const [jobsApolloTitleInput, setJobsApolloTitleInput] = useState(
    "Recruiter, Talent Acquisition, Hiring Manager, Director, Head, VP"
  );
  const [lastJobRunSummary, setLastJobRunSummary] = useState<{
    collectedCount: number;
    uniqueCount: number;
    savedTotal: number;
  } | null>(null);
  const [savedCompaniesCount, setSavedCompaniesCount] = useState(0);
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary>({
    jobsSent: 0,
    companiesSent: 0,
    sentJobKeys: [],
    sentCompanyIds: [],
  });
  const [pendingCompanyAutomation, setPendingCompanyAutomation] = useState(false);
  const [isCompanyAutomationRunning, setIsCompanyAutomationRunning] = useState(false);
  const [companyAutomationCurrentStep, setCompanyAutomationCurrentStep] = useState<string | null>(null);
  const [companyAutomationLogs, setCompanyAutomationLogs] = useState<string[]>([]);
  const [activeDiscoveryKind, setActiveDiscoveryKind] = useState<DiscoveryKind>(null);
  const [savedCompaniesForContent, setSavedCompaniesForContent] = useState<SavedCompanySummary[]>([]);
  const [selectedContentJobKey, setSelectedContentJobKey] = useState("");
  const [selectedContentCompanyId, setSelectedContentCompanyId] = useState("");
  const [jobEmailContent, setJobEmailContent] = useState<Record<string, unknown> | null>(null);
  const [companyEmailContent, setCompanyEmailContent] = useState<Record<string, unknown> | null>(null);
  const [isJobEmailContentLoading, setIsJobEmailContentLoading] = useState(false);
  const [isCompanyEmailContentLoading, setIsCompanyEmailContentLoading] = useState(false);
  const [jobEmailContentError, setJobEmailContentError] = useState<string | null>(null);
  const [companyEmailContentError, setCompanyEmailContentError] = useState<string | null>(null);
  const [jobReferenceContent, setJobReferenceContent] = useState(JOB_REFERENCE_DEFAULT);
  const [companyReferenceContent, setCompanyReferenceContent] = useState(COMPANY_REFERENCE_DEFAULT);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setJobReferenceContent(window.localStorage.getItem(JOB_REFERENCE_STORAGE_KEY) || JOB_REFERENCE_DEFAULT);
    setCompanyReferenceContent(window.localStorage.getItem(COMPANY_REFERENCE_STORAGE_KEY) || COMPANY_REFERENCE_DEFAULT);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(JOB_REFERENCE_STORAGE_KEY, jobReferenceContent);
  }, [jobReferenceContent]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(COMPANY_REFERENCE_STORAGE_KEY, companyReferenceContent);
  }, [companyReferenceContent]);

  const fetchHomeAnalytics = useCallback(async () => {
    try {
      const [companiesResponse, analyticsResponse] = await Promise.all([
        fetch(`/api/companies?include_employees=false&page=1&page_size=${COMPANY_PAGE_SIZE}`, { cache: "no-store" }),
        fetch("/api/analytics/summary", { cache: "no-store" }),
      ]);
      const companiesData = await companiesResponse.json().catch(() => ({}));
      const analyticsData = await analyticsResponse.json().catch(() => ({}));
      setSavedCompaniesCount(typeof companiesData?.total === "number" ? companiesData.total : 0);
      setAnalyticsSummary({
        jobsSent: Number(analyticsData?.instantly?.jobs_sent || 0),
        companiesSent: Number(analyticsData?.instantly?.companies_sent || 0),
        sentJobKeys: Array.isArray(analyticsData?.instantly?.sent_job_keys)
          ? analyticsData.instantly.sent_job_keys.map(String)
          : [],
        sentCompanyIds: Array.isArray(analyticsData?.instantly?.sent_company_ids)
          ? analyticsData.instantly.sent_company_ids.map(String)
          : [],
      });
    } catch {
      return;
    }
  }, []);

  const fetchSavedJobs = useCallback(async (
    page: number = 1,
    source: string = savedJobsSourceFilter,
    roleQuery: string = savedJobsRoleFilter,
    hasContacts: boolean = savedJobsHasContactsFilter,
    contactTitleQuery: string = savedJobsContactTitleFilter,
    resetSelection: boolean = true,
  ) => {
    try {
      setIsSavedJobsLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
        source,
      });
      if (roleQuery.trim()) {
        params.set("role_query", roleQuery.trim());
      }
      if (hasContacts) {
        params.set("has_contacts", "true");
      }
      if (contactTitleQuery.trim()) {
        params.set("contact_title_query", contactTitleQuery.trim());
      }
      const response = await fetch(`/api/jobs/saved?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to load saved jobs.");
      }
      const nextJobs = Array.isArray(data?.jobs) ? data.jobs : [];
      setSavedJobs(nextJobs);
      setSavedJobsTotal(typeof data?.total === "number" ? data.total : 0);
      setSavedJobsPage(typeof data?.page === "number" ? data.page : page);
      if (resetSelection) {
        setSelectedSavedJobKeys([]);
      }
      return nextJobs;
    } catch (error) {
      setJobSearchError(error instanceof Error ? error.message : "Failed to load saved jobs.");
      return [];
    } finally {
      setIsSavedJobsLoading(false);
    }
  }, [savedJobsContactTitleFilter, savedJobsHasContactsFilter, savedJobsRoleFilter, savedJobsSourceFilter]);

  const fetchSavedCompaniesForContent = useCallback(async () => {
    try {
      const pageSize = 250;
      let page = 1;
      let allCompanies: SavedCompanySummary[] = [];
      let total = 0;

      do {
        const response = await fetch(
          `/api/companies?include_employees=false&page=${page}&page_size=${pageSize}`,
          { cache: "no-store" }
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || "Failed to load saved companies.");
        }
        const pageCompanies = Array.isArray(data?.companies) ? data.companies : [];
        allCompanies = [...allCompanies, ...pageCompanies];
        total = typeof data?.total === "number" ? data.total : pageCompanies.length;
        page += 1;
      } while (allCompanies.length < total);

      setSavedCompaniesForContent(allCompanies);
    } catch (error) {
      setJobSearchError(error instanceof Error ? error.message : "Failed to load saved companies.");
    }
  }, []);

  useEffect(() => {
    void fetchSavedJobs(1);
  }, [fetchSavedJobs]);

  useEffect(() => {
    void fetchHomeAnalytics();
  }, [fetchHomeAnalytics]);

  useEffect(() => {
    void fetchSavedCompaniesForContent();
  }, [fetchSavedCompaniesForContent]);

  useEffect(() => {
    if (!apolloEnrichmentRunId) {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/jobs/enrichment-status/${apolloEnrichmentRunId}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.detail || data?.error || "Failed to load Apollo enrichment status.");
        }
        setApolloEnrichmentStatus(data);
        const status = String(data?.status || "");
        if (status === "completed" || status === "failed") {
          window.clearInterval(interval);
          void fetchSavedJobs(savedJobsPage);
        }
      } catch {
        window.clearInterval(interval);
      }
    }, 2500);

    return () => window.clearInterval(interval);
  }, [apolloEnrichmentRunId, fetchSavedJobs, savedJobsPage]);

  const handleInvestorSearch = () => {
    if (loading) {
      return;
    }
    if (!investorType || !hqCountry) {
      toast.error("Please select an investor type and HQ country before starting search.");
      setActiveSection("home");
      setActiveDiscoveryKind(null);
      return;
    }
    setPendingCompanyAutomation(runCompanyApolloEnrichmentAndContent);
    setCompanyAutomationCurrentStep(null);
    setCompanyAutomationLogs([]);
    setActiveDiscoveryKind("companies");
    setJobDiscoveryResults([]);
    setLastJobRunSummary(null);
    setActiveSection("discovery");
    handleDisplayResult("");
  };

  const handleJobSearch = async () => {
    if (isJobSearchLoading) {
      return;
    }
    if (!jobRole.trim() || !jobLocation.trim() || jobSources.length === 0) {
      const message = "Please select a job title, location, and at least one source before starting search.";
      setJobSearchError(message);
      toast.error(message);
      setActiveSection("home");
      setActiveDiscoveryKind(null);
      return;
    }

    try {
      setIsJobSearchLoading(true);
      setJobSearchError(null);
      setActiveDiscoveryKind("jobs");
      setActiveSection("discovery");
      setShowJobResponseLog(false);
      setApolloEnrichmentRunId(null);
      setApolloEnrichmentStatus(null);

      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: jobRole.trim(),
          location: jobLocation.trim(),
          date_filter: jobDateFilter,
          job_type: jobType,
          sources: jobSources.filter((source) => source !== "apollo"),
          use_apollo_job_search: jobSources.includes("apollo"),
          use_apollo_enrichment: useApolloEnrichment,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Job search failed.");
      }

      const nextDiscoveryJobs = Array.isArray(data?.fetched_jobs) ? data.fetched_jobs : [];
      const nextSavedJobs = Array.isArray(data?.saved_jobs) ? data.saved_jobs : [];
      setJobDiscoveryResults(nextDiscoveryJobs);
      setLatestJobResponse(data && typeof data === "object" ? data : null);
      setSavedJobs(nextSavedJobs);
      setSavedJobsTotal(typeof data?.saved_jobs_total === "number" ? data.saved_jobs_total : nextSavedJobs.length);
      setSavedJobsPage(typeof data?.saved_jobs_page === "number" ? data.saved_jobs_page : 1);
      setLastJobRunSummary({
        collectedCount: typeof data?.collected_count === "number" ? data.collected_count : nextDiscoveryJobs.length,
        uniqueCount: typeof data?.unique_count === "number" ? data.unique_count : nextDiscoveryJobs.length,
        savedTotal: typeof data?.saved_total === "number" ? data.saved_total : nextSavedJobs.length,
      });
      setJobDebugLog(Array.isArray(data?.debug_log) ? data.debug_log : []);
      setApolloEnrichmentRunId(typeof data?.apollo_enrichment_run_id === "string" ? data.apollo_enrichment_run_id : null);
      setApolloEnrichmentStatus(
        data?.apollo_enrichment_status && typeof data.apollo_enrichment_status === "object"
          ? data.apollo_enrichment_status
          : null
      );
    } catch (error) {
      setJobSearchError(error instanceof Error ? error.message : "Job search failed.");
    } finally {
      setIsJobSearchLoading(false);
    }
  };

  const handleOpenNewSearch = () => {
    if (onNewResearch) {
      onNewResearch();
    }
    setActiveSection("home");
    setJobDiscoveryResults([]);
    setJobDebugLog([]);
    setLatestJobResponse(null);
    setShowJobResponseLog(false);
    setApolloEnrichmentRunId(null);
    setApolloEnrichmentStatus(null);
    setJobSearchError(null);
    setActiveDiscoveryKind(null);
  };

  const handleRerunApollo = async () => {
    try {
      setIsRerunningApollo(true);
      const titles = jobsApolloTitleInput
        .split(",")
        .map((title) => title.trim())
        .filter(Boolean);
      const response = await fetch("/api/jobs/enrich", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: jobRole.trim(),
          source: savedJobsSourceFilter,
          force: true,
          max_companies: PAGE_SIZE,
          titles,
          selected_job_keys: selectedSavedJobKeys,
          selected_company_keys: Array.from(
            new Set(
              savedJobs
                .filter((job) =>
                  selectedSavedJobKeys.includes(
                    job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`
                  )
                )
                .map((job) => job.company_key)
                .filter((value): value is string => Boolean(value))
            )
          ),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Apollo enrichment rerun failed.");
      }
      setApolloEnrichmentRunId(typeof data?.apollo_enrichment_run_id === "string" ? data.apollo_enrichment_run_id : null);
      setApolloEnrichmentStatus(
        data?.apollo_enrichment_status && typeof data.apollo_enrichment_status === "object"
          ? data.apollo_enrichment_status
          : null
      );
      setIsJobsApolloModalOpen(false);
      setShowJobsApolloLogs(true);
    } catch (error) {
      setJobSearchError(error instanceof Error ? error.message : "Apollo enrichment rerun failed.");
    } finally {
      setIsRerunningApollo(false);
    }
  };

  const waitForApolloEnrichment = async (runId: string) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetch(`/api/jobs/enrichment-status/${runId}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || "Failed to load Apollo enrichment status.");
      }
      setApolloEnrichmentStatus(data);
      const status = String(data?.status || "");
      if (status === "completed") {
        return data;
      }
      if (status === "failed") {
        throw new Error(String(data?.message || "Apollo enrichment failed."));
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
    }
    throw new Error("Apollo enrichment timed out.");
  };

  useEffect(() => {
    if (!pendingCompanyAutomation || loading || isCompanyAutomationRunning) {
      return;
    }
    const parsedCompanies = parseCompanyResults(answer);
    if (!parsedCompanies.length) {
      if (!loading && answer) {
        setPendingCompanyAutomation(false);
      }
      return;
    }

    const runAutomation = async () => {
      const appendAutomationLog = (message: string) => {
        setCompanyAutomationCurrentStep(message);
        setCompanyAutomationLogs((current) => [...current.slice(-11), message]);
      };

      try {
        setIsCompanyAutomationRunning(true);
        appendAutomationLog(
          `Found ${parsedCompanies.length.toLocaleString()} companies. Starting save and Apollo enrichment one by one.`
        );
        const savedCompanies: Record<string, unknown>[] = [];
        for (const [index, company] of Array.from(parsedCompanies.entries())) {
          appendAutomationLog(
            `Saving company ${index + 1}/${parsedCompanies.length}: ${company.name}.`
          );
          const response = await fetch("/api/companies", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: company.name,
              website_url: company.websiteUrl,
              linkedin_url: company.linkedinUrl,
              portfolio_companies: company.portfolioCompanies,
              hq: company.hq,
              source: company.source,
              organization_domain: company.websiteUrl,
            }),
          });
          const data = await response.json();
          if (!response.ok) {
            appendAutomationLog(`Failed to save ${company.name}. Continuing with the remaining companies.`);
            continue;
          }
          if (data?.company && typeof data.company === "object") {
            savedCompanies.push(data.company);
          }
        }
        await fetchHomeAnalytics();
        const enrichedCompanies: Record<string, unknown>[] = [];
        const saveableCompanies = savedCompanies.filter(
          (company): company is Record<string, unknown> => Boolean(company?.id)
        );
        for (const [index, company] of Array.from(saveableCompanies.entries())) {
          appendAutomationLog(
            `Fetching Apollo employees for ${String(company.name || `company ${index + 1}`)} (${index + 1}/${saveableCompanies.length}).`
          );
          const response = await fetch(`/api/companies/${company.id}/apollo-employees`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            appendAutomationLog(
              `Apollo enrichment failed for ${String(company.name || `company ${index + 1}`)}. Saved progress is preserved.`
            );
            continue;
          }
          appendAutomationLog(
            `Apollo returned ${Number(data?.people_count || 0).toLocaleString()} employees and shortlisted ${Number(data?.enriched_count || 0).toLocaleString()} contacts for ${String(company.name || `company ${index + 1}`)}.`
          );
          if (data?.company && typeof data.company === "object") {
            enrichedCompanies.push(data.company);
          }
        }
        const companiesWithEmployees = enrichedCompanies.filter(
          (company): company is Record<string, unknown> =>
            Boolean(company && Array.isArray(company.employees) && company.employees.length > 0)
        );
        if (!companiesWithEmployees.length) {
          appendAutomationLog("Company discovery finished, but Apollo did not return usable investor contacts.");
          setInstantlyStatusMessage("Company search completed, but Apollo did not return any usable investor contacts.");
          return;
        }
        const companiesWithGeneratedContent: Record<string, unknown>[] = [];
        for (const [index, company] of Array.from(companiesWithEmployees.entries())) {
          appendAutomationLog(
            `Generating partnership content for ICPs at ${String(company.name || `company ${index + 1}`)} (${index + 1}/${companiesWithEmployees.length}).`
          );
          const employees = Array.isArray(company.employees) ? company.employees : [];
          const generatedEmployees: Record<string, unknown>[] = [];
          for (const employee of employees) {
            const response = await fetch("/api/companies/email", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                company: {
                  ...company,
                  employees: [employee],
                },
                referenceContext: companyReferenceContent.trim() || undefined,
              }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
              generatedEmployees.push(employee);
              continue;
            }
            generatedEmployees.push({
              ...employee,
              generated_email_text: data?.email_generation?.full_email_text || employee.generated_email_text,
              generated_email_subjects: Array.isArray(data?.email_generation?.subject_options)
                ? data.email_generation.subject_options
                : employee.generated_email_subjects,
              generated_instantly_payload:
                data?.instantly_payload && typeof data.instantly_payload === "object"
                  ? data.instantly_payload
                  : employee.generated_instantly_payload,
              generated_outreach_result:
                data && typeof data === "object"
                  ? data
                  : employee.generated_outreach_result,
            });
          }
          const updatedCompany = {
            ...company,
            employees: generatedEmployees,
          };
          const persistResponse = await fetch("/api/companies", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(updatedCompany),
          });
          const persistedCompany = await persistResponse.json().catch(() => ({}));
          companiesWithGeneratedContent.push(
            persistedCompany?.company && typeof persistedCompany.company === "object"
              ? persistedCompany.company
              : updatedCompany
          );
        }
        appendAutomationLog(
          `Apollo enrichment complete. ${companiesWithGeneratedContent.length.toLocaleString()} compan${companiesWithGeneratedContent.length === 1 ? "y has" : "ies have"} shortlisted contacts with generated content ready for review.`
        );
        if (pushCompaniesToInstantlyAfterSearch && companiesWithGeneratedContent.length > 0) {
          appendAutomationLog(
            `Sending ${companiesWithGeneratedContent.length.toLocaleString()} discovered firms to Instantly.`
          );
          const instantlyResponse = await fetch("/api/companies/instantly", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              campaignId: "4ca0b9f8-77a5-49fb-92e3-d428ffa8dbf9",
              companies: companiesWithGeneratedContent,
              referenceContext: companyReferenceContent.trim() || undefined,
            }),
          });
          const instantlyData = await instantlyResponse.json().catch(() => ({}));
          if (!instantlyResponse.ok) {
            throw new Error(instantlyData?.error || "Failed to push discovered firms to Instantly.");
          }
          const sentCount = Number(instantlyData?.sent_count || 0);
          const approvedCount = Number(instantlyData?.approved_count || 0);
          const skippedCount = Number(instantlyData?.skipped_count || 0);
          if (sentCount === 0 && skippedCount > 0) {
            appendAutomationLog(
              `Auto-send skipped. ${skippedCount.toLocaleString()} ICP${skippedCount === 1 ? " was" : "s were"} already sent to Instantly.`
            );
            setInstantlyStatusMessage(
              `Company search completed. Content was generated, but all eligible ICPs had already been sent to Instantly, so no new emails were pushed.`
            );
          } else {
            appendAutomationLog(
              `Instantly export complete. ${sentCount.toLocaleString()} leads sent from ${approvedCount.toLocaleString()} approved ICPs.`
            );
            setInstantlyStatusMessage(
              `Company search completed. ${companiesWithGeneratedContent.length.toLocaleString()} firms were enriched, content was generated, and ${sentCount.toLocaleString()} ICP leads were sent to Instantly.`
            );
          }
          await fetchHomeAnalytics();
        } else {
          setInstantlyStatusMessage(
            `Company search completed. ${companiesWithGeneratedContent.length.toLocaleString()} firms were enriched and personalised content is ready for review. Auto-send to Instantly is disabled for investor search.`
          );
        }
      } catch (error) {
        setJobSearchError(error instanceof Error ? error.message : "Company pipeline automation failed.");
      } finally {
        setPendingCompanyAutomation(false);
        setIsCompanyAutomationRunning(false);
      }
    };

    void runAutomation();
  }, [answer, companyReferenceContent, fetchHomeAnalytics, isCompanyAutomationRunning, loading, parseCompanyResults, pendingCompanyAutomation, pushCompaniesToInstantlyAfterSearch]);

  const companyDiscoveryResults = parseCompanyResults(answer);
  const companyProgressUpdates = useMemo(() => {
    const queryLogs = orderedData
      .filter((item: any) => item?.type === "logs")
      .map((item: any) => {
        if (typeof item?.output === "string" && item.output.trim()) {
          return item.output.trim();
        }
        if (typeof item?.content === "string" && item.content.trim()) {
          return item.content.trim();
        }
        return "";
      })
      .filter(Boolean)
      .slice(-6);
    return [...queryLogs, ...companyAutomationLogs].slice(-8);
  }, [companyAutomationLogs, orderedData]);
  const isCompanyDiscoveryLoading = activeDiscoveryKind === "companies" && (loading || isCompanyAutomationRunning);
  const isJobDiscoveryLoading =
    activeDiscoveryKind === "jobs" &&
    (isJobSearchLoading || (Boolean(apolloEnrichmentRunId) && String(apolloEnrichmentStatus?.status || "") !== "completed"));
  const discoveryStatus = (() => {
    if (activeDiscoveryKind === "companies") {
      if (loading) {
        return "Running investor search and collecting companies.";
      }
      if (isCompanyAutomationRunning) {
        return companyAutomationCurrentStep || instantlyStatusMessage || "Saving companies, enriching Apollo contacts, and preparing investor outreach.";
      }
      if (companyDiscoveryResults.length > 0) {
        return `Showing ${companyDiscoveryResults.length.toLocaleString()} companies from the current investor search.`;
      }
      return "No company results in the current investor search yet.";
    }
    if (activeDiscoveryKind === "jobs") {
      if (isJobSearchLoading) {
        return "Running job search across selected ATS sources.";
      }
      if (apolloEnrichmentStatus) {
        return String(apolloEnrichmentStatus.message || "Apollo enrichment is running for current job results.");
      }
      if (jobDiscoveryResults.length > 0) {
        return `Showing ${jobDiscoveryResults.length.toLocaleString()} jobs from the current search.`;
      }
      return "No job results in the current search yet.";
    }
    return "Run a search from Home to populate Discovery.";
  })();
  const topPageStatus = (() => {
    if (jobSearchError) {
      return null;
    }
    if (activeSection === "discovery") {
      return discoveryStatus;
    }
    return instantlyStatusMessage;
  })();

  const handleSendToInstantly = async () => {
    try {
      setIsSendingToInstantly(true);
      setJobSearchError(null);
      setInstantlyStatusMessage(null);
      const selectedJobKeySet = new Set(selectedSavedJobKeys);
      let selectedJobs = savedJobs.filter((job) =>
        selectedJobKeySet.has(job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`)
      );
      if (selectedJobs.length === 0) {
        return;
      }

      const jobsMissingContacts = selectedJobs.filter(
        (job) => !Array.isArray(job.company_contacts) || job.company_contacts.length === 0
      );

      if (jobsMissingContacts.length > 0) {
        setInstantlyStatusMessage(
          `Running Apollo enrichment for ${jobsMissingContacts.length.toLocaleString()} selected job${jobsMissingContacts.length === 1 ? "" : "s"} before export.`
        );
        const titles = jobsApolloTitleInput
          .split(",")
          .map((title) => title.trim())
          .filter(Boolean);
        const enrichmentResponse = await fetch("/api/jobs/enrich", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            role: jobRole.trim(),
            source: savedJobsSourceFilter,
            force: true,
            max_companies: PAGE_SIZE,
            titles,
            selected_job_keys: jobsMissingContacts.map(
              (job) => job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`
            ),
            selected_company_keys: Array.from(
              new Set(
                jobsMissingContacts
                  .map((job) => job.company_key)
                  .filter((value): value is string => Boolean(value))
              )
            ),
          }),
        });
        const enrichmentData = await enrichmentResponse.json();
        if (!enrichmentResponse.ok) {
          throw new Error(enrichmentData?.error || "Apollo enrichment rerun failed.");
        }
        const runId =
          typeof enrichmentData?.apollo_enrichment_run_id === "string"
            ? enrichmentData.apollo_enrichment_run_id
            : null;
        if (!runId) {
          throw new Error("Apollo enrichment did not return a run id.");
        }
        setApolloEnrichmentRunId(runId);
        setApolloEnrichmentStatus(
          enrichmentData?.apollo_enrichment_status && typeof enrichmentData.apollo_enrichment_status === "object"
            ? enrichmentData.apollo_enrichment_status
            : null
        );
        await waitForApolloEnrichment(runId);
        const refreshedJobs = await fetchSavedJobs(
          savedJobsPage,
          savedJobsSourceFilter,
          savedJobsRoleFilter,
          savedJobsHasContactsFilter,
          savedJobsContactTitleFilter,
          false
        );
        selectedJobs = refreshedJobs.filter((job: any) =>
          selectedJobKeySet.has(job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`)
        );
      }

      setInstantlyStatusMessage(
        `Generating outreach and sending ${selectedJobs.length.toLocaleString()} selected job${selectedJobs.length === 1 ? "" : "s"} to Instantly.`
      );
      const response = await fetch("/api/jobs/instantly", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignId: "65e808d0-6f98-476a-815d-05b45b96c043",
          jobs: selectedJobs,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to send leads to Instantly.");
      }
      setInstantlyStatusMessage(
        `Instantly export complete. ${Number(data?.sent_count || 0).toLocaleString()} leads sent from ${Number(data?.approved_count || 0).toLocaleString()} approved jobs.`
      );
      await fetchHomeAnalytics();
    } catch (error) {
      setJobSearchError(error instanceof Error ? error.message : "Failed to send leads to Instantly.");
    } finally {
      setIsSendingToInstantly(false);
    }
  };

  const handleGenerateJobEmailContent = async () => {
    if (!selectedContentJobKey) {
      return;
    }
    const job = savedJobs.find(
      (item) => (item.job_key || item.apply_url || item.url || `${item.source}-${item.id}`) === selectedContentJobKey
    );
    if (!job) {
      setJobEmailContentError("Selected job could not be found.");
      return;
    }
    try {
      setIsJobEmailContentLoading(true);
      setJobEmailContentError(null);
      setJobEmailContent(null);
      const response = await fetch("/api/jobs/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job,
          referenceContext: jobReferenceContent.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to generate job content.");
      }
      setJobEmailContent(data);
    } catch (error) {
      setJobEmailContentError(error instanceof Error ? error.message : "Failed to generate job content.");
    } finally {
      setIsJobEmailContentLoading(false);
    }
  };

  const handleGenerateCompanyEmailContent = async () => {
    if (!selectedContentCompanyId) {
      return;
    }
    try {
      setIsCompanyEmailContentLoading(true);
      setCompanyEmailContentError(null);
      setCompanyEmailContent(null);
      const companyResponse = await fetch(`/api/companies/${selectedContentCompanyId}`, { cache: "no-store" });
      const companyData = await companyResponse.json();
      if (!companyResponse.ok) {
        throw new Error(companyData?.error || companyData?.detail || "Failed to load company.");
      }
      const response = await fetch("/api/companies/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: companyData?.company,
          referenceContext: companyReferenceContent.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to generate investor content.");
      }
      setCompanyEmailContent(data);
    } catch (error) {
      setCompanyEmailContentError(error instanceof Error ? error.message : "Failed to generate investor content.");
    } finally {
      setIsCompanyEmailContentLoading(false);
    }
  };

  const renderContentSection = () => (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Reference Content</p>
        <h2 className="mt-2 text-base font-semibold text-white">Standard email reference content for both workflows</h2>
        <p className="mt-2 text-sm text-slate-400">
          Use these text boxes as the reference point for generating email content in the job and organisation workflows.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
      <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Job Pipeline</p>
        <h2 className="mt-2 text-base font-semibold text-white">Job workflow email reference</h2>
        <p className="mt-2 text-sm text-slate-400">
          This text is used when generating email content for job-posting outreach to the right hiring ICPs.
        </p>
        <div className="mt-4 space-y-3">
          <textarea
            value={jobReferenceContent}
            onChange={(event) => setJobReferenceContent(event.target.value)}
            className="min-h-[18rem] w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-3 text-sm text-slate-100 outline-none"
          />
          <div className="flex justify-between gap-3 text-xs text-slate-500">
            <span>{jobReferenceContent.trim() ? `${jobReferenceContent.trim().length.toLocaleString()} chars loaded` : "No reference content added yet"}</span>
            <button
              type="button"
              onClick={() => setJobReferenceContent(JOB_REFERENCE_DEFAULT)}
              disabled={jobReferenceContent === JOB_REFERENCE_DEFAULT}
              className="text-slate-400 transition hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset to default
            </button>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <select
            value={selectedContentJobKey}
            onChange={(event) => setSelectedContentJobKey(event.target.value)}
            className="flex-1 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="">Select a saved job</option>
            {savedJobs.map((job) => {
              const jobKey = job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`;
              return (
                <option key={jobKey} value={jobKey}>
                  {job.title || "Untitled role"} · {job.organization || "Unknown company"}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            onClick={handleGenerateJobEmailContent}
            disabled={!selectedContentJobKey || isJobEmailContentLoading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isJobEmailContentLoading ? "Generating..." : "Generate Email Content"}
          </button>
        </div>
        {jobEmailContentError && <p className="mt-3 text-sm text-rose-300">{jobEmailContentError}</p>}
        {jobEmailContent && (
          <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800/80 bg-slate-950/60 p-4 text-xs text-slate-200">
            {JSON.stringify(jobEmailContent, null, 2)}
          </pre>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Organisation Pipeline</p>
        <h2 className="mt-2 text-base font-semibold text-white">Organisation workflow email reference</h2>
        <p className="mt-2 text-sm text-slate-400">
          This text is used when generating partnership email content for organisation-search outreach to the right ICPs.
        </p>
        <div className="mt-4 space-y-3">
          <textarea
            value={companyReferenceContent}
            onChange={(event) => setCompanyReferenceContent(event.target.value)}
            className="min-h-[18rem] w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-3 text-sm text-slate-100 outline-none"
          />
          <div className="flex justify-between gap-3 text-xs text-slate-500">
            <span>{companyReferenceContent.trim() ? `${companyReferenceContent.trim().length.toLocaleString()} chars loaded` : "No reference content added yet"}</span>
            <button
              type="button"
              onClick={() => setCompanyReferenceContent(COMPANY_REFERENCE_DEFAULT)}
              disabled={companyReferenceContent === COMPANY_REFERENCE_DEFAULT}
              className="text-slate-400 transition hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset to default
            </button>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <select
            value={selectedContentCompanyId}
            onChange={(event) => setSelectedContentCompanyId(event.target.value)}
            className="flex-1 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="">Select a saved company</option>
            {savedCompaniesForContent.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name} {company.hq ? `· ${company.hq}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleGenerateCompanyEmailContent}
            disabled={!selectedContentCompanyId || isCompanyEmailContentLoading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCompanyEmailContentLoading ? "Generating..." : "Generate Email Content"}
          </button>
        </div>
        {companyEmailContentError && <p className="mt-3 text-sm text-rose-300">{companyEmailContentError}</p>}
        {companyEmailContent && (
          <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800/80 bg-slate-950/60 p-4 text-xs text-slate-200">
            {JSON.stringify(companyEmailContent, null, 2)}
          </pre>
        )}
      </div>
      </div>
    </div>
  );

  const renderDiscoverySection = () => (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Current Search</p>
        <p className="mt-3 text-base font-semibold text-white">
          {activeDiscoveryKind === "companies"
            ? "Investor Search"
            : activeDiscoveryKind === "jobs"
            ? "Job Search"
            : "No Active Search"}
        </p>
        <p className="mt-2 text-sm text-slate-400">{discoveryStatus}</p>
        {activeDiscoveryKind === "jobs" && apolloEnrichmentStatus && (
          <p className="mt-2 text-sm text-slate-500">
            {Number(apolloEnrichmentStatus.completed_companies || 0).toLocaleString()} / {Number(apolloEnrichmentStatus.total_companies || 0).toLocaleString()} companies processed
          </p>
        )}
      </div>

      {(isCompanyDiscoveryLoading || isJobDiscoveryLoading) && (
        <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6">
          <div className="flex items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-400" />
            <div>
              <p className="text-sm font-semibold text-white">Fetching current discovery results</p>
              <p className="mt-1 text-sm text-slate-400">{discoveryStatus}</p>
            </div>
          </div>
        </div>
      )}

      {activeDiscoveryKind === "jobs" ? (
        <>
          <JobsTable
            title="Current Job Results"
            jobs={jobDiscoveryResults}
            isLoading={isJobSearchLoading}
            emptyMessage="No jobs have been discovered in the current search yet."
            subtitle={
              lastJobRunSummary
                ? `${lastJobRunSummary.collectedCount.toLocaleString()} fetched, ${lastJobRunSummary.uniqueCount.toLocaleString()} unique, ${lastJobRunSummary.savedTotal.toLocaleString()} saved total`
                : "Current search results"
            }
          />

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Fetched</p>
              <p className="mt-3 text-2xl font-semibold text-white">
                {lastJobRunSummary ? lastJobRunSummary.collectedCount.toLocaleString() : "0"}
              </p>
              <p className="mt-2 text-sm text-slate-400">Total jobs returned across all selected sources.</p>
            </div>
            <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Unique</p>
              <p className="mt-3 text-2xl font-semibold text-white">
                {lastJobRunSummary ? lastJobRunSummary.uniqueCount.toLocaleString() : "0"}
              </p>
              <p className="mt-2 text-sm text-slate-400">Deduplicated jobs shown in discovery.</p>
            </div>
            <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Saved</p>
              <p className="mt-3 text-2xl font-semibold text-white">
                {lastJobRunSummary ? lastJobRunSummary.savedTotal.toLocaleString() : savedJobsTotal.toLocaleString()}
              </p>
              <p className="mt-2 text-sm text-slate-400">Jobs currently persisted in SQL.</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowJobResponseLog((current) => !current)}
              className="rounded-lg border border-slate-700/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-900"
            >
              {showJobResponseLog ? "Hide Log" : "Display Log"}
            </button>
          </div>

          {showJobResponseLog && (
            <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-base font-semibold text-slate-100">Latest Job Search Response</p>
                  <p className="mt-1 text-sm text-slate-400">Most recent response payload from the current job workflow.</p>
                </div>
              </div>
              <pre className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800/80 bg-slate-950/60 p-4 text-xs text-slate-200">
                {JSON.stringify(latestJobResponse ?? { fetched_jobs: jobDiscoveryResults }, null, 2)}
              </pre>
            </div>
          )}
        </>
      ) : activeDiscoveryKind === "companies" ? (
        <div className="space-y-4">
          {(loading || isCompanyAutomationRunning) && companyProgressUpdates.length > 0 && (
            <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Live Progress</p>
              <div className="mt-4 space-y-2">
                {companyProgressUpdates.map((update, index) => (
                  <p key={`${update}-${index}`} className="text-sm text-slate-300">
                    {update}
                  </p>
                ))}
              </div>
            </div>
          )}
        <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70">
          <div className="border-b border-slate-800/70 px-5 py-4">
            <p className="text-base font-semibold text-slate-100">Current Company Results</p>
            <p className="mt-1 text-sm text-slate-400">Only results from the latest investor search are shown here.</p>
          </div>
          {companyDiscoveryResults.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-400">No companies have been returned yet for the current investor search.</div>
          ) : (
            <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
              {companyDiscoveryResults.map((company) => (
                <div key={`${company.websiteUrl || company.name}`} className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
                  <p className="text-sm font-semibold text-white">{company.name}</p>
                  <div className="mt-3 space-y-2 text-xs text-slate-300">
                    <p>HQ: {company.hq || "—"}</p>
                    <p>Website: {company.websiteUrl || "—"}</p>
                    <p>LinkedIn: {company.linkedinUrl || "—"}</p>
                    <p>Source: {company.source || "—"}</p>
                    <p>Portfolio Companies: {(company.portfolioCompanies?.length || 0).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 text-sm text-slate-400">
          Discovery only shows the current search results from Home.
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen w-full bg-slate-950 text-slate-100">
      <aside className="hidden w-64 flex-col border-r border-slate-800/80 bg-slate-900/70 p-6 lg:flex">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Lead Discovery
          </p>
          <h2 className="text-lg font-semibold text-white">Navigator</h2>
        </div>
        <nav className="mt-8 space-y-2">
          {navigationItems.map(({ label, icon: Icon, section, badge }) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setActiveSection(section);
                if (section === "jobs") {
                  void fetchSavedJobs(
                    1,
                    savedJobsSourceFilter,
                    savedJobsRoleFilter,
                    savedJobsHasContactsFilter,
                    savedJobsContactTitleFilter
                  );
                }
                if (section === "content") {
                  void fetchSavedJobs(1, savedJobsSourceFilter, savedJobsRoleFilter, savedJobsHasContactsFilter, savedJobsContactTitleFilter, false);
                  void fetchSavedCompaniesForContent();
                }
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                activeSection === section
                  ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200"
                  : "border-transparent text-slate-200 hover:border-slate-700/60 hover:bg-slate-900/80"
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-indigo-400" />
                <span>{label}</span>
              </span>
              {badge === "savedJobs" && savedJobsTotal > 0 && (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                  {savedJobsTotal.toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-xl border border-slate-800/70 bg-slate-900/80 p-4 text-xs text-slate-400">
          <p className="font-semibold text-slate-200">Insights Engine</p>
          <p className="mt-2">Run investor research and multi-platform job discovery from one workspace.</p>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-950/80 px-6 py-4 backdrop-blur">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Dashboard</p>
            <h1 className="text-lg font-semibold text-white">Lead Discovery Overview</h1>
          </div>
          <div className="flex items-center gap-3">
            {onNewResearch && (
              <button
                type="button"
                onClick={handleOpenNewSearch}
                className="rounded-lg border border-slate-700/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-900"
              >
                New Search
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowJobDebug(true)}
              disabled={jobDebugLog.length === 0}
              className="rounded-lg border border-slate-700/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              View Job Logs
            </button>
            {onShareClick && currentResearchId && (
              <button
                type="button"
                onClick={onShareClick}
                className="rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/20"
              >
                Share Results
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 space-y-6 px-6 py-6">
          {jobSearchError && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {jobSearchError}
            </div>
          )}
          {topPageStatus && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              {topPageStatus}
            </div>
          )}
          {activeSection === "home" ? (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Saved Jobs
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">{savedJobsTotal.toLocaleString()}</p>
                  <p className="mt-2 text-sm text-slate-400">Persisted job opportunities in SQL.</p>
                </div>
                <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Saved Firms
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">{savedCompaniesCount.toLocaleString()}</p>
                  <p className="mt-2 text-sm text-slate-400">Saved investment firms from company search.</p>
                </div>
                <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Instantly Jobs
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">{analyticsSummary.jobsSent.toLocaleString()}</p>
                  <p className="mt-2 text-sm text-slate-400">Leads sent to Instantly from jobs.</p>
                </div>
                <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Instantly Firms
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">{analyticsSummary.companiesSent.toLocaleString()}</p>
                  <p className="mt-2 text-sm text-slate-400">Leads sent to Instantly from company search.</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6">
                <button
                  type="button"
                  onClick={() => setOpenHomePanel((current) => (current === "investor" ? null : "investor"))}
                  className="flex w-full items-center justify-between gap-4 text-left"
                >
                  <div>
                    <p className="text-base font-semibold text-slate-100">Run a new investor search</p>
                    <p className="mt-1 text-sm text-slate-400">
                      Configure filters below and launch a new discovery run.
                    </p>
                  </div>
                  <ChevronDown
                    className={`h-5 w-5 text-slate-400 transition ${openHomePanel === "investor" ? "rotate-180" : ""}`}
                  />
                </button>
                {openHomePanel === "investor" && (
                  <div className="mt-6 space-y-6">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setActiveSection("companies")}
                        className="rounded-lg border border-slate-700/70 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-900"
                      >
                        View Saved Companies
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveSection("discovery")}
                        className="rounded-lg border border-slate-700/70 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-900"
                      >
                        Open Discovery
                      </button>
                      <button
                        type="button"
                        onClick={handleInvestorSearch}
                        disabled={loading}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Run Search
                      </button>
                    </div>
                    <InvestorFilters
                      investorType={investorType ?? ""}
                      hqCountry={hqCountry ?? ""}
                      industry={industry ?? ""}
                      companyCount={companyCount ?? 10}
                      companySearchProvider={companySearchProvider ?? "apollo"}
                      runApolloEnrichmentAndContent={runCompanyApolloEnrichmentAndContent}
                      pushToInstantly={pushCompaniesToInstantlyAfterSearch}
                      onInvestorTypeChange={setInvestorType ?? (() => {})}
                      onHqCountryChange={setHqCountry ?? (() => {})}
                      onIndustryChange={setIndustry ?? (() => {})}
                      onCompanyCountChange={setCompanyCount ?? (() => {})}
                      onCompanySearchProviderChange={setCompanySearchProvider ?? (() => {})}
                      onRunApolloEnrichmentAndContentChange={setRunCompanyApolloEnrichmentAndContent}
                      onPushToInstantlyChange={setPushCompaniesToInstantlyAfterSearch}
                      className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4"
                    />
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6">
                <button
                  type="button"
                  onClick={() => setOpenHomePanel((current) => (current === "jobs" ? null : "jobs"))}
                  className="flex w-full items-center justify-between gap-4 text-left"
                >
                  <div>
                    <p className="text-base font-semibold text-slate-100">Run a new job search</p>
                    <p className="mt-1 text-sm text-slate-400">
                      Search ATS job boards and enrich saved jobs from the same workspace.
                    </p>
                  </div>
                  <ChevronDown
                    className={`h-5 w-5 text-slate-400 transition ${openHomePanel === "jobs" ? "rotate-180" : ""}`}
                  />
                </button>
                {openHomePanel === "jobs" && (
                  <div className="mt-6">
                    <JobSearchForm
                      role={jobRole}
                      location={jobLocation}
                      dateFilter={jobDateFilter}
                      jobType={jobType}
                      sources={jobSources}
                      useApolloEnrichment={useApolloEnrichment}
                      isLoading={isJobSearchLoading}
                      onRoleChange={setJobRole}
                      onLocationChange={setJobLocation}
                      onDateFilterChange={setJobDateFilter}
                      onJobTypeChange={setJobType}
                      onSourcesChange={setJobSources}
                      onApolloEnrichmentChange={setUseApolloEnrichment}
                      onSubmit={handleJobSearch}
                      lastRunSummary={lastJobRunSummary}
                      latestResults={jobDiscoveryResults}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : activeSection === "companies" ? (
            <SavedCompaniesTable />
          ) : activeSection === "jobs" ? (
            <JobsTable
              title="Saved Jobs"
              jobs={savedJobs}
              isLoading={isSavedJobsLoading}
              emptyMessage="No jobs have been saved yet."
              totalCount={savedJobsTotal}
              subtitle="Filter the persisted SQL dataset by source, role, and Apollo contact coverage."
              sourceFilter={savedJobsSourceFilter}
              onSourceFilterChange={(value) => {
                setSavedJobsSourceFilter(value);
                void fetchSavedJobs(
                  1,
                  value,
                  savedJobsRoleFilter,
                  savedJobsHasContactsFilter,
                  savedJobsContactTitleFilter
                );
              }}
              enableRoleFilter
              roleFilter={savedJobsRoleFilter}
              onRoleFilterChange={(value) => {
                setSavedJobsRoleFilter(value);
                void fetchSavedJobs(
                  1,
                  savedJobsSourceFilter,
                  value,
                  savedJobsHasContactsFilter,
                  savedJobsContactTitleFilter
                );
              }}
              locationFilter={savedJobsLocationFilter}
              onLocationFilterChange={setSavedJobsLocationFilter}
              hasContactsFilter={savedJobsHasContactsFilter}
              onHasContactsFilterChange={(value) => {
                setSavedJobsHasContactsFilter(value);
                void fetchSavedJobs(
                  1,
                  savedJobsSourceFilter,
                  savedJobsRoleFilter,
                  value,
                  savedJobsContactTitleFilter
                );
              }}
              contactTitleFilter={savedJobsContactTitleFilter}
              onContactTitleFilterChange={(value) => {
                setSavedJobsContactTitleFilter(value);
                void fetchSavedJobs(
                  1,
                  savedJobsSourceFilter,
                  savedJobsRoleFilter,
                  savedJobsHasContactsFilter,
                  value
                );
              }}
              onRerunEnrichment={() => setIsJobsApolloModalOpen(true)}
              isRerunningEnrichment={isRerunningApollo}
              onSendToInstantly={handleSendToInstantly}
              isSendingToInstantly={isSendingToInstantly}
              sentToInstantlyJobKeys={analyticsSummary.sentJobKeys}
              selectedJobKeys={selectedSavedJobKeys}
              onToggleJobSelection={(job, checked) => {
                const jobKey = job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`;
                setSelectedSavedJobKeys((current) =>
                  checked
                    ? Array.from(new Set([...current, jobKey]))
                    : current.filter((value) => value !== jobKey)
                );
              }}
              onToggleAllVisible={(jobs, checked) => {
                const visibleKeys = jobs.map((job) => job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`);
                setSelectedSavedJobKeys((current) => {
                  if (checked) {
                    return Array.from(new Set([...current, ...visibleKeys]));
                  }
                  const visibleKeySet = new Set(visibleKeys);
                  return current.filter((value) => !visibleKeySet.has(value));
                });
              }}
              page={savedJobsPage}
              pageSize={PAGE_SIZE}
              onPreviousPage={() =>
                void fetchSavedJobs(
                  Math.max(savedJobsPage - 1, 1),
                  savedJobsSourceFilter,
                  savedJobsRoleFilter,
                  savedJobsHasContactsFilter,
                  savedJobsContactTitleFilter
                )
              }
              onNextPage={() =>
                void fetchSavedJobs(
                  savedJobsPage + 1,
                  savedJobsSourceFilter,
                  savedJobsRoleFilter,
                  savedJobsHasContactsFilter,
                  savedJobsContactTitleFilter
                )
              }
              isPaginated
            />
          ) : activeSection === "content" ? (
            renderContentSection()
          ) : (
            renderDiscoverySection()
          )}
        </main>
      </div>

      {showJobDebug && jobDebugLog.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowJobDebug(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-950 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Job Search Logs</h3>
                <p className="text-sm text-slate-400">Current discovery run</p>
              </div>
              <button
                type="button"
                onClick={() => setShowJobDebug(false)}
                className="rounded-full border border-slate-700/70 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <pre className="mt-4 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800/80 bg-slate-900/70 p-4 text-xs text-slate-200">
              {JSON.stringify(jobDebugLog, null, 2)}
            </pre>
          </div>
        </div>
      )}
      {isJobsApolloModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setIsJobsApolloModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-700/60 bg-slate-950 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Select roles to enrich</h3>
                <p className="text-sm text-slate-400">
                  {selectedSavedJobKeys.length} selected job{selectedSavedJobKeys.length === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsJobsApolloModalOpen(false)}
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
                  value={jobsApolloTitleInput}
                  onChange={(event) => setJobsApolloTitleInput(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  rows={3}
                />
                <p className="mt-2 text-[11px] text-slate-500">Separate titles with commas.</p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsJobsApolloModalOpen(false)}
                  className="rounded-lg border border-slate-700/70 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRerunApollo}
                  disabled={isRerunningApollo || selectedSavedJobKeys.length === 0}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRerunningApollo ? "Starting..." : "Start Apollo enrichment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showJobsApolloLogs && apolloEnrichmentStatus && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowJobsApolloLogs(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-950 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Apollo Enrichment Logs</h3>
                <p className="text-sm text-slate-400">
                  {String(apolloEnrichmentStatus.message || "Selected jobs Apollo run")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowJobsApolloLogs(false)}
                className="rounded-full border border-slate-700/70 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <pre className="mt-4 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800/80 bg-slate-900/70 p-4 text-xs text-slate-200">
              {JSON.stringify(apolloEnrichmentStatus, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
