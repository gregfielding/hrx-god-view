/**
 * Inventory of external APIs & services referenced in the HRX codebase (functions + web app).
 * Used by Settings → APIs & Services (sidebar group). Update when adding a new vendor integration.
 */

export type ApiServiceCategoryId =
  | 'platform'
  | 'communications'
  | 'google'
  | 'ai'
  | 'screening'
  | 'enrichment'
  | 'finance'
  | 'collaboration';

export type ApiServiceCatalogEntry = {
  id: string;
  name: string;
  /** One line for list rows */
  summary: string;
  categoryId: ApiServiceCategoryId;
  /** Longer bullets for detail drawer */
  whatItDoes: string[];
  /** Where users or admins touch it */
  surfaces: string[];
  /** Stack / ops hints (no secrets) */
  technicalNotes?: string[];
  /** Related Settings tab key for deep links (must match a core settings `tab` value) */
  relatedSettingsTab?: string;
  /** Optional doc path in repo */
  internalDocPath?: string;
};

export const API_SERVICE_CATEGORY_LABELS: Record<ApiServiceCategoryId, string> = {
  platform: 'Platform & hosting',
  communications: 'Communications',
  google: 'Google APIs',
  ai: 'AI & ML',
  screening: 'Screening & eligibility',
  enrichment: 'Data enrichment',
  finance: 'Finance',
  collaboration: 'Collaboration',
};

/**
 * Order within each category is meaningful (core → supporting).
 */
