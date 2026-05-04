import { NextResponse } from "next/server";
import { generateCompanyOutreach, CompanyRecord } from "@/lib/companyOutreach";
import { recordInstantlySend } from "@/lib/instantlyMetrics";
import { readEnvFileValue } from "@/lib/jobOutreach";

const INSTANTLY_API_URL = "https://api.instantly.ai/api/v2/leads/add";
const DEFAULT_CAMPAIGN_ID = "4ca0b9f8-77a5-49fb-92e3-d428ffa8dbf9";

type CompanyInstantlyRequest = {
  companies?: CompanyRecord[];
  campaignId?: string;
  referenceContext?: string;
};

export async function POST(request: Request) {
  let body: CompanyInstantlyRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }

  const companies = Array.isArray(body.companies) ? body.companies : [];
  if (!companies.length) {
    return NextResponse.json({ error: "At least one company is required." }, { status: 400 });
  }

  const apiKey = process.env.INSTANTLY_API_KEY ?? readEnvFileValue("INSTANTLY_API_KEY");
  if (!apiKey) {
    return NextResponse.json({ error: "INSTANTLY_API_KEY is not configured." }, { status: 500 });
  }

  const campaignId = body.campaignId || DEFAULT_CAMPAIGN_ID;
  const skippedAlreadySent = companies.flatMap((company) => {
    const icps = Array.isArray(company.employees) ? company.employees : [];
    return icps
      .filter((employee) => employee?.instantly_sent)
      .map((employee) => ({
        company_id: company.id || company.name || "",
        company_name: company.name || "",
        employee_email: employee.email || "",
        employee_name: employee.name || "",
        employee_title: employee.title || "",
        status: "already_sent",
        qa_status: "passed",
        approved_for_export: false,
        issues: ["Skipped because this ICP was already sent to Instantly."],
        instantly_payload: employee.generated_instantly_payload || null,
        email_generation: employee.generated_outreach_result?.email_generation || null,
      }));
  });
  const eligibleCompanies = companies
    .map((company) => ({
      ...company,
      employees: (Array.isArray(company.employees) ? company.employees : []).filter((employee) => !employee?.instantly_sent),
    }))
    .filter((company) => Array.isArray(company.employees) && company.employees.length > 0);

  if (!eligibleCompanies.length) {
    return NextResponse.json({
      campaign_id: campaignId,
      selected_count: companies.length,
      approved_count: 0,
      sent_count: 0,
      skipped_count: skippedAlreadySent.length,
      status: "already_sent",
      message: "All shortlisted ICPs for the selected companies were already sent to Instantly.",
      results: skippedAlreadySent,
    });
  }

  const results = await Promise.all(
    eligibleCompanies.flatMap((company) => {
      const icps = Array.isArray(company.employees) ? company.employees : [];
      return icps.map(async (employee) => {
        const outreach = await generateCompanyOutreach(
          {
            ...company,
            employees: [employee],
          },
          body.referenceContext
        );
        return {
          company_id: company.id || company.name || "",
          company_name: company.name || "",
          employee_email: employee.email || "",
          employee_name: employee.name || "",
          employee_title: employee.title || "",
          status: outreach.status,
          qa_status: outreach.qa.qa_status,
          approved_for_export: outreach.qa.approved_for_export,
          issues: outreach.qa.issues,
          instantly_payload: outreach.instantly_payload,
          email_generation: outreach.email_generation,
        };
      });
    })
  );
  const combinedResults = [...results, ...skippedAlreadySent];

  const approved = results.filter((result) => result.approved_for_export && result.instantly_payload);
  if (!approved.length) {
    return NextResponse.json({
      campaign_id: campaignId,
      selected_count: companies.length,
      approved_count: 0,
      sent_count: 0,
      skipped_count: skippedAlreadySent.length,
      status: "needs_review",
      results: combinedResults,
    });
  }

  const leads = approved.map((result) => {
    const payload = result.instantly_payload!;
    return {
      email: payload.to_email,
      first_name: payload.first_name,
      last_name: "",
      company_name: payload.firm_name,
      website: payload.firm_domain ? `https://${payload.firm_domain}` : null,
      personalization: payload.email_body,
      custom_variables: {
        campaign_type: payload.campaign_type,
        subject_1: payload.subject_1,
        subject_2: payload.subject_2,
        email_body: payload.email_body,
        signal_summary: payload.partnership_signal_summary,
        firm_name: payload.firm_name,
        firm_domain: payload.firm_domain,
        contact_title: payload.contact_title,
        first_name: payload.first_name,
        pain_point: payload.pain_point,
        value_prop: payload.value_prop,
        cta_angle: payload.cta_angle,
        partnership_signal_summary: payload.partnership_signal_summary,
        priority: payload.priority,
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
      leads,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      {
        error: data?.message || data?.error || "Failed to send company leads to Instantly.",
        campaign_id: campaignId,
        approved_count: approved.length,
        skipped_count: skippedAlreadySent.length,
        results: combinedResults,
        instantly_response: data,
      },
      { status: response.status }
    );
  }

  const sentCount = Number(data?.created_count || data?.created_leads?.length || approved.length);
  const backendUrl = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";
  const updatedCompanies = companies.map((company) => {
    const approvedForCompany = approved.filter(
      (result) => String(result.company_id || "") === String(company.id || company.name || "")
    );
    if (!approvedForCompany.length) {
      return company;
    }
    const nextEmployees = (Array.isArray(company.employees) ? company.employees : []).map((employee) => {
      const employeeEmail = String(employee.email || "").trim().toLowerCase();
      const matched = approvedForCompany.find(
        (result) => String(result.employee_email || "").trim().toLowerCase() === employeeEmail
      );
      if (!matched) {
        return employee;
      }
      return {
        ...employee,
        instantly_sent: true,
        instantly_sent_at: new Date().toISOString(),
        instantly_campaign_id: campaignId,
        generated_email_text: matched.email_generation?.full_email_text || employee.generated_email_text,
        generated_email_subjects: matched.email_generation?.subject_options || employee.generated_email_subjects,
        generated_instantly_payload:
          matched.instantly_payload && typeof matched.instantly_payload === "object"
            ? matched.instantly_payload
            : employee.generated_instantly_payload,
        generated_outreach_result:
          matched && typeof matched === "object"
            ? matched
            : employee.generated_outreach_result,
      };
    });
    return {
      ...company,
      employees: nextEmployees,
      icp_employees_count: nextEmployees.length,
    };
  });
  await Promise.all(
    updatedCompanies
      .filter((company) => company.id)
      .map(async (company) => {
        const updateResponse = await fetch(`${backendUrl}/api/companies`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(company),
          cache: "no-store",
        });
        if (!updateResponse.ok) {
          const updatePayload = await updateResponse.json().catch(() => ({}));
          throw new Error(updatePayload?.error || `Failed to persist Instantly send status for ${company.name || company.id}.`);
        }
      })
  );
  const metrics = recordInstantlySend(
    "companies",
    sentCount,
    approved.map((result) => String(result.company_id || "").trim()).filter(Boolean)
  );
  return NextResponse.json({
    campaign_id: campaignId,
    selected_count: companies.length,
    approved_count: approved.length,
    sent_count: sentCount,
    skipped_count: skippedAlreadySent.length,
    status: "sent",
    results: combinedResults,
    instantly_response: data,
    metrics,
  });
}
