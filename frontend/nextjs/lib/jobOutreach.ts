import fs from "fs";
import path from "path";

export type CompanyContact = {
  name?: string | null;
  title?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
};

export type JobPosting = {
  id?: string | null;
  title?: string | null;
  organization?: string | null;
  domain_derived?: string | null;
  company_key?: string | null;
  job_key?: string | null;
  description_text?: string | null;
  display_location?: string | null;
  locations_derived?: string[] | null;
  ai_key_skills?: string[] | null;
  ai_requirements_summary?: string | null;
  ai_core_responsibilities?: string | null;
  ai_work_arrangement?: string | null;
  ai_employment_type?: string[] | null;
  ai_experience_level?: string | null;
  source?: string | null;
  company_contacts?: CompanyContact[] | null;
};

type Signals = {
  role_family: string;
  seniority: string;
  hiring_signal_summary: string;
  outreach_angle: string;
  priority: "high" | "medium" | "low";
  warnings: string[];
};

type EmailGeneration = {
  subject_options: string[];
  opening_line: string;
  personalization_line: string;
  value_prop_line: string;
  cta_line: string;
  full_email_text: string;
  confidence_score: number;
  facts_used: string[];
  warnings: string[];
};

type QaResult = {
  qa_status: "passed" | "failed";
  approved_for_export: boolean;
  issues: string[];
};

export type InstantlyPayload = {
  lead_id: string;
  job_id: string;
  campaign_name: string;
  to_email: string;
  first_name: string;
  company_name: string;
  company_domain: string;
  contact_title: string;
  job_title: string;
  source: string;
  priority: "high" | "medium" | "low";
  subject_1: string;
  subject_2: string;
  email_body: string;
  signal_summary: string;
  qa_status: "passed" | "failed";
  approved_for_export: boolean;
  confidence_score: number;
};

export type OutreachResult = {
  contact_selection: {
    status: "selected" | "needs_contact_review";
    contact: CompanyContact | null;
    reason: string;
  };
  signal_generation: Signals;
  email_generation: EmailGeneration | null;
  qa: QaResult;
  instantly_payload: InstantlyPayload | null;
  status: "ready" | "needs_review" | "needs_contact_review";
};

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_OUTREACH_MODEL = process.env.OPENAI_OUTREACH_MODEL ?? "gpt-5";

