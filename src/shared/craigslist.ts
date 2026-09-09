/**
 * Semi-automated Craigslist posting (Greg 2026-09-09): opt-in PER job board post.
 *
 * Flow: recruiter flips "Post to Craigslist" on a job post → `craigslist.status = 'requested'`
 * → Natalie's outbox drain writes a Craigslist-ready draft (`craigslist.draft`) and posts it in
 * #recruiting → a human (or Claude driving the recruiter's browser) publishes it on the
 * Craigslist site/category below, pays, and pastes the live URL into the post's Craigslist URL
 * field → status 'posted' with an expiry → Natalie nudges before expiry. Replies go to
 * Natalie's mailbox (n.brooks@c1staffing.com) via Craigslist's relay.
 *
 * Craigslist forbids automated posting; nothing here submits to craigslist.org.
 */

export type CraigslistStatus =
  | 'off'         // toggle off (or never enabled)
  | 'requested'   // toggle on, draft not written yet
  | 'ready'       // draft written; waiting for a human to publish
  | 'posted'      // live URL recorded
  | 'expired'     // past expiresAt (renew or repost)
  | 'error';      // draft generation failed; see lastError

export interface CraigslistDraft {
  /** Craigslist site subdomain, e.g. "denver", "sfbay", "austin". */
  site: string;
  /** Posting category path shown to the human, e.g. "jobs > general labor" or "gigs > labor gigs". */
  category: string;
  /** Deep link to the posting flow for that site (human clicks; may still require picking the area/category). */
  postUrl: string;
  title: string;
  body: string;
  /** Craigslist "specific location" field. */
  specificLocation: string;
  /** Compensation line for the compensation field. */
  compensation: string;
  /** Contact email to use in the form (Craigslist relay masks it). */
  contactEmail: string;
  generatedAt: string; // ISO
  generatedBy: 'natalie' | 'human';
}

export interface CraigslistPosting {
  enabled: boolean;
  status: CraigslistStatus;
  draft?: CraigslistDraft | null;
  requestedAt?: string | null;   // ISO
  requestedBy?: string | null;   // uid
  postedAt?: string | null;      // ISO — set when the live URL is recorded
  expiresAt?: string | null;     // ISO — postedAt + 30 days (jobs) / 7 days (gigs)
  renewedAt?: string | null;
  lastError?: string | null;
  slackTs?: string | null;       // #recruiting thread where the draft was posted
}

/** Craigslist site (subdomain) by US state → default, with metro overrides by city. */
const STATE_DEFAULT_SITE: Record<string, string> = {
  CO: 'denver', TX: 'austin', CA: 'sfbay', WA: 'seattle', OR: 'portland', AZ: 'phoenix', NV: 'lasvegas', UT: 'saltlakecity',
  NM: 'albuquerque', OK: 'oklahomacity', KS: 'kansascity', MO: 'kansascity', NE: 'omaha', MN: 'minneapolis', IL: 'chicago',
  WI: 'milwaukee', MI: 'detroit', OH: 'columbus', IN: 'indianapolis', KY: 'louisville', TN: 'nashville', GA: 'atlanta',
  FL: 'orlando', NC: 'charlotte', SC: 'charleston', VA: 'norfolk', MD: 'baltimore', PA: 'philadelphia', NJ: 'newjersey',
  NY: 'newyork', MA: 'boston', CT: 'hartford', LA: 'neworleans', AL: 'bham', MS: 'jackson', AR: 'littlerock', IA: 'desmoines',
  ID: 'boise', MT: 'billings', WY: 'wyoming', SD: 'sd', ND: 'fargo', HI: 'honolulu', AK: 'anchorage', DC: 'washingtondc',
  DE: 'delaware', RI: 'providence', VT: 'burlington', NH: 'nh', ME: 'maine', WV: 'wv',
};

