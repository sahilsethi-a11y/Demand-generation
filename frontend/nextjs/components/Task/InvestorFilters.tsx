import React from "react";

type InvestorFiltersProps = {
  investorType: string;
  hqCountry: string;
  industry: string;
  companyCount: number;
  companySearchProvider: string;
  runApolloEnrichmentAndContent?: boolean;
  pushToInstantly?: boolean;
  onInvestorTypeChange: (value: string) => void;
  onHqCountryChange: (value: string) => void;
  onIndustryChange: (value: string) => void;
  onCompanyCountChange: (value: number) => void;
  onCompanySearchProviderChange: (value: string) => void;
  onRunApolloEnrichmentAndContentChange?: (value: boolean) => void;
  onPushToInstantlyChange?: (value: boolean) => void;
  className?: string;
};

const investorTypes = [
  "VC",
  "Private Equity",
  "Growth Equity",
  "Hedge Fund",
  "Angel",
  "Family Office",
  "Corporate VC",
  "Venture Debt",
  "Infrastructure",
  "Impact",
  "Real Estate",
  "Sovereign Wealth Fund",
];
const apolloInvestorTypes = new Set(["VC", "Private Equity"]);

const countries = ["United States", "India", "United Arab Emirates"];

const companyCountOptions = [5, 10, 20, 50, 100];

const InvestorFilters = ({
  investorType,
  hqCountry,
  industry,
  companyCount,
  companySearchProvider,
  runApolloEnrichmentAndContent = false,
  pushToInstantly = false,
  onInvestorTypeChange,
  onHqCountryChange,
  onIndustryChange,
  onCompanyCountChange,
  onCompanySearchProviderChange,
  onRunApolloEnrichmentAndContentChange,
  onPushToInstantlyChange,
  className = "",
}: InvestorFiltersProps) => {
  return (
    <div className={`space-y-3 ${className}`.trim()}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-2 text-sm text-gray-300">
          Investor Type
          <select
            value={investorType}
            onChange={(event) => onInvestorTypeChange(event.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="">Select type</option>
            {investorTypes.map((type) => (
              <option
                key={type}
                value={type}
                disabled={companySearchProvider === "apollo" && !apolloInvestorTypes.has(type)}
              >
                {type}
              </option>
            ))}
          </select>
          {companySearchProvider === "apollo" && (
            <span className="text-xs text-gray-500">Apollo company search is limited to VC and Private Equity.</span>
          )}
        </label>
        <label className="flex flex-col gap-2 text-sm text-gray-300">
          HQ Country
          <select
            value={hqCountry}
            onChange={(event) => onHqCountryChange(event.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="">Select country</option>
            {countries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-gray-300">
          Industry (Optional)
          <input
            type="text"
            value={industry}
            onChange={(event) => onIndustryChange(event.target.value)}
            placeholder="Fintech, Healthcare, SaaS"
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-gray-300">
          Number of Companies
          <select
            value={companyCount}
            onChange={(event) => onCompanyCountChange(Number(event.target.value))}
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            {companyCountOptions.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-gray-300">
          Company Search Provider
          <select
            value={companySearchProvider}
            onChange={(event) => onCompanySearchProviderChange(event.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="tavily">Tavily</option>
            <option value="apollo">Apollo</option>
          </select>
        </label>
      </div>
      {onRunApolloEnrichmentAndContentChange && (
        <div className="space-y-3">
          <label className="flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={runApolloEnrichmentAndContent}
              onChange={(event) => onRunApolloEnrichmentAndContentChange(event.target.checked)}
              className="h-4 w-4 rounded border-gray-700 bg-gray-950 text-teal-500 focus:ring-teal-500"
            />
            <span>
              Run Apollo employee enrichment and generate personalised partnership content for EMB Global
            </span>
          </label>
          {onPushToInstantlyChange && (
            <label className="flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={pushToInstantly}
                onChange={(event) => onPushToInstantlyChange(event.target.checked)}
                className="h-4 w-4 rounded border-gray-700 bg-gray-950 text-teal-500 focus:ring-teal-500"
              />
              <span>Push discovered company ICPs to Instantly after search</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
};

export default InvestorFilters;
