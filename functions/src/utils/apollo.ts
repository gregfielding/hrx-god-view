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
  organization?: {
    id?: string;
    name?: string;
    domain?: string;
    industry?: string;
    employeeCount?: number;
    location?: string;
    websiteUrl?: string;
    linkedinUrl?: string;
  } | null;
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
  phone?: string; // Add phone field
  phone_number?: string; // Alternative phone field name
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

export async function apolloPeopleSearch(params: { domain?: string; companyId?: string; titles?: string[]; departments?: string[]; seniorities?: string[]; limit?: number; locations?: string[] }, apiKey: string): Promise<ApolloPerson[]> {
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
      // Enable email and phone revelation
      reveal_personal_emails: true,
      reveal_phone_number: true,
      // Request more data per contact
      include_phone_numbers: true,
      include_email_addresses: true,
      include_organization_data: true,
      // Add location filtering if available
      ...(params.locations && params.locations.length > 0 && {
        q_organization_locations: params.locations,
        q_organization_cities: params.locations, // Try both location parameters
        q_organization_states: params.locations
      }),
    };
    const resp = await fetch(url, { method: 'POST', headers: authHeader(apiKey), body: JSON.stringify(query) });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.warn('apolloPeopleSearch non-ok', resp.status, t);
      return [];
    }
    const json: any = await resp.json();
    console.log('🔍 Apollo People Search API response:', JSON.stringify(json, null, 2));
    
    const people: any[] = json?.people || [];
    console.log(`📊 Processing ${people.length} people from Apollo`);
    
    // Much less aggressive filtering - prioritize quantity over perfect contact info
    const filteredPeople = people.filter((p) => {
      const hasRealEmail = p.email && 
        p.email !== 'email_not_unlocked@domain.com' && 
        p.email !== 'email_not_unlocked@company.com' &&
        p.email_status !== 'unverified';
      
      const hasPhone = p.phone_number && p.phone_number.trim() !== '';
      const hasLinkedIn = p.linkedin_url && p.linkedin_url.trim() !== '';
      const hasGoodCompany = p.organization && p.organization.name && p.organization.name !== 'Unknown';
      
      // Check if location matches (if location filter is applied)
      const locationMatches = !params.locations || params.locations.length === 0 || 
        (p.organization && (
          params.locations.some(loc => 
            (p.organization.city && p.organization.city.toLowerCase().includes(loc.toLowerCase())) ||
            (p.organization.state && p.organization.state.toLowerCase().includes(loc.toLowerCase())) ||
            (p.organization.location && p.organization.location.toLowerCase().includes(loc.toLowerCase()))
          )
        ));
      
      // Keep contacts with: real email OR phone OR (good company data AND LinkedIn URL)
      // AND location matches (if location filter is applied)
      const shouldKeep = (hasRealEmail || hasPhone || (hasGoodCompany && hasLinkedIn)) && locationMatches;
      
      if (!shouldKeep) {
        console.log(`❌ Filtered out ${p.first_name} ${p.last_name}: no real email, phone, or (good company + LinkedIn)`);
      }
      
      return shouldKeep;
    });
    
    // If we still don't have enough, include more with any company data
    if (filteredPeople.length < Math.min(params.limit || 10, 8)) {
      console.log(`⚠️ Only ${filteredPeople.length} contacts after filtering. Including more...`);
      
      const additionalPeople = people.filter((p) => {
        const hasRealEmail = p.email && 
          p.email !== 'email_not_unlocked@domain.com' && 
          p.email !== 'email_not_unlocked@company.com' &&
          p.email_status !== 'unverified';
        
        const hasPhone = p.phone_number && p.phone_number.trim() !== '';
        const hasLinkedIn = p.linkedin_url && p.linkedin_url.trim() !== '';
        const hasGoodCompany = p.organization && p.organization.name && p.organization.name !== 'Unknown';
        
        // Include if we have company data AND LinkedIn URL
        return !hasRealEmail && !hasPhone && hasGoodCompany && hasLinkedIn;
      }).slice(0, Math.min(params.limit || 10, 8) - filteredPeople.length);
      
      filteredPeople.push(...additionalPeople);
      console.log(`📈 Added ${additionalPeople.length} additional contacts`);
    }
    
    console.log(`📊 Filtered from ${people.length} to ${filteredPeople.length} contacts with real contact info`);
    
    return filteredPeople.map((p, index) => {
      console.log(`👤 Processing person ${index + 1}:`, {
        name: [p.first_name, p.last_name].filter(Boolean).join(' '),
        title: p.title,
        email: p.email,
        email_status: p.email_status,
        phone: p.phone_number,
        company: p.organization?.name,
        organization: p.organization
      });
      
      return {
        id: p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(' '),
        title: p.title,
        seniority: p.seniority,
        department: p.department,
        email: p.email,
        phone: p.phone_number,
        verifiedEmail: Boolean(p.email_status && p.email_status !== 'unverified'),
        linkedinUrl: p.linkedin_url,
        // Add company information from organization field
        organization: p.organization ? {
          id: p.organization.id,
          name: p.organization.name,
          domain: p.organization.primary_domain || p.organization.website_url,
          industry: p.organization.industry,
          employeeCount: p.organization.estimated_num_employees,
          location: p.organization.city && p.organization.state ? 
            `${p.organization.city}, ${p.organization.state}` : 
            p.organization.city || p.organization.state,
          websiteUrl: p.organization.website_url,
          linkedinUrl: p.organization.linkedin_url
        } : null
      };
    });
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
  organization_name?: string;
  title?: string;
  phone?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
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
    
    // Add organization name if available
    if (params.organization_name) {
      queryParams.append('organization_name', params.organization_name);
    }
    
    // Add job title if available
    if (params.title) {
      queryParams.append('title', params.title);
    }
    
    // Add phone number if available
    if (params.phone) {
      queryParams.append('phone', params.phone);
    }
    
    // Add LinkedIn URL if available
    if (params.linkedin_url) {
      queryParams.append('linkedin_url', params.linkedin_url);
    }
    
    // Add location information if available
    if (params.city) {
      queryParams.append('city', params.city);
    }
    if (params.state) {
      queryParams.append('state', params.state);
    }
    if (params.country) {
      queryParams.append('country', params.country);
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


