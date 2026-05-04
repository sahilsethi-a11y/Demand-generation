import fs from "fs";
import path from "path";

type InstantlyMetrics = {
  jobs_sent: number;
  companies_sent: number;
  sent_job_keys: string[];
  sent_company_ids: string[];
};

const DEFAULT_METRICS: InstantlyMetrics = {
  jobs_sent: 0,
  companies_sent: 0,
  sent_job_keys: [],
  sent_company_ids: [],
};

function metricsPath() {
  return path.resolve(process.cwd(), "..", "..", "data", "instantly_metrics.json");
}

function ensureParentDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readInstantlyMetrics(): InstantlyMetrics {
  try {
    const filePath = metricsPath();
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_METRICS };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      jobs_sent: Number(parsed?.jobs_sent || 0),
      companies_sent: Number(parsed?.companies_sent || 0),
      sent_job_keys: Array.isArray(parsed?.sent_job_keys) ? parsed.sent_job_keys.map(String) : [],
      sent_company_ids: Array.isArray(parsed?.sent_company_ids) ? parsed.sent_company_ids.map(String) : [],
    };
  } catch {
    return { ...DEFAULT_METRICS };
  }
}

export function recordInstantlySend(
  pipeline: "jobs" | "companies",
  count: number,
  ids: string[] = []
) {
  const filePath = metricsPath();
  const metrics = readInstantlyMetrics();
  const safeCount = Math.max(0, Number(count || 0));
  const cleanedIds = ids.map((value) => String(value || "").trim()).filter(Boolean);
  const nextMetrics: InstantlyMetrics = {
    ...metrics,
    jobs_sent: pipeline === "jobs" ? metrics.jobs_sent + safeCount : metrics.jobs_sent,
    companies_sent: pipeline === "companies" ? metrics.companies_sent + safeCount : metrics.companies_sent,
    sent_job_keys:
      pipeline === "jobs"
        ? Array.from(new Set([...metrics.sent_job_keys, ...cleanedIds]))
        : metrics.sent_job_keys,
    sent_company_ids:
      pipeline === "companies"
        ? Array.from(new Set([...metrics.sent_company_ids, ...cleanedIds]))
        : metrics.sent_company_ids,
  };
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(nextMetrics, null, 2), "utf8");
  return nextMetrics;
}
