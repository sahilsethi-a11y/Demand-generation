import { NextResponse } from "next/server";
import { CompanyRecord, generateCompanyOutreach } from "@/lib/companyOutreach";

type CompanyEmailRequest = {
  company?: CompanyRecord;
  referenceContext?: string;
};

export async function POST(request: Request) {
  let body: CompanyEmailRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }

  const company = body.company;
  if (!company) {
    return NextResponse.json({ error: "Company payload is required." }, { status: 400 });
  }

  return NextResponse.json(await generateCompanyOutreach(company, body.referenceContext));
}
