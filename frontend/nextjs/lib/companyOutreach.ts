import { readEnvFileValue } from "@/lib/jobOutreach";

const OPENAI_OUTREACH_MODEL = process.env.OPENAI_OUTREACH_MODEL ?? "gpt-5";

export type CompanyEmployee = {
  name?: string | null;
  title?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  phone?: string | null;
  icp_reason?: string | null;
  generated_email_text?: string | null;
  generated_email_subjects?: string[] | null;
  instantly_sent?: boolean | null;
  instantly_sent_at?: string | null;
  instantly_campaign_id?: string | null;
  generated_instantly_payload?: Record<string, unknown> | null;
  generated_outreach_result?: Record<string, unknown> | null;
};

export type CompanyRecord = {
  id?: string | null;
  name?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  organization_domain?: string | null;
  hq?: string | null;
  source?: string | null;
  portfolio_companies?: string[] | null;
  employees?: CompanyEmployee[] | null;
  all_employees?: CompanyEmployee[] | null;
};

type CampaignType =
  | "accelerated_onboarding"
  | "real_time_optimization"
  | "all_in_one_talent_pool";

type EmailGeneration = {
  subject_options: string[];
  opening_line: string;
  personalization_line: string;
  value_prop_line: string;
  support_line: string;
  cta_line: string;
  full_email_text: string;
  facts_used: string[];
  warnings: string[];
  confidence_score: number;
};

type QaResult = {
  qa_status: "passed" | "failed";
  approved_for_export: boolean;
  issues: string[];
};

type SignalGeneration = {
  firm_name: string;
  first_name: string;
  contact_title: string;
  campaign_type: CampaignType;
  pain_point: string;
  value_prop: string;
  cta_angle: string;
  partnership_signal_summary: string;
  priority: "high" | "medium" | "low";
  confidence_score: number;
  warnings: string[];
};

export type CompanyInstantlyPayload = {
  lead_id: string;
  firm_id: string;
  campaign_type: CampaignType;
  campaign_name: string;
  to_email: string;
  first_name: string;
  firm_name: string;
  firm_domain: string;
  contact_title: string;
  subject_1: string;
  subject_2: string;
  email_body: string;
  pain_point: string;
  value_prop: string;
  cta_angle: string;
  partnership_signal_summary: string;
  priority: "high" | "medium" | "low";
  qa_status: "passed" | "failed";
  approved_for_export: boolean;
  confidence_score: number;
};

