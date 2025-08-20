import fetch from 'node-fetch';

export interface ApolloCompany {
  id?: string;
  name?: string;
  domain?: string;
  primary_domain?: string; // Apollo API response field
  industry?: string;
  employeeCount?: number;
  revenueRange?: string;
  foundedYear?: number;
  shortDescription?: string;
  websiteUrl?: string;
  website_url?: string; // Apollo API response field
  linkedinUrl?: string;
  linkedin_url?: string; // Apollo API response field
  twitterUrl?: string;
  twitter_url?: string; // Apollo API response field
  facebookUrl?: string;
  facebook_url?: string; // Apollo API response field
  angellistUrl?: string;
  angellist_url?: string; // Apollo API response field
  crunchbaseUrl?: string;
  crunchbase_url?: string; // Apollo API response field
  logoUrl?: string;
  logo_url?: string; // Apollo API response field
  phone?: string;
  keywords?: string[];
  headquarters?: { 
    city?: string; 
    state?: string; 
    country?: string;
    street_address?: string;
    postal_code?: string;
  };
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

export interface ApolloEmploymentHistory {
  id?: string;
  organization_name?: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  current?: boolean;
  organization_id?: string;
}

export interface ApolloContactEnrichment {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  linkedin_url?: string;
  title?: string;
  email_status?: string;
  photo_url?: string;
  twitter_url?: string;
  github_url?: string;
  facebook_url?: string;
  extrapolated_email_confidence?: number;
  headline?: string;
  email?: string;
  organization_id?: string;
  employment_history?: ApolloEmploymentHistory[];
  street_address?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  formatted_address?: string;
  time_zone?: string;
  organization?: ApolloCompany;
  intent_strength?: number;
  show_intent?: boolean;
  email_domain_catchall?: boolean;
  revealed_for_current_team?: boolean;
  departments?: string[];
  subdepartments?: string[];
  functions?: string[];
  seniority?: string;
}

function authHeader(apiKey: string) {
  // Apollo REST API - match their documentation exactly
  return {
    'x-api-key': apiKey,
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    'accept': 'application/json',
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
      foundedYear: c.founded_year,
      shortDescription: c.short_description,
      websiteUrl: c.website_url,
      linkedinUrl: c.linkedin_url,
      twitterUrl: c.twitter_url,
      facebookUrl: c.facebook_url,
      angellistUrl: c.angellist_url,
      crunchbaseUrl: c.crunchbase_url,
      logoUrl: c.logo_url,
      phone: c.phone,
      keywords: c.keywords || [],
      headquarters: { 
        city: c.city, 
        state: c.state, 
        country: c.country,
        street_address: c.street_address || c.address || c.street,
        postal_code: c.postal_code || c.zip || c.zip_code
      },
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

export async function apolloContactEnrichment(params: { 
  email?: string; 
  first_name?: string; 
  last_name?: string; 
  name?: string;
  domain?: string;
  reveal_personal_emails?: boolean;
  reveal_phone_number?: boolean;
}, apiKey: string): Promise<ApolloContactEnrichment | null> {
  try {
    const url = 'https://api.apollo.io/api/v1/people/match';
    const queryParams = new URLSearchParams();
    
    // Use the most specific identifier first (email is most reliable)
    if (params.email) {
      queryParams.append('email', params.email);
    }
    
    // Use full name if available, otherwise use first_name + last_name
    // According to Apollo docs: "If you use this parameter, you do not need to use the first_name and last_name parameters"
    if (params.name) {
      queryParams.append('name', params.name);
    } else {
      // Only use first_name and last_name if we don't have the full name
      if (params.first_name) {
        queryParams.append('first_name', params.first_name);
      }
      if (params.last_name) {
        queryParams.append('last_name', params.last_name);
      }
    }
    
    // Add domain if available (helps with matching)
    if (params.domain) {
      queryParams.append('domain', params.domain);
    }
    
    // Add reveal options
    if (params.reveal_personal_emails !== undefined) {
      queryParams.append('reveal_personal_emails', params.reveal_personal_emails.toString());
    }
    if (params.reveal_phone_number !== undefined) {
      queryParams.append('reveal_phone_number', params.reveal_phone_number.toString());
    }
    
    const fullUrl = `${url}?${queryParams.toString()}`;
    
    console.log('🔍 Apollo People Match API call:', {
      endpoint: '/people/match',
      method: 'POST',
      params: Object.fromEntries(queryParams.entries())
    });
    
    const resp = await fetch(url, { 
      method: 'POST', // People Match uses POST method
      headers: {
        ...authHeader(apiKey),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(Object.fromEntries(queryParams.entries()))
    });
    
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      console.warn('apolloContactEnrichment non-ok', resp.status, t);
      return null;
    }
    
    const json: any = await resp.json();
    console.log('✅ Apollo People Match API response received');
    
    const person = json?.person;
    
    if (!person) {
      console.warn('apolloContactEnrichment missing person key', Object.keys(json || {}));
      return null;
    }
    
    return person as ApolloContactEnrichment;
  } catch (error) {
    console.error('apolloContactEnrichment error:', error);
    return null;
  }
}


