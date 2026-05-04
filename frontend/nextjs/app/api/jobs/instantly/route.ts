import { NextResponse } from "next/server";
import { generateJobOutreach, JobPosting, readEnvFileValue } from "@/lib/jobOutreach";
import { recordInstantlySend } from "@/lib/instantlyMetrics";

const INSTANTLY_API_URL = "https://api.instantly.ai/api/v2/leads/add";
const DEFAULT_CAMPAIGN_ID = "65e808d0-6f98-476a-815d-05b45b96c043";

type InstantlyRequest = {
  jobs?: JobPosting[];
  campaignId?: string;
};

function splitName(value: string | null | undefined) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || "",
    last_name: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

export async function POST(request: Request) {
  let body: InstantlyRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }

  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  if (jobs.length === 0) {
    return NextResponse.json({ error: "At least one job is required." }, { status: 400 });
  }

  const apiKey = process.env.INSTANTLY_API_KEY ?? readEnvFileValue("INSTANTLY_API_KEY");
  if (!apiKey) {
    return NextResponse.json({ error: "INSTANTLY_API_KEY is not configured." }, { status: 500 });
  }

  const campaignId = body.campaignId || DEFAULT_CAMPAIGN_ID;
  const results = await Promise.all(
    jobs.map(async (job) => {
      const outreach = await generateJobOutreach(job);
      return {
        job_key: job.job_key || job.apply_url || job.url || `${job.source}-${job.id}`,
        job_title: job.title || "",
        company_name: job.organization || "",
        status: outreach.status,
        qa_status: outreach.qa.qa_status,
        approved_for_export: outreach.qa.approved_for_export,
        issues: outreach.qa.issues,
        instantly_payload: outreach.instantly_payload,
      };
    })
  );

  const approved = results.filter((result) => result.approved_for_export && result.instantly_payload);
  if (approved.length === 0) {
    return NextResponse.json({
      campaign_id: campaignId,
      selected_count: jobs.length,
      generated_count: results.length,
      approved_count: 0,
      sent_count: 0,
      status: "needs_review",
      results,
    });
  }

  const instantlyLeads = approved.map((result) => {
    const payload = result.instantly_payload!;
    const nameParts = splitName(payload.first_name);
    return {
      email: payload.to_email,
      first_name: payload.first_name || nameParts.first_name,
      last_name: nameParts.last_name,
      company_name: payload.company_name,
      website: payload.company_domain ? `https://${payload.company_domain}` : null,
      personalization: payload.email_body,
      custom_variables: {
        subject_1: payload.subject_1,
        subject_2: payload.subject_2,
        email_body: payload.email_body,
        signal_summary: payload.signal_summary,
        job_title: payload.job_title,
        company_name: payload.company_name,
        company_domain: payload.company_domain,
        contact_title: payload.contact_title,
        priority: payload.priority,
        source: payload.source,
        first_name: payload.first_name || nameParts.first_name,
      },
    };
  });

  const response = await fetch(INSTANTLY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      campaign_id: campaignId,
      skip_if_in_workspace: true,
      leads: instantlyLeads,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      {
        error: data?.message || data?.error || "Failed to send leads to Instantly.",
        campaign_id: campaignId,
        selected_count: jobs.length,
        approved_count: approved.length,
        results,
        instantly_response: data,
      },
      { status: response.status }
    );
  }

  const sentCount = Number(data?.created_count || data?.created_leads?.length || approved.length);
  const metrics = recordInstantlySend(
    "jobs",
    sentCount,
    approved.map((result) => String(result.job_key || "").trim()).filter(Boolean)
  );
  return NextResponse.json({
    campaign_id: campaignId,
    selected_count: jobs.length,
    generated_count: results.length,
    approved_count: approved.length,
    sent_count: sentCount,
    status: "sent",
    results,
    instantly_response: data,
    metrics,
  });
}
