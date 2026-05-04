import { NextResponse } from "next/server";
import { generateJobOutreach, JobPosting } from "@/lib/jobOutreach";

type EmailRequest = {
  job?: JobPosting;
  referenceContext?: string;
};


export async function POST(request: Request) {
  let body: EmailRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }

  const job = body.job;
  if (!job) {
    return NextResponse.json({ error: "Job payload is required." }, { status: 400 });
  }

  return NextResponse.json(await generateJobOutreach(job, body.referenceContext));
}
