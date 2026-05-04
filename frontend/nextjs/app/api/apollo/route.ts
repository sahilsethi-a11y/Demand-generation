import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

const APOLLO_ENDPOINT = 'https://api.apollo.io/v1/mixed_people/api_search';

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
    console.warn('Failed to read .env file for Apollo key:', error);
  }

  return undefined;
};

const normalizeDomain = (websiteUrl: string) => {
  if (!websiteUrl) {
    return '';
  }

  try {
    const parsedUrl = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
    return parsedUrl.hostname.replace(/^www\./, '');
  } catch (error) {
    return websiteUrl.replace(/^www\./, '');
  }
};

export async function POST(request: Request) {
  const apiKey = process.env.APOLLO_API_KEY ?? readEnvFileValue('APOLLO_API_KEY');

  if (!apiKey) {
    return NextResponse.json(
      { error: 'APOLLO_API_KEY is not configured on the server.' },
      { status: 500 }
    );
  }

  let body: {
    companyName?: string;
    websiteUrl?: string;
    targetTitles?: string[];
  };

  try {
    body = await request.json();
  } catch (parseError) {
    return NextResponse.json(
      { error: 'Invalid JSON in request body.' },
      { status: 400 }
    );
  }

  const companyName = body.companyName?.trim();
  const websiteUrl = body.websiteUrl?.trim();

  if (!companyName && !websiteUrl) {
    return NextResponse.json(
      { error: 'Provide at least a companyName or websiteUrl.' },
      { status: 400 }
    );
  }

  const targetTitles = body.targetTitles?.length
    ? body.targetTitles
    : ['Portfolio Manager', 'Consultant', 'Investment Partner'];

  const payload = {
    q_organization_domains: websiteUrl ? normalizeDomain(websiteUrl) : undefined,
    q_organization_name: companyName,
    person_titles: targetTitles,
    contact_email_status: 'verified',
    page: 1,
    per_page: 5,
  };

  try {
    const response = await fetch(APOLLO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('POST /api/apollo - Error calling Apollo:', error);
    return NextResponse.json(
      { error: 'Failed to reach Apollo API.' },
      { status: 500 }
    );
  }
}