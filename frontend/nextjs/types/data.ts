export interface BaseData {
  type: string;
}

export interface BasicData extends BaseData {
  type: 'basic';
  content: string;
}

export interface LanggraphButtonData extends BaseData {
  type: 'langgraphButton';
  link: string;
}

export interface DifferencesData extends BaseData {
  type: 'differences';
  content: string;
  output: string;
}

export interface QuestionData extends BaseData {
  type: 'question';
  content: string;
}

export interface ChatData extends BaseData {
  type: 'chat';
  content: string;
  metadata?: any; // For storing search results and other contextual information
}

export interface SearchDebugData extends BaseData {
  type: 'search_debug';
  content: string;
  metadata?: Record<string, unknown>;
}

export type Data =
  | BasicData
  | LanggraphButtonData
  | DifferencesData
  | QuestionData
  | ChatData
  | SearchDebugData;

export interface MCPConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ChatBoxSettings {
  report_type: string;
  report_source: string;
  tone: string;
  domains: string[];
  defaultReportType: string;
  layoutType: string;
  mcp_enabled: boolean;
  mcp_configs: MCPConfig[];
  mcp_strategy?: string;
  company_search_provider?: string;
}

export interface Domain {
  value: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  metadata?: any; // For storing search results and other contextual information
}

export interface ResearchHistoryItem {
  id: string;
  question: string;
  answer: string;
  timestamp: number;
  orderedData: Data[];
  chatMessages?: ChatMessage[];
} 

export interface CompanyContact {
  name: string | null;
  title: string | null;
  email: string | null;
  linkedin_url?: string | null;
  apollo_person_id?: string | null;
  organization_id?: string | null;
  organization_domain?: string | null;
  confidence?: string | null;
}

export interface JobPosting {
  id: string | null;
  date_posted: string | null;
  date_created: string | null;
  title: string | null;
  organization: string | null;
  organization_url: string | null;
  date_validthrough: string | null;
  locations_raw: unknown[] | null;
  locations_alt_raw: unknown[] | null;
  location_type: string | null;
  location_requirements_raw: unknown[] | null;
  salary_raw: unknown | null;
  employment_type: string[] | null;
  url: string | null;
  source_type: string | null;
  source: "greenhouse" | "ashby" | "lever" | "apollo" | string;
  source_domain: string | null;
  organization_logo: string | null;
  cities_derived: string[] | null;
  regions_derived: string[] | null;
  countries_derived: string[] | null;
  counties_derived: string[] | null;
  locations_derived: string[] | null;
  timezones_derived: string[] | null;
  lats_derived: number[] | null;
  lngs_derived: number[] | null;
  remote_derived: boolean | null;
  domain_derived: string | null;
  date_modified: string | null;
  modified_fields: string[] | null;
  description_text: string | null;
  ai_salary_currency: string | null;
  ai_salary_value: number | null;
  ai_salary_minvalue: number | null;
  ai_salary_maxvalue: number | null;
  ai_salary_unittext: string | null;
  ai_benefits: string[] | null;
  ai_experience_level: string | null;
  ai_work_arrangement: string | null;
  ai_work_arrangement_office_days: number | null;
  ai_remote_location: string[] | null;
  ai_remote_location_derived: string[] | null;
  ai_key_skills: string[] | null;
  ai_hiring_manager_name: string | null;
  ai_hiring_manager_email_address: string | null;
  ai_core_responsibilities: string | null;
  ai_requirements_summary: string | null;
  ai_working_hours: number | null;
  ai_employment_type: string[] | null;
  ai_job_language: string | null;
  ai_visa_sponsorship: boolean | null;
  ai_keywords: string[] | null;
  ai_taxonomies_a: string[] | null;
  ai_education_requirements: string[] | null;
  listing_url?: string | null;
  apply_url?: string | null;
  display_location?: string | null;
  company_slug?: string | null;
  search_metadata?: Record<string, unknown> | null;
  raw_payload?: Record<string, unknown> | null;
  job_key?: string | null;
  company_key?: string | null;
  company_contacts?: CompanyContact[] | null;
  contacts_count?: number;
  apollo_enrichment_status?: string | null;
  apollo_enrichment_confidence?: string | null;
}
