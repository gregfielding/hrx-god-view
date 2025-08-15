import fetch from 'node-fetch';

export interface ClearbitCompanyLite {
  name?: string;
  domain?: string;
  category?: { industry?: string; sector?: string };
  metrics?: { employees?: number };
  description?: string;
}

export async function fetchClearbitCompany(domain: string, apiKey: string): Promise<ClearbitCompanyLite | null> {
  try {
    const url = `https://company.clearbit.com/v2/companies/find?domain=${encodeURIComponent(domain)}`;
    const resp = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}` } });
    if (!resp.ok) return null;
    const json = (await resp.json()) as any;
    return json || null;
  } catch {
    return null;
  }
}

export function bucketEmployeesToSize(employees?: number): string | undefined {
  if (!employees || employees <= 0) return undefined;
  if (employees <= 10) return '1-10';
  if (employees <= 50) return '11-50';
  if (employees <= 100) return '51-100';
  if (employees <= 250) return '101-250';
  if (employees <= 500) return '251-500';
  if (employees <= 1000) return '501-1000';
  if (employees <= 5000) return '1001-5000';
  if (employees <= 10000) return '5001-10000';
  return '10000+';
}


