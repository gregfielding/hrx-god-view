# Craigslist — semi-automated posting (opt-in per job board post)

> Greg 2026-09-09: "I don't want this for every posting. We'll need a checkbox or toggle on a jobs
> board post to activate semi-automated CL postings." Craigslist forbids automated posting and
> fingerprints headless browsers (ghosting), so HRX never submits to craigslist.org; it prepares
> everything and tracks the result.

## Flow
1. Job post form (`src/components/JobPostForm.tsx`, "Post to Craigslist (semi-automated)" switch,
   saved as `job_postings.craigslist: CraigslistPosting` — shared/craigslist.ts, mirrored).
   Toggle on → `status: 'requested'`.
2. `drainCraigslistDrafts` (functions/src/natalie/natalieCraigslist.ts, runs in the natalieSlackInbox
   tick every minute) drafts title + body with Claude from the post's facts (never invents),
   resolves the Craigslist site from city/state (`craigslistSiteFor`), the category from jobType
   (gig → gigs > labor gigs, else jobs > general labor), writes `craigslist.draft`, posts it in
   #recruiting (`app_config/natalie.recruitingChannelId`, default C0BF02MEKUP), status 'ready'.
3. A human (or Claude driving Greg's Chrome on request: "post the Craigslist queue") opens
   `draft.postUrl`, pastes title/body/location/compensation, uses contact email
   n.brooks@c1staffing.com, pays (jobs are paid on every US site: ~$10–20 Denver, $75 SF Bay;
   gigs free in most metros), and pastes the live URL into the post's Craigslist URL field — or
   tells Natalie, who calls `craigslist_mark_posted`. Status 'posted', `expiresAt` = +30d (jobs) /
   +7d (gigs).
4. The drain flips 'posted' → 'expired' at expiry and nudges the #recruiting thread 2 days before.
5. Replies: Craigslist relays to Natalie's mailbox; she triages like any applicant email.

## Natalie tools
`craigslist_queue` (all enabled posts with status/site/category/postUrl/liveUrl/expiry),
`craigslist_mark_posted {postId, liveUrl}`. Prompt rule: she never claims to have published.

## Notes / gotchas
- The form's existing `craigslistUrl` field doubles as the "live URL" input; `craigslist.status`
  is set to 'posted' by the tool or (TODO) by the form when a craigslist.org URL is pasted.
- Site map covers the metros C1 works in; unknown cities fall back to the state default.
- Queries use equality on nested fields (`craigslist.status`, `craigslist.enabled`) — auto-indexed.