export type CompanyOutreachResult = {
  contact_selection: {
    status: "selected" | "needs_contact_review";
    contact: CompanyEmployee | null;
    reason: string;
  };
  signal_generation: SignalGeneration;
  email_generation: EmailGeneration | null;
  qa: QaResult;
  instantly_payload: CompanyInstantlyPayload | null;
  status: "ready" | "needs_review" | "needs_contact_review";
};

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeReferenceContext(value: unknown) {
  return normalizeText(value).slice(0, 6000);
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeDomain(value: unknown) {
  return normalizeText(value)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

function hasValidEmail(value: unknown) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function scoreContact(contact: CompanyEmployee) {
  const title = normalizeText(contact.title).toLowerCase();
  if (!hasValidEmail(contact.email)) {
    return -1000;
  }
  let score = 0;
  if (title.includes("operating partner")) score += 240;
  if (title.includes("platform partner")) score += 230;
  if (title.includes("talent partner")) score += 225;
  if (title.includes("head of talent")) score += 220;
  if (title.includes("platform")) score += 190;
  if (title.includes("talent")) score += 185;
  if (title.includes("general partner")) score += 180;
  if (title.includes("managing director")) score += 175;
  if (title === "partner" || title.includes(" partner")) score += 170;
  if (title.includes("principal")) score += 150;
  if (title.includes("associate")) score += 90;
  if (title.includes("finance") || title.includes("controller") || title.includes("legal") || title.includes("compliance")) {
    score -= 250;
  }
  return score;
}

function selectBestContact(company: CompanyRecord) {
  const employees = Array.isArray(company.employees) ? company.employees : [];
  const scored = employees
    .map((employee) => ({ employee, score: scoreContact(employee) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    return {
      status: "needs_contact_review" as const,
      contact: null,
      reason: "No relevant investor contact with a valid email was found.",
    };
  }
  return {
    status: "selected" as const,
    contact: scored[0].employee,
    reason: "Best relevant investor contact selected using deterministic title scoring.",
  };
}

function chooseCampaignType(contactTitle: string, portfolioCount: number): CampaignType {
  const title = contactTitle.toLowerCase();
  if (title.includes("platform") || title.includes("operating")) {
    return "real_time_optimization";
  }
  if (title.includes("talent")) {
    return "accelerated_onboarding";
  }
  if (portfolioCount >= 10) {
    return "all_in_one_talent_pool";
  }
  return "accelerated_onboarding";
}

function describeContactAngle(contactTitle: string): string {
  const title = contactTitle.toLowerCase();
  if (title.includes("platform") || title.includes("operating")) {
    return "Frame the note around portfolio execution support, operator efficiency, and visibility after deployment.";
  }
  if (title.includes("talent") || title.includes("people") || title.includes("recruit")) {
    return "Frame the note around faster hiring, reduced ramp time, and dependable delivery capacity for portfolio companies.";
  }
  if (title.includes("partner") || title.includes("principal") || title.includes("managing director") || title.includes("investment")) {
    return "Frame the note around practical portfolio value creation and a credible resource partner for portfolio hiring needs.";
  }
  return "Frame the note around pragmatic support for portfolio hiring and execution without sounding promotional.";
}

function inferCompanyType(company: CompanyRecord, contactTitle: string): string {
  const source = normalizeText(company.source).toLowerCase();
  const title = contactTitle.toLowerCase();
  if (source.includes("private equity") || title.includes("private equity")) {
    return "private equity firm";
  }
  if (source.includes("accelerator")) {
    return "accelerator";
  }
  if (source.includes("growth")) {
    return "growth equity firm";
  }
  if (source.includes("venture") || source.includes("vc") || title.includes("venture capital")) {
    return "venture capital firm";
  }
  return "investment firm";
}

function buildSignals(company: CompanyRecord, contact: CompanyEmployee | null, status: "selected" | "needs_contact_review"): SignalGeneration {
  const firmName = normalizeText(company.name);
  const firstName = normalizeText(contact?.name).split(" ")[0] || "";
  const contactTitle = normalizeText(contact?.title);
  const portfolioCount = Array.isArray(company.portfolio_companies) ? company.portfolio_companies.length : 0;
  const warnings: string[] = [];
  if (status !== "selected") {
    warnings.push("No valid contact selected.");
  }
  if (!portfolioCount) {
    warnings.push("Portfolio company detail is limited.");
  }

  const campaignType = chooseCampaignType(contactTitle, portfolioCount);
  const valueMap: Record<CampaignType, { pain: string; value: string; cta: string; summary: string }> = {
    accelerated_onboarding: {
      pain: "Portfolio companies often need to fill technical roles quickly without losing time to long hiring ramps.",
      value: "EMB Global can deploy project-ready talent quickly so portfolio teams start delivering from day one.",
      cta: "See if faster deployment support would be useful across the portfolio.",
      summary: `${firmName || "This firm"} looks like a fit for a faster-ramp partnership model across portfolio hiring needs.`,
    },
    real_time_optimization: {
      pain: "Firms backing growing teams often need more visibility into how external talent is performing after deployment.",
      value: "EMB Global pairs talent delivery with real-time visibility into tasks, timesheets, and team output through embtalent.ai.",
      cta: "See if execution visibility is a useful angle for portfolio support.",
      summary: `${firmName || "This firm"} looks like a fit for a visibility-first partnership around portfolio execution and hiring support.`,
    },
    all_in_one_talent_pool: {
      pain: "Portfolio companies can need different technical specialists at different stages without time to build each team from scratch.",
      value: "EMB Global gives portfolio teams flexible access to a bench across frontend, backend, AI, and specialist technical roles.",
      cta: "See if flexible access to technical specialists would help portfolio teams move faster.",
      summary: `${firmName || "This firm"} looks like a fit for a flexible talent-pool partnership across multiple portfolio companies.`,
    },
  };

  const selected = valueMap[campaignType];
  return {
    firm_name: firmName,
    first_name: firstName,
    contact_title: contactTitle,
    campaign_type: campaignType,
    pain_point: selected.pain,
    value_prop: selected.value,
    cta_angle: selected.cta,
    partnership_signal_summary: selected.summary,
    priority: portfolioCount >= 10 || contactTitle.toLowerCase().includes("partner") ? "high" : "medium",
    confidence_score: portfolioCount >= 10 ? 0.82 : 0.74,
    warnings,
  };
}

function fallbackEmail(signals: SignalGeneration, referenceContext?: string): EmailGeneration {
  const opening = `Hi ${signals.first_name || "there"},`;
  const titleLower = signals.contact_title.toLowerCase();
  const personalization = titleLower.includes("platform") || titleLower.includes("operating")
    ? `${signals.contact_title || "Your role"} at ${signals.firm_name || "your firm"} is naturally close to portfolio execution, which is why I thought this might be relevant.`
    : titleLower.includes("talent") || titleLower.includes("people") || titleLower.includes("recruit")
      ? `${signals.contact_title || "Your role"} at ${signals.firm_name || "your firm"} sits close to how quickly portfolio teams can hire well and start delivering.`
      : `${signals.contact_title || "Your role"} at ${signals.firm_name || "your firm"} is closely tied to how portfolio companies build and scale effectively.`;
  const valueLine = signals.value_prop;
  const supportLine = referenceContext
    ? "EMB Global helps portfolio companies add project-ready technical talent quickly, with clear delivery visibility once teams are in place."
    : "EMB Global helps portfolio companies add project-ready technical talent quickly, with clear delivery visibility once teams are in place.";
  const ctaLine = "Would a 20-minute call this week make sense?";
  return {
    subject_options: [
      `${signals.firm_name || "Portfolio"} hiring support`,
      `${signals.firm_name || "Portfolio"} partnership with EMB Global`,
    ],
    opening_line: opening,
    personalization_line: personalization,
    value_prop_line: valueLine,
    support_line: supportLine,
    cta_line: ctaLine,
    full_email_text: [opening, "", personalization, valueLine, supportLine, ctaLine].join("\n"),
    facts_used: [signals.firm_name, signals.contact_title, signals.value_prop, "EMB Global", "https://embtalent.ai", referenceContext ? "user reference content" : ""].filter(Boolean),
    warnings: [...signals.warnings],
    confidence_score: signals.confidence_score,
  };
}

function containsUnsupportedClaims(text: string, factsUsed: string[]) {
  const lowered = text.toLowerCase();
  const banned = [
    "guarantee",
    "world-class",
    "best-in-class",
    "noticed you raised",
    "we know your portfolio is scaling",
    "all your portfolio companies",
  ];
  if (banned.some((phrase) => lowered.includes(phrase))) {
    return true;
  }
  return factsUsed.length === 0;
}

async function generateEmail(
  company: CompanyRecord,
  contact: CompanyEmployee,
  signals: SignalGeneration,
  referenceContext?: string
): Promise<EmailGeneration> {
  const apiKey = process.env.OPENAI_API_KEY ?? readEnvFileValue("OPENAI_API_KEY");
  if (!apiKey) {
    return fallbackEmail(signals, referenceContext);
  }

  const prompt = [
    "Return JSON only.",
    "You are an expert B2B partnership outreach copywriter. Your job is to write a single, highly personalized cold outreach email on behalf of EMB Global.",
    "Use the optional reference text as real positioning guidance and weave it in naturally when relevant.",
    "Email writing rules:",
    "- Address the recipient by their first name only.",
    "- Open with a highly specific, title-aware hook that reflects what someone in that role actually cares about.",
    "- Do not use generic lines like 'I came across your profile' or 'I hope this email finds you well'.",
    "- Do not mention provided context, prompts, instructions, or any meta-language.",
    "- The email must feel written specifically for this person and company.",
    "- End with a single, low-friction CTA: 'Would a 20-minute call this week make sense?' unless another equally low-friction CTA is clearly better.",
    "- Tone: sharp, professional, peer-to-peer, not salesy and not overly formal.",
    "- Do not use bullet points inside the email.",
    "- Do not include a subject line inside the email body.",
    "- Use only the provided facts. Do not invent portfolio activity, internal priorities, fundraising, hiring plans, or strategy details.",
    "Examples of the style and quality to emulate:",
    [
      "ICP 1 — Platform Lead at a VC",
      "Aviral Bhatnagar, Platform Lead, a16z India",
      "",
      "Hi Aviral,",
      "Platform teams at firms like a16z are only as effective as the speed at which portfolio companies can hire and execute — and that last mile is where most firms still lose time.",
      "EMB Global partners with VC platforms to give portfolio companies on-demand access to project-ready technical talent across engineering, data, and AI, with full delivery visibility built in from day one.",
      "We've helped portfolio teams cut onboarding time significantly and move faster on product and tech priorities without the overhead of a full hiring cycle.",
      "Would a 20-minute call this week make sense to explore whether this fits what you're building at a16z?",
    ].join("\n"),
    [
      "ICP 2 — Talent Partner at a Growth Equity Firm",
      "Shruti Mehta, Talent Partner, Elevation Capital",
      "",
      "Hi Shruti,",
      "Talent Partners at growth-stage firms spend a disproportionate amount of time on technical hiring that portfolio companies struggle to close fast enough — especially in engineering and AI roles.",
      "EMB Global works alongside talent functions like yours to give portfolio companies a ready bench of vetted technical specialists they can deploy immediately, without the 60-90 day hiring cycle.",
      "Our AI platform gives you and the portfolio full visibility into delivery, so the output is measurable and accountable from the start.",
      "Would it be worth a short conversation to see if this could take some of that load off your portfolio's technical hiring?",
    ].join("\n"),
    [
      "ICP 3 — Operating Partner at a PE Firm",
      "Rohit Bansal, Operating Partner, ChrysCapital",
      "",
      "Hi Rohit,",
      "Operating Partners at PE firms are typically the ones accountable when a portfolio company's execution velocity doesn't match its growth targets — and more often than not, the bottleneck is technical capacity.",
      "EMB Global partners with operating teams to give portfolio companies on-demand access to project-ready engineers and AI specialists, with a delivery platform that makes output trackable in real time.",
      "It's a model that reduces dependency on slow full-time hiring cycles while keeping execution standards high across the portfolio.",
      "Would a 20-minute call make sense to discuss how this could work for your current portfolio priorities?",
    ].join("\n"),
    "Sender context:",
    "- Company name: EMB Global",
    "- EMB Global provides project-ready technical talent and delivery visibility for scaling teams.",
    "- Platform: https://embtalent.ai",
    "- Core value themes: accelerated onboarding, all-in-one technical talent pool, and real-time optimization.",
    "JSON schema:",
    JSON.stringify({
      subject_options: ["", ""],
      opening_line: "",
      personalization_line: "",
      value_prop_line: "",
      support_line: "",
      cta_line: "",
      full_email_text: "",
      facts_used: [""],
      warnings: [""],
      confidence_score: 0.0,
    }),
    "Provided facts:",
    JSON.stringify({
      full_name: normalizeText(contact.name),
      first_name: signals.first_name,
      job_title: signals.contact_title,
      company_name: signals.firm_name,
      company_type: inferCompanyType(company, signals.contact_title),
      email_address: normalizeEmail(contact.email),
      firm_name: signals.firm_name,
      firm_domain: normalizeDomain(company.organization_domain || company.website_url),
      campaign_type: signals.campaign_type,
      pain_point: signals.pain_point,
      value_prop: signals.value_prop,
      cta_angle: signals.cta_angle,
      partnership_signal_summary: signals.partnership_signal_summary,
      icp_reason: normalizeText(contact.icp_reason),
      contact_angle_guidance: describeContactAngle(signals.contact_title),
      priority: signals.priority,
      warnings: signals.warnings,
      reference_context: normalizeReferenceContext(referenceContext),
    }),
  ].join("\n");

  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_OUTREACH_MODEL,
        temperature: 0.2,
        max_tokens: 500,
        messages: [
          { role: "system", content: "You generate concise investor partnership emails that are polished, professional, and reply-oriented. Return valid JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return fallbackEmail(signals, referenceContext);
    }
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return fallbackEmail(signals, referenceContext);
    }
    const parsed = JSON.parse(content);
    return {
      subject_options: Array.isArray(parsed.subject_options) ? parsed.subject_options.slice(0, 2) : ["", ""],
      opening_line: normalizeText(parsed.opening_line),
      personalization_line: normalizeText(parsed.personalization_line),
      value_prop_line: normalizeText(parsed.value_prop_line),
      support_line: normalizeText(parsed.support_line),
      cta_line: normalizeText(parsed.cta_line),
      full_email_text: normalizeText(parsed.full_email_text),
      facts_used: Array.isArray(parsed.facts_used) ? parsed.facts_used.map((item: unknown) => normalizeText(item)).filter(Boolean) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((item: unknown) => normalizeText(item)).filter(Boolean) : [],
      confidence_score: Number(parsed.confidence_score || 0),
    };
  } catch {
    return fallbackEmail(signals, referenceContext);
  }
}

function runQa(contact: CompanyEmployee | null, email: EmailGeneration): QaResult {
  const issues: string[] = [];
  if (!contact || !hasValidEmail(contact.email)) {
    issues.push("Contact email is missing or invalid.");
  }
  if (!normalizeText(contact?.title)) {
    issues.push("Contact role is missing.");
  }
  if (!normalizeText(email.full_email_text)) {
    issues.push("Generated email body is empty.");
  }
  if (email.full_email_text.split(/\s+/).filter(Boolean).length > 120) {
    issues.push("Email is too long.");
  }
  if (/\{\{|\}\}|<.*?>|TBD|N\/A/i.test(email.full_email_text)) {
    issues.push("Email contains placeholders or unresolved values.");
  }
  if (containsUnsupportedClaims(email.full_email_text, email.facts_used)) {
    issues.push("Email contains unsupported or overly broad claims.");
  }
  return {
    qa_status: issues.length ? "failed" : "passed",
    approved_for_export: issues.length === 0,
    issues,
  };
}

export async function generateCompanyOutreach(company: CompanyRecord, referenceContext?: string): Promise<CompanyOutreachResult> {
  const contactSelection = selectBestContact(company);
  const signals = buildSignals(company, contactSelection.contact, contactSelection.status);
  if (contactSelection.status !== "selected" || !contactSelection.contact) {
    return {
      contact_selection: contactSelection,
      signal_generation: signals,
      email_generation: null,
      qa: {
        qa_status: "failed",
        approved_for_export: false,
        issues: ["No valid investor contact available for email generation."],
      },
      instantly_payload: null,
      status: "needs_contact_review",
    };
  }

  const emailGeneration = await generateEmail(company, contactSelection.contact, signals, referenceContext);
  const qa = runQa(contactSelection.contact, emailGeneration);
  const instantlyPayload = qa.approved_for_export
    ? {
        lead_id: normalizeEmail(contactSelection.contact.email) || `investor-lead-${Date.now()}`,
        firm_id: normalizeText(company.id || company.name),
        campaign_type: signals.campaign_type,
        campaign_name: `${signals.firm_name} Investor Partnership Outreach`.trim(),
        to_email: normalizeEmail(contactSelection.contact.email),
        first_name: signals.first_name,
        firm_name: signals.firm_name,
        firm_domain: normalizeDomain(company.organization_domain || company.website_url),
        contact_title: signals.contact_title,
        subject_1: normalizeText(emailGeneration.subject_options?.[0]),
        subject_2: normalizeText(emailGeneration.subject_options?.[1]),
        email_body: normalizeText(emailGeneration.full_email_text),
        pain_point: signals.pain_point,
        value_prop: signals.value_prop,
        cta_angle: signals.cta_angle,
        partnership_signal_summary: signals.partnership_signal_summary,
        priority: signals.priority,
        qa_status: qa.qa_status,
        approved_for_export: qa.approved_for_export,
        confidence_score: Number(emailGeneration.confidence_score || signals.confidence_score),
      }
    : null;

  return {
    contact_selection: contactSelection,
    signal_generation: signals,
    email_generation: emailGeneration,
    qa,
    instantly_payload: instantlyPayload,
    status: qa.approved_for_export ? "ready" : "needs_review",
  };
}
