import fetch from 'node-fetch';

export interface ApolloCompany {
  id?: string;
  name?: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  revenueRange?: string;
  headquarters?: { city?: string; state?: string; country?: string };
  techTags?: string[];
}

export interface ApolloPerson {
  id?: string;
  name: string;
  title?: string;
  seniority?: string;
  department?: string;
  email?: string;
  phone?: string;
  verifiedEmail?: boolean;
  linkedinUrl?: string;
}

function authHeader(apiKey: string) {
  // Apollo REST API (current docs) accepts X-Api-Key or Authorization: Bearer
  return {
    'X-Api-Key': apiKey,
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  } as Record<string, string>;
}

export async function apolloCompanyByDomain(domain: string, apiKey: string): Promise<ApolloCompany | null> {
  try {
    // Use organizations/enrich GET with domain query param
    const qs = new URLSearchParams({ domain }).toString();
    const url = `https://api.apollo.io/api/v1/organizations/enrich?${qs}`;
    const resp = await fetch(url, { method: 'GET', headers: authHeader(apiKey) });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.warn('apolloCompanyByDomain non-ok', resp.status, t);
      return null;
    }
    const json: any = await resp.json();
    const c = json?.organization || json?.company;
    if (!c) {
      // eslint-disable-next-line no-console
      console.warn('apolloCompanyByDomain missing organization/company key', Object.keys(json || {}));
      return null;
    }
    const employeeCount =
      c.estimated_num_employees ?? c.employee_count ?? c.employees ?? undefined;
    const revenuePrinted = c.annual_revenue_printed ?? c.organization_revenue_printed;
    const revenueAmount = c.annual_revenue ?? c.organization_revenue ?? undefined;
    const techTags =
      (Array.isArray(c.technology_names) && c.technology_names.length ? c.technology_names : c.tech_tags) || [];
    return {
      id: c.id,
      name: c.name,
      domain: c.primary_domain || c.domain || c.website_url,
      industry: c.industry,
      employeeCount,
      revenueRange: revenuePrinted || revenueAmount,
      headquarters: { city: c.city, state: c.state, country: c.country },
      techTags,
    };
  } catch {
    return null;
  }
}

export async function apolloPeopleSearch(params: { domain?: string; companyId?: string; titles?: string[]; departments?: string[]; seniorities?: string[]; limit?: number }, apiKey: string): Promise<ApolloPerson[]> {
  try {
    const url = 'https://api.apollo.io/api/v1/people/search';
    const query: any = {
      q_organization_domains: params.domain ? [params.domain] : undefined,
      organization_ids: params.companyId ? [params.companyId] : undefined,
      person_titles: params.titles,
      person_departments: params.departments,
      person_seniorities: params.seniorities,
      page: 1,
      per_page: Math.min(params.limit || 10, 25),
    };
    const resp = await fetch(url, { method: 'POST', headers: authHeader(apiKey), body: JSON.stringify(query) });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.warn('apolloPeopleSearch non-ok', resp.status, t);
      return [];
    }
    const json: any = await resp.json();
    const people: any[] = json?.people || [];
    return people.map((p) => ({
      id: p.id,
      name: [p.first_name, p.last_name].filter(Boolean).join(' '),
      title: p.title,
      seniority: p.seniority,
      department: p.department,
      email: p.email,
      phone: p.phone_number,
      verifiedEmail: Boolean(p.email_status && p.email_status !== 'unverified'),
      linkedinUrl: p.linkedin_url,
    }));
  } catch {
    return [];
  }
}


