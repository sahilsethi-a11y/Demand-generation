import React, { useEffect, useState } from "react";

type SavedEmployee = {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
};

type SavedCompany = {
  id: string;
  name: string;
  website_url?: string;
  linkedin_url?: string;
  portfolio_companies?: string[];
  hq?: string;
  source?: string;
  apollo_org_id?: string;
  organization_domain?: string;
  employees?: SavedEmployee[];
  total_employees_count?: number;
  icp_employees_count?: number;
  employees_count?: number;
};

const SavedCompaniesSidebar = () => {
  const [companies, setCompanies] = useState<SavedCompany[]>([]);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const apiBaseUrl = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

  const fetchCompanies = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${apiBaseUrl}/api/companies?include_employees=false&page=1&page_size=25`);
      if (!response.ok) {
        throw new Error("Failed to load companies.");
      }
      const data = await response.json();
      const list = Array.isArray(data?.companies) ? data.companies : [];
      setCompanies(list);
      setTotalCompanies(typeof data?.total === "number" ? data.total : list.length);
    } catch (error) {
      setCompanies([]);
      setTotalCompanies(0);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
    const interval = window.setInterval(fetchCompanies, 15000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <aside className="hidden h-full w-80 flex-shrink-0 border-r border-slate-800/80 bg-slate-950/90 px-4 py-6 lg:block">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Saved companies</p>
          <h2 className="text-sm font-semibold text-slate-100">{totalCompanies} stored</h2>
        </div>
        <button
          type="button"
          onClick={fetchCompanies}
          className="rounded-full border border-slate-700/70 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 220px)" }}>
        {isLoading && (
          <p className="text-xs text-slate-400">Loading saved companies...</p>
        )}
        {!isLoading && companies.length === 0 && (
          <p className="text-xs text-slate-500">No saved companies yet.</p>
        )}
        {companies.map((company) => (
          <div
            key={company.id}
            className="w-full rounded-xl border border-slate-800/80 bg-slate-900/50 px-3 py-2 text-left"
          >
            <p className="text-sm font-semibold text-slate-100">{company.name}</p>
            <p className="text-xs text-slate-400">
              {company.hq || "HQ unknown"}
            </p>
            <p className="text-[11px] text-slate-500">
              ICPs: {company.icp_employees_count ?? company.employees_count ?? company.employees?.length ?? 0}
            </p>
          </div>
        ))}
      </div>
    </aside>
  );
};

export default SavedCompaniesSidebar;