export function readEnvFileValue(key: string) {
  try {
    const envPath = path.resolve(process.cwd(), "..", "..", ".env");
    if (!fs.existsSync(envPath)) {
      return undefined;
    }
    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = trimmed.match(/^(?:export\s+)?([^=]+)=(.*)$/);
      if (!match) {
        continue;
      }
      const envKey = match[1].trim();
      if (envKey !== key) {
        continue;
      }
      return match[2].replace(/^['"]|['"]$/g, "").trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeReferenceContext(value: unknown): string {
  return normalizeText(value).slice(0, 6000);
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function hasValidEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function roleFamily(job: JobPosting): string {
  const haystack = [
    job.title,
    ...(job.ai_key_skills || []),
    job.ai_requirements_summary,
    job.ai_core_responsibilities,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack.includes("product")) return "product";
  if (haystack.includes("engineer") || haystack.includes("developer")) return "engineering";
  if (haystack.includes("design")) return "design";
  if (haystack.includes("sales") || haystack.includes("account executive")) return "gtm";
  if (haystack.includes("marketing")) return "gtm";
  if (haystack.includes("data") || haystack.includes("analytics")) return "data";
  if (haystack.includes("talent") || haystack.includes("recruit")) return "people";
  return "general";
}

function seniority(job: JobPosting): string {
  const title = normalizeText(job.title).toLowerCase();
  if (title.includes("intern")) return "intern";
  if (title.includes("staff") || title.includes("principal") || title.includes("lead")) return "senior";
  if (title.includes("senior") || title.includes("sr")) return "senior";
  if (title.includes("manager") || title.includes("director") || title.includes("head") || title.includes("vp")) {
    return "senior";
  }
  return "mid";
}

function scoreContact(contact: CompanyContact, family: string): number {
  const title = normalizeText(contact.title).toLowerCase();
  if (!hasValidEmail(contact.email)) {
    return -1000;
  }
  let score = 0;
  if (title.includes("head of talent") || title.includes("vp talent") || title.includes("talent acquisition")) score += 200;
  if (title.includes("hiring manager")) score += 180;
  if (title.includes("recruit")) score += 130;
  if (family === "product" && title.includes("product")) score += 120;
  if (family === "engineering" && (title.includes("engineering") || title.includes("cto"))) score += 120;
  if (family === "gtm" && (title.includes("sales") || title.includes("marketing") || title.includes("revenue"))) score += 90;
  if (title.includes("vp") || title.includes("head") || title.includes("director")) score += 60;
  if (title.includes("finance") || title.includes("controller") || title.includes("fp&a")) score -= 180;
  if (title.includes("account director") || title.includes("sales director")) score -= 40;
  if (title.includes("customer success")) score -= 30;
  return score;
}

function selectBestContact(job: JobPosting) {
  const contacts = Array.isArray(job.company_contacts) ? job.company_contacts : [];
  const family = roleFamily(job);
  const scored = contacts
    .map((contact) => ({ contact, score: scoreContact(contact, family) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    return {
      status: "needs_contact_review" as const,
      contact: null,
      reason: "No relevant contact with a valid email was found.",
    };
  }
  return {
    status: "selected" as const,
    contact: scored[0].contact,
    reason: "Best relevant contact selected using deterministic title scoring.",
  };
}

function buildSignals(job: JobPosting, contactStatus: "selected" | "needs_contact_review"): Signals {
  const family = roleFamily(job);
  const seniorityValue = seniority(job);
  const warnings: string[] = [];
  let priority: "high" | "medium" | "low" = "medium";

  if (seniorityValue === "intern") {
    priority = "low";
    warnings.push("Internship or internship-like role.");
  } else if (family === "product" || family === "engineering") {
    priority = "high";
  }
  if (contactStatus !== "selected") {
    warnings.push("No valid contact selected.");
  }
  if (!normalizeText(job.description_text) && !(job.ai_key_skills || []).length) {
    warnings.push("Limited job context available.");
  }

  const hiringSignalSummary =
    seniorityValue === "intern"
      ? `The company is hiring for ${normalizeText(job.title) || "an internship role"}, which suggests low-priority early-career hiring demand.`
      : `The company is hiring for ${normalizeText(job.title) || "this role"}, which suggests active ${family} hiring with direct team-building needs.`;
  const outreachAngle =
    family === "engineering"
      ? "Reach out around helping them hire vetted engineering talent quickly."
      : family === "product"
        ? "Reach out around helping them hire product talent with domain-relevant experience."
        : "Reach out around supporting this hiring motion with high-quality talent.";

  return {
    role_family: family,
    seniority: seniorityValue,
    hiring_signal_summary: hiringSignalSummary,
    outreach_angle: outreachAngle,
    priority,
    warnings,
  };
}

function fallbackEmail(
  job: JobPosting,
  contact: CompanyContact,
  signals: Signals,
  referenceContext?: string
): EmailGeneration {
  const company = normalizeText(job.organization) || "your team";
  const role = normalizeText(job.title) || "the open role";
  const name = normalizeText(contact.name).split(" ")[0] || "there";
  const subject1 = `${role} hiring at ${company}`;
  const subject2 = `Support for ${company}'s ${role} search`;
  const opening = `Hi ${name},`;
  const personalization = referenceContext
    ? `I saw ${company} is hiring for ${role}, and I used the provided EMB Global hiring context to tailor this note for the right contact.`
    : `I saw ${company} is hiring for ${role}.`;
  const value = "EMB Global helps teams fill active hiring demand with project-ready technical talent, faster onboarding, flexible specialist coverage, and real-time visibility through embtalent.ai.";
  const cta = "Would a quick conversation next week be useful?";
  const full = [opening, "", personalization, value, cta].join("\n");
  return {
    subject_options: [subject1, subject2],
    opening_line: opening,
    personalization_line: personalization,
    value_prop_line: value,
    cta_line: cta,
    full_email_text: full,
    confidence_score: signals.priority === "high" ? 0.78 : 0.65,
    facts_used: [company, role, contact.title || "", "EMB Global", "https://embtalent.ai", referenceContext ? "user reference content" : ""].filter(Boolean),
    warnings: [...signals.warnings],
  };
}

function containsUnsupportedClaims(text: string, factsUsed: string[]) {
  const lowered = text.toLowerCase();
  const banned = ["guarantee", "world-class", "best-in-class", "we know you're scaling", "noticed you raised"];
  if (banned.some((phrase) => lowered.includes(phrase))) {
    return true;
  }
  return factsUsed.length === 0;
}

async function generateEmailWithOpenAI(
  job: JobPosting,
  contact: CompanyContact,
  signals: Signals,
  referenceContext?: string
): Promise<EmailGeneration> {
  const apiKey = process.env.OPENAI_API_KEY ?? readEnvFileValue("OPENAI_API_KEY");
  if (!apiKey) {
    return fallbackEmail(job, contact, signals, referenceContext);
  }

  const facts = {
    company_name: normalizeText(job.organization),
    company_domain: normalizeText(job.domain_derived || job.company_key),
    job_title: normalizeText(job.title),
    location: normalizeText(job.display_location || (job.locations_derived || []).join(", ")),
    skills: (job.ai_key_skills || []).slice(0, 8),
    description_summary: normalizeText(job.ai_requirements_summary || job.ai_core_responsibilities || job.description_text).slice(0, 1200),
    contact_name: normalizeText(contact.name),
    contact_title: normalizeText(contact.title),
    reference_context: normalizeReferenceContext(referenceContext),
  };

  const prompt = [
    "Return JSON only.",
    "Write a short outbound hiring email using only the provided facts.",
    "Keep the total email under 120 words.",
    "Do not invent facts, achievements, company news, funding, or hiring plans beyond the provided job and optional reference context.",
    "Tone: professional, concise, commercially sharp, and reply-oriented.",
    "Sender context:",
    "- Company name: EMB Global",
    "- Positioning: tech agency providing RA services",
    "- Platform: https://embtalent.ai",
    "- Company background: series A funded",
    "- What we offer: help companies fulfil hiring needs by providing talent with relevant experience",
    "- Value point 1: Accelerated onboarding with project-ready talent who can deliver from day one",
    "- Value point 2: All-in-one talent pool across frontend, backend, AI, and specialist technical roles",
    "- Value point 3: AI talent platform helps track hiring and delivery with real-time visibility into tasks, timesheets, and output",
    "Email guidance:",
    "- Make the email about helping the company fill this specific role or adjacent hiring need",
    "- Write for the most relevant hiring ICP selected for this job",
    "- Mention EMB Global naturally",
    "- Mention the platform only if it fits naturally",
    "- Use the optional reference context as instruction for positioning and emphasis",
    "- Use only the provided job and contact facts, the optional reference context, plus the EMB Global context above",
    "- Do not mention services or capabilities not listed above",
    "- Make the note attractive enough to earn a response without sounding overly salesy",
    "- Include one clear low-friction CTA",
    "- Avoid hype, empty superlatives, or generic staffing language",
    "JSON schema:",
    JSON.stringify({
      subject_options: ["", ""],
      opening_line: "",
      personalization_line: "",
      value_prop_line: "",
      cta_line: "",
      full_email_text: "",
      confidence_score: 0.0,
      facts_used: [""],
      warnings: [""],
    }),
    "Provided facts:",
    JSON.stringify({
      ...facts,
      role_family: signals.role_family,
      seniority: signals.seniority,
      hiring_signal_summary: signals.hiring_signal_summary,
      outreach_angle: signals.outreach_angle,
      priority: signals.priority,
      warnings: signals.warnings,
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
          {
            role: "system",
            content: "You generate concise outbound hiring emails that are polished, professional, and reply-oriented. Return valid JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return fallbackEmail(job, contact, signals, referenceContext);
    }
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return fallbackEmail(job, contact, signals, referenceContext);
    }
    const parsed = JSON.parse(content);
    return {
      subject_options: Array.isArray(parsed.subject_options) ? parsed.subject_options.slice(0, 2) : ["", ""],
      opening_line: normalizeText(parsed.opening_line),
      personalization_line: normalizeText(parsed.personalization_line),
      value_prop_line: normalizeText(parsed.value_prop_line),
      cta_line: normalizeText(parsed.cta_line),
      full_email_text: normalizeText(parsed.full_email_text),
      confidence_score: Number(parsed.confidence_score || 0),
      facts_used: Array.isArray(parsed.facts_used) ? parsed.facts_used.map((item: unknown) => normalizeText(item)).filter(Boolean) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((item: unknown) => normalizeText(item)).filter(Boolean) : [],
    };
  } catch {
    return fallbackEmail(job, contact, signals, referenceContext);
  }
}

function runQa(contact: CompanyContact | null, email: EmailGeneration): QaResult {
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
  if (email.full_email_text.length > 1200 || email.full_email_text.split(/\s+/).filter(Boolean).length > 120) {
    issues.push("Email is too long.");
  }
  if (/\{\{|\}\}|<.*?>|TBD|N\/A/i.test(email.full_email_text)) {
    issues.push("Email contains placeholders or unresolved values.");
  }
  if (containsUnsupportedClaims(email.full_email_text, email.facts_used)) {
    issues.push("Email contains unsupported or overly broad claims.");
  }

  const qaStatus = issues.length === 0 ? "passed" : "failed";
  return {
    qa_status: qaStatus,
    approved_for_export: qaStatus === "passed",
    issues,
  };
}

export async function generateJobOutreach(job: JobPosting, referenceContext?: string): Promise<OutreachResult> {
  const contactSelection = selectBestContact(job);
  const signals = buildSignals(job, contactSelection.status);

  // Use the best email-verified contact if found; otherwise fall back to the
  // first available contact (or an empty stub) so the copy is still generated.
  // QA will flag the missing email — generation should not be blocked by it.
  const contactForGeneration: CompanyContact =
    contactSelection.contact ??
    (Array.isArray(job.company_contacts) ? job.company_contacts[0] : null) ??
    {};

  const emailGeneration = await generateEmailWithOpenAI(job, contactForGeneration, signals, referenceContext);
  const qa = runQa(contactForGeneration, emailGeneration);

  const instantlyPayload = qa.approved_for_export
    ? {
        lead_id: normalizeEmail(contactForGeneration.email) || `lead-${Date.now()}`,
        job_id: normalizeText(job.job_key || job.id || job.title),
        campaign_name: `${normalizeText(job.organization)} - ${normalizeText(job.title)} Hiring Outreach`.trim(),
        to_email: normalizeEmail(contactForGeneration.email),
        first_name: normalizeText(contactForGeneration.name).split(" ")[0] || "",
        company_name: normalizeText(job.organization),
        company_domain: normalizeText(job.domain_derived || job.company_key),
        contact_title: normalizeText(contactForGeneration.title),
        job_title: normalizeText(job.title),
        source: normalizeText(job.source),
        priority: signals.priority,
        subject_1: normalizeText(emailGeneration.subject_options?.[0]),
        subject_2: normalizeText(emailGeneration.subject_options?.[1]),
        email_body: normalizeText(emailGeneration.full_email_text),
        signal_summary: normalizeText(signals.hiring_signal_summary),
        qa_status: qa.qa_status,
        approved_for_export: qa.approved_for_export,
        confidence_score: Number(emailGeneration.confidence_score || 0),
      }
    : null;

  return {
    contact_selection: contactSelection,
    signal_generation: signals,
    email_generation: emailGeneration,
    qa,
    instantly_payload: instantlyPayload,
    status: qa.approved_for_export
      ? "ready"
      : contactSelection.status === "needs_contact_review"
        ? "needs_contact_review"
        : "needs_review",
  };
}