const CITY_SITE: Array<[RegExp, string]> = [
  [/denver|aurora|lakewood|littleton|thornton|westminster|arvada|centennial|englewood|commerce city|broomfield|golden|parker/i, 'denver'],
  [/colorado springs/i, 'cosprings'], [/fort collins|loveland|greeley/i, 'fortcollins'], [/boulder|longmont/i, 'boulder'],
  [/san francisco|oakland|berkeley|san jose|fremont|hayward|daly city|south san francisco|redwood city|palo alto|sunnyvale|santa clara|richmond|concord|walnut creek|san mateo|mountain view/i, 'sfbay'],
  [/los angeles|long beach|glendale|pasadena|burbank|torrance|inglewood|santa monica|compton|downey|carson|el segundo|commerce|vernon/i, 'losangeles'],
  [/san diego|chula vista|escondido|oceanside/i, 'sandiego'], [/sacramento|elk grove|roseville/i, 'sacramento'], [/fresno/i, 'fresno'],
  [/austin|round rock|pflugerville|cedar park|georgetown/i, 'austin'], [/dallas|fort worth|arlington|plano|irving|garland|grand prairie|mesquite|frisco|mckinney/i, 'dallas'],
  [/houston|pasadena, tx|sugar land|katy|baytown|the woodlands/i, 'houston'], [/san antonio|new braunfels/i, 'sanantonio'], [/el paso/i, 'elpaso'],
  [/seattle|bellevue|kent|renton|tacoma|everett|auburn|federal way|sumner/i, 'seattle'], [/portland|beaverton|hillsboro|gresham|vancouver, wa/i, 'portland'],
  [/phoenix|tempe|mesa|chandler|glendale, az|scottsdale|goodyear|tolleson/i, 'phoenix'], [/tucson/i, 'tucson'], [/las vegas|henderson|north las vegas/i, 'lasvegas'], [/reno|sparks/i, 'reno'],
  [/salt lake|west valley|ogden|provo/i, 'saltlakecity'], [/kansas city|overland park|olathe|lenexa|independence/i, 'kansascity'], [/st\.? louis/i, 'stlouis'],
  [/chicago|naperville|aurora, il|joliet|elgin|bolingbrook|romeoville/i, 'chicago'], [/minneapolis|st\.? paul|bloomington, mn/i, 'minneapolis'], [/milwaukee/i, 'milwaukee'],
  [/detroit|dearborn|warren|livonia/i, 'detroit'], [/columbus/i, 'columbus'], [/cleveland/i, 'cleveland'], [/cincinnati/i, 'cincinnati'], [/indianapolis/i, 'indianapolis'],
  [/nashville/i, 'nashville'], [/memphis/i, 'memphis'], [/atlanta|marietta|alpharetta|smyrna/i, 'atlanta'], [/orlando/i, 'orlando'], [/tampa|st\.? petersburg|clearwater/i, 'tampa'],
  [/miami|fort lauderdale|hialeah|hollywood, fl/i, 'miami'], [/jacksonville/i, 'jacksonville'], [/charlotte/i, 'charlotte'], [/raleigh|durham|cary/i, 'raleigh'],
  [/richmond, va/i, 'richmond'], [/baltimore/i, 'baltimore'], [/philadelphia/i, 'philadelphia'], [/pittsburgh/i, 'pittsburgh'], [/new york|brooklyn|queens|bronx|manhattan/i, 'newyork'],
  [/boston|cambridge|somerville/i, 'boston'], [/new orleans/i, 'neworleans'], [/oklahoma city/i, 'oklahomacity'], [/omaha/i, 'omaha'], [/albuquerque/i, 'albuquerque'],
  [/boise/i, 'boise'], [/honolulu/i, 'honolulu'], [/anchorage/i, 'anchorage'], [/washington|arlington, va|alexandria/i, 'washingtondc'],
];

export function craigslistSiteFor(city: string, state: string): string {
  const c = (city || '').trim();
  for (const [re, site] of CITY_SITE) if (re.test(c)) return site;
  return STATE_DEFAULT_SITE[(state || '').trim().toUpperCase()] || 'denver';
}

/** jobs are paid on every US site; gigs are the temporary-work section (paid in some metros). */
export function craigslistCategoryFor(jobType: string): { category: string; slug: string } {
  return (jobType || '').toLowerCase() === 'gig'
    ? { category: 'gigs > labor gigs', slug: 'lbg' }
    : { category: 'jobs > general labor', slug: 'lab' };
}

export function craigslistPostUrl(site: string, slug: string): string {
  // The posting flow is https://post.craigslist.org/c/<site>; the category is picked in-flow.
  // Landing on the section list helps the human confirm the right area first.
  return `https://post.craigslist.org/c/${site}?cat=${slug}`;
}

export function craigslistExpiryDays(jobType: string): number {
  return (jobType || '').toLowerCase() === 'gig' ? 7 : 30;
}
