export type InvestorFilters = {
  investorType: string;
  hqCountry: string;
  industry?: string;
  companyCount: number;
  companySearchProvider?: string;
};

export const buildInvestorQuery = (baseQuery: string, filters: InvestorFilters) => {
  const trimmedBaseQuery = baseQuery.trim();
  const trimmedIndustry = filters.industry?.trim();
  const companyCount = filters.companyCount || 10;
  const provider = (filters.companySearchProvider || "apollo").trim().toLowerCase();

  const investorDescriptor = filters.investorType
    ? `${filters.investorType} investors`
    : "investors";
  const hqDescriptor = filters.hqCountry
    ? `headquartered in ${filters.hqCountry}`
    : "";
  const industryDescriptor = trimmedIndustry
    ? `focused on ${trimmedIndustry}`
    : "";

  const descriptors = [hqDescriptor, industryDescriptor].filter(Boolean).join(", ");
  const baseClause = descriptors
    ? `${investorDescriptor} ${descriptors}`
    : investorDescriptor;
  const contextClause = trimmedBaseQuery
    ? `Additional context: ${trimmedBaseQuery}.`
    : "";

  if (provider === "apollo") {
    return `Find ${baseClause}. ${contextClause}Use Apollo company discovery only. Return ${companyCount} companies only. Return only a concise table with columns: Company, HQ, Website URL, LinkedIn URL, Portfolio Companies, and Source. Set Source to Apollo. Ensure every row includes a website link and LinkedIn profile when available. Do not include narrative analysis.`.trim();
  }

  return `Find ${baseClause}. ${contextClause}Prioritize sources from Crunchbase, Harmonic, Tracxn, Sales Navigator, and PitchBook. Return ${companyCount} companies only. Return only a concise table with columns: Company, HQ, Website URL, LinkedIn URL, Portfolio Companies (as listed on their website), and Source (platform name such as Crunchbase, Tracxn, PitchBook, Harmonic, or Sales Navigator). Ensure every row includes a website link, LinkedIn profile, portfolio companies, and source platform. Do not include narrative analysis.`.trim();
};
