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
   the account's email (see gotcha below), pays (jobs are paid on every US site: ~$10–20 Denver,
   $75 SF Bay; Denver gigs are $7 — verified 2026-09-09), and pastes the live URL into the post's
   Craigslist URL field — or tells Natalie, who calls `craigslist_mark_posted`. Status 'posted',
   `expiresAt` = +30d (paid posts in both sections; the preview page says so).
4. The drain flips 'posted' → 'expired' at expiry and nudges the #recruiting thread 2 days before.
5. Replies: Craigslist relays to Natalie's mailbox; she triages like any applicant email.

## Natalie tools
`craigslist_queue` (all enabled posts with status/site/category/postUrl/liveUrl/expiry),
`craigslist_mark_posted {postId, liveUrl}`. Prompt rule: she never claims to have published.

## Notes / gotchas
- **Reply email is NOT a form field.** Craigslist replies go to the email of the account you post
  from (Greg's account → g.fielding@c1staffing.com via CL mail relay). The draft's
  `contactEmail: n.brooks@` only applies if someone posts from a Craigslist account registered to
  Natalie's mailbox. Until then: Greg forwards CL relay replies to Natalie, or applicants use the
  Apply Here link (preferred — it lands in HRX).
- **Driving the posting flow from Claude-in-Chrome (2026-09-09, Greg's account, tab 1557242510):**
  the flow is area → type ("gig offered") → "I want to hire someone" → category ("labor gigs $7") →
  details form → map → images → preview. Ref-based clicks (`ref_N`) do NOT register on
  post.craigslist.org — use coordinate clicks from a screenshot. `form_input` works on the real
  inputs (title, city, ZIP, description textarea, compensation). The area combobox is a styled
  SPAN over a hidden `select[name=n]`; leaving it at the site default ("denver, CO") is fine. Pick
  "use CL mail relay". The preview page is the last stop before "publish" → payment; leave that
  click to Greg.
- **Delivery status 2026-09-09:** OnTrac Denver Warehouse Operative gig (post Xu8hmPdNbCu8gLtP8ufM)
  staged to the preview step in Greg's account; awaiting his publish + $7.
- The form's existing `craigslistUrl` field doubles as the "live URL" input; `craigslist.status`
  is set to 'posted' by the tool or (TODO) by the form when a craigslist.org URL is pasted.
- Site map covers the metros C1 works in; unknown cities fall back to the state default.
- Queries use equality on nested fields (`craigslist.status`, `craigslist.enabled`) — auto-indexed.

## 2026-09-09 follow-ups (Greg): description quality, verbatim CL body, Apply Here
- **Thin AI descriptions — root cause**: `generateJobDescription` ran gpt-4o-mini, max_tokens 800,
  temperature 0.7, asking for 200–400 words → short/generic first drafts, better on re-run mostly by
  luck + more fields filled. Now `functions/src/jobs/jobDescriptionGenerator.ts`: Claude Opus 5,
  adaptive thinking, 2,500 tokens, structured template (~350–600 words), same show/hide toggle rules.
  The recruiters' button and Natalie both use it. Override model with env `JOB_DESCRIPTION_MODEL`.
- **Auto-fill**: `drainThinJobDescriptions` (inbox tick, max 3/tick) writes descriptions for active
  public posts under 300 chars when there is source material (client notes / prompt / company+title),
  stamps `jobDescriptionGeneratedAt/By`, and tells #recruiting; no-source posts are flagged once
  (`descriptionAutoFillSkipped`). Off switch: `app_config/natalie.autoFillDescriptions=false`.
- **Craigslist body = the job board description verbatim** + `Apply Here: https://hrxone.com/c1/jobs-board/<postId>`
  (the same link the job order's "Copy Jobs Board Link" button copies). Title is deterministic:
  `<post title> - <City, ST> - $X.XX/hr, weekly pay` (≤70 chars). Thin descriptions are generated first.
