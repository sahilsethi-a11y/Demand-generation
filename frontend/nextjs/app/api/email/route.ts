import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const readEnvFileValue = (key: string) => {
  try {
    const envPath = path.resolve(process.cwd(), '..', '..', '.env');
    if (!fs.existsSync(envPath)) {
      return undefined;
    }

    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
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

      return match[2].replace(/^['"]|['"]$/g, '').trim();
    }
  } catch (error) {
    console.warn('Failed to read .env file for OpenAI key:', error);
  }

  return undefined;
};

type EmailRequest = {
  employee?: {
    name?: string;
    title?: string;
    email?: string;
    phone?: string;
    linkedin_url?: string;
  };
  company?: {
    name?: string;
    website_url?: string;
    linkedin_url?: string;
    hq?: string;
    source?: string;
  };
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY ?? readEnvFileValue('OPENAI_API_KEY');

  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured on the server.' },
      { status: 500 }
    );
  }

  let body: EmailRequest;

  try {
    body = await request.json();
  } catch (parseError) {
    return NextResponse.json(
      { error: 'Invalid JSON in request body.' },
      { status: 400 }
    );
  }

  const employeeName = body.employee?.name?.trim();
  const employeeTitle = body.employee?.title?.trim();
  const companyName = body.company?.name?.trim();

  if (!employeeName && !employeeTitle && !companyName) {
    return NextResponse.json(
      { error: 'Provide at least an employee or company name.' },
      { status: 400 }
    );
  }

  const prompt = [
    'Write a concise, professional outbound email to a hiring decision maker.',
    'Include a subject line and email body.',
    'Explicitly mention the recipient company name in the opening paragraph.',
    'Refer to the sender as EMB Global in the email body.',
    'Value proposition: We source, vet, and match world-class engineers tailored to your team\'s needs - whether you’re scaling your first product or your hundredth.',
    'Ask for a short call and end with a polite CTA.',
    'Keep it between 120-180 words.',
    'Use the contact details below to personalize the email where relevant:',
    `Name: ${employeeName || 'Unknown contact'}`,
    `Title: ${employeeTitle || 'Unknown title'}`,
    `Email: ${body.employee?.email || 'N/A'}`,
    `LinkedIn: ${body.employee?.linkedin_url || 'N/A'}`,
    `Company: ${companyName || 'Unknown company'}`,
    `Company Website: ${body.company?.website_url || 'N/A'}`,
    `Company LinkedIn: ${body.company?.linkedin_url || 'N/A'}`,
    `HQ: ${body.company?.hq || 'N/A'}`,
  ].join('\n');

  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert outbound sales writer for a technical recruiting agency.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const errorMessage =
        data?.error?.message || 'OpenAI request failed to generate email.';
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    const email = data?.choices?.[0]?.message?.content?.trim();
    if (!email) {
      return NextResponse.json(
        { error: 'No email content returned by OpenAI.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ email });
  } catch (error) {
    console.error('POST /api/email - Error calling OpenAI:', error);
    return NextResponse.json(
      { error: 'Failed to reach OpenAI API.' },
      { status: 500 }
    );
  }
}