export const APIS_AND_SERVICES_CATALOG: ApiServiceCatalogEntry[] = [
  {
    id: 'firebase-gcp',
    name: 'Firebase & Google Cloud',
    summary: 'Core backend: database, auth, serverless functions, file storage',
    categoryId: 'platform',
    whatItDoes: [
      'Firestore holds tenant and application data.',
      'Firebase Authentication issues user sessions and custom claims.',
      'Cloud Functions run messaging, webhooks, CRM automation, and integrations.',
      'Firebase Storage hosts uploads where configured.',
    ],
    surfaces: ['Entire product', 'Firebase console (operators)'],
    technicalNotes: ['Project configuration via Firebase / GCP console and deploy pipelines.'],
  },
  {
    id: 'twilio',
    name: 'Twilio',
    summary: 'SMS and programmable phone numbers for recruiter and system messaging',
    categoryId: 'communications',
    whatItDoes: [
      'Sends SMS for assignments, onboarding, alerts, and two-way recruiter messaging.',
      'Purchased or assigned numbers back tenant/recruiter sender configuration.',
    ],
    surfaces: ['Settings → Sender Management', 'Text messages', 'Messaging automations'],
    technicalNotes: ['Tenant integrations under `integrations.twilio`; callable helpers for numbers.'],
    relatedSettingsTab: 'senders',
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    summary: 'Outbound email delivery and event webhooks for transactional mail',
    categoryId: 'communications',
    whatItDoes: [
      'Delivers system and recruiter emails when Gmail is not the selected sender.',
      'Inbound webhooks can drive delivery and engagement signals.',
    ],
    surfaces: ['Settings → Messaging', 'Email threads', 'Automated messaging'],
    technicalNotes: ['Functions use `@sendgrid/mail`; API key from runtime config / env.'],
    relatedSettingsTab: 'messaging',
  },
  {
    id: 'gmail-google-oauth',
    name: 'Gmail (Google OAuth)',
    summary: 'Per-user Google mail send and sync for recruiter email identities',
    categoryId: 'communications',
    whatItDoes: [
      'OAuth connects a user’s Gmail mailbox for sending and threading.',
      'Supports recruiter inbox experiences alongside SendGrid.',
    ],
    surfaces: ['Settings → Sender Management', 'User inbox', 'Company / contact email features'],
    technicalNotes: ['Tokens stored per user; Gmail API via googleapis.'],
    relatedSettingsTab: 'senders',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar API',
    summary: 'Calendar integration and push notifications for scheduling',
    categoryId: 'google',
    whatItDoes: [
      'Reads and writes calendar data where Google integration is enabled.',
      'Webhook / push channel wiring keeps HRX responsive to calendar changes.',
    ],
    surfaces: ['Calendar UI', 'Settings / calendar webhook configuration'],
    technicalNotes: ['Implemented via `googleapis`; requires Google Cloud project APIs enabled.'],
  },
  {
    id: 'google-geocoding',
    name: 'Google Maps Geocoding',
    summary: 'Validates addresses and resolves lat/lng for locations and profiles',
    categoryId: 'google',
    whatItDoes: [
      'Standardizes addresses entered in forms (e.g. agency locations, worker address steps).',
    ],
    surfaces: ['Agency profile locations', 'Apply flow address step', 'Location tooling'],
    technicalNotes: ['Browser calls Geocoding REST with `REACT_APP_GOOGLE_MAPS_API_KEY`.'],
  },
  {
    id: 'google-indexing',
    name: 'Google Indexing API',
    summary: 'Notifies Google when public job postings change (Jobs-related SEO)',
    categoryId: 'google',
    whatItDoes: [
      'Publishes job URL updates to speed index refresh for jobs board surfaces.',
    ],
    surfaces: ['Jobs board / job posting lifecycle'],
    technicalNotes: ['Uses service account–style access with Indexing scope in Cloud Functions.'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    summary: 'LLM and embedding APIs for scoring, parsing, and workflow assistance',
    categoryId: 'ai',
    whatItDoes: [
      'Chat completions for prescreen evaluation, enrichment, devops chat, and similar flows.',
      'Embeddings support semantic / code-aware features where implemented.',
    ],
    surfaces: ['AI hiring flows', 'Contact/company enhancement', 'Internal admin tools'],
    technicalNotes: ['API keys via Functions config (`openai_api_key`, model env vars).'],
    relatedSettingsTab: 'ai-signals',
  },
  {
    id: 'slack',
    name: 'Slack',
    summary: 'Workspace notifications and optional bot-style messaging',
    categoryId: 'collaboration',
    whatItDoes: [
      'Posts messages and reads channel metadata via Slack Web API.',
      'Supports internal alignment and feed-style notifications.',
    ],
    surfaces: ['Settings → Slack Integration', 'Feed / notification flows'],
    technicalNotes: ['OAuth tokens per workspace; REST to slack.com/api.'],
    relatedSettingsTab: 'slack',
  },
  {
    id: 'accusource-sourcedirect',
    name: 'AccuSource / SourceDirect',
    summary: 'Background screening orders, applicant portal, and screening webhooks',
    categoryId: 'screening',
    whatItDoes: [
      'Creates and tracks screening packages; receives status webhooks.',
      'Applicant self-service links use SourceDirect-hosted setup URLs.',
    ],
    surfaces: ['Recruiter screening UI', 'Applicant portal', 'Staff onboarding background checks'],
    technicalNotes: [
      'Sandbox vs production hosts (`sdapi-sandbox.accusourcedirect.*` vs `sdapi.accusourcedirect.com`).',
      'Secrets: API keys and webhook signing via Firebase params / env.',
    ],
  },
  {
    id: 'everify-uscis',
    name: 'E-Verify (USCIS)',
    summary: 'Federal employment eligibility verification cases and status',
    categoryId: 'screening',
    whatItDoes: [
      'Submits and polls E-Verify cases tied to hiring workflows.',
      'Separate OAuth configuration from commercial screening vendors.',
    ],
    surfaces: ['Settings → E-Verify Ops', 'Onboarding / I-9 adjacent flows'],
    technicalNotes: ['Dedicated REST client under `functions/src/integrations/everify`; USCIS endpoints.'],
    relatedSettingsTab: 'everify-ops',
  },
  {
    id: 'apollo',
    name: 'Apollo.io',
    summary: 'B2B organization enrichment by domain for CRM-style company data',
    categoryId: 'enrichment',
    whatItDoes: [
      'Enriches company records from email domain where enabled.',
    ],
    surfaces: ['Company detail enhancement', 'CRM enrichment actions'],
    technicalNotes: ['Feature-gated via config (`ENABLE_APOLLO`); REST to api.apollo.io.'],
  },
  {
    id: 'serpapi',
    name: 'SerpAPI',
    summary: 'Programmatic Google SERP results for news and profile discovery',
    categoryId: 'enrichment',
    whatItDoes: [
      'Supports contact enrichment (news, social hints) and company news pulls.',
    ],
    surfaces: ['Company news', 'Contact / company enhancement pipelines'],
    technicalNotes: ['`SERP_API_KEY` in Functions environment.'],
  },
  {
    id: 'hunter-io',
    name: 'Hunter.io',
    summary: 'Email finder API for prospect email discovery by name + domain',
    categoryId: 'enrichment',
    whatItDoes: [
      'Used where contact email discovery callables are invoked.',
    ],
    surfaces: ['Contact email tooling (operator flows)'],
    technicalNotes: ['API key via environment in Functions.'],
  },
  {
    id: 'clearbit-note',
    name: 'Clearbit (optional fallback)',
    summary: 'Optional enrichment fallback when enabled in configuration',
    categoryId: 'enrichment',
    whatItDoes: ['May supplement firmographic enrichment when configured.'],
    surfaces: ['Company enrichment pipeline'],
    technicalNotes: ['Controlled by feature flags / config reader (`ENABLE_CLEARBIT_FALLBACK`).'],
  },
  {
    id: 'quickbooks-online',
    name: 'QuickBooks Online (Intuit)',
    summary: 'Planned invoicing and AR: customer mapping to HRX accounts',
    categoryId: 'finance',
    whatItDoes: [
      'OAuth and Accounting API planned to replace legacy invoicing; sync invoices and balances per account.',
    ],
    surfaces: ['Account invoicing tab', 'Global invoicing (planned)', 'Account `integrations.quickbooks` fields'],
    technicalNotes: ['See `docs/QUICKBOOKS_ONLINE_INTEGRATION_REFERENCE.md`; types on `RecruiterAccount.integrations.quickbooks`.'],
    internalDocPath: 'docs/QUICKBOOKS_ONLINE_INTEGRATION_REFERENCE.md',
  },
  {
    id: 'electronic-signatures',
    name: 'Electronic signatures (HRX signer)',
    summary: 'Hosted signing flows for agreements tied to onboarding and documents',
    categoryId: 'platform',
    whatItDoes: [
      'Uses configurable signer base URL for document completion links.',
    ],
    surfaces: ['Documents & signatures settings', 'Onboarding packets'],
    technicalNotes: ['`SIGN_SIGNER_BASE_URL` defaults to app host; not a third-party brand but external-facing URL contract.'],
    relatedSettingsTab: 'documents',
  },
];

export function catalogByCategory(): Record<ApiServiceCategoryId, ApiServiceCatalogEntry[]> {
  const empty: Record<ApiServiceCategoryId, ApiServiceCatalogEntry[]> = {
    platform: [],
    communications: [],
    google: [],
    ai: [],
    screening: [],
    enrichment: [],
    finance: [],
    collaboration: [],
  };
  for (const entry of APIS_AND_SERVICES_CATALOG) {
    empty[entry.categoryId].push(entry);
  }
  return empty;
}

/** Prefix for Settings tab keys under the “APIs & Services” sidebar group. */
export const APIS_SERVICES_TAB_PREFIX = 'apis-services__';

export function apisServiceTabKey(serviceId: string): string {
  return `${APIS_SERVICES_TAB_PREFIX}${serviceId}`;
}

/** Returns catalog id when `tab` is a valid APIs & Services nav key; otherwise null. */
export function parseApisServicesTab(tab: string): string | null {
  if (!tab.startsWith(APIS_SERVICES_TAB_PREFIX)) return null;
  const id = tab.slice(APIS_SERVICES_TAB_PREFIX.length);
  return APIS_AND_SERVICES_CATALOG.some((e) => e.id === id) ? id : null;
}

export function getApisServiceCatalogEntry(serviceId: string): ApiServiceCatalogEntry | undefined {
  return APIS_AND_SERVICES_CATALOG.find((e) => e.id === serviceId);
}
