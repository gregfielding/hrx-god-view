# Google Jobs / public job board SEO

> `jobPostingSeo` (functions/src/seo/jobPostingSeo.ts) behind Firebase Hosting rewrites: real
> title/description/canonical + schema.org JobPosting JSON-LD on `/:slug/jobs-board/:postId`,
> a board title on `/:slug/jobs-board`, and a dynamic `/sitemap.xml`. Built 2026-09-09 after finding
> Google had indexed 4 hrxone.com URLs, one with the snippet "You need to enable JavaScript to run this app."

## How it works
- Hosting rewrites (firebase.json, before `**`): `/sitemap.xml`, `/*/jobs-board`, `/*/jobs-board/*` → function.
- The function fetches the SPA shell (`<origin>/index.html`, fallback hrx1-d3beb.web.app), strips the generic
  `<title>`/description, injects title, meta description, canonical, Open Graph and `<script type="application/ld+json">`
  (JobPosting: title, description HTML, identifier, datePosted, validThrough = now+30d, employmentType, hiringOrganization
  C1 Staffing, jobLocation PostalAddress, baseSalary/hour when payRate, directApply, url) plus a `<noscript>` summary.
  The React app boots unchanged. Cache-Control 300s; shell and tenant-slug lookups cached per instance.
- Sources: `tenants/{t}/job_postings` where status=='active' and visibility∈{public,unset}; `job-order-<id>` post ids
  resolve to `tenants/{t}/job_orders` (jobType gig, open/partially_filled/active). Every tenant with a `slug` is included.
- Not public / expired → HTTP 404 + `noindex` with the shell (Google drops it; humans see the app's not-found state).
- Origin is domain-agnostic: `platform_config/seo.canonicalOrigin` → request host → hrxone.com. See the domain-move
  checklist in project_conventions.md.
- `/robots.txt` is a STATIC file in public/ — the Cloud Functions runtime answers /robots.txt and /favicon.ico with 404
  before user code runs, so it cannot be served by the function.

## Verified 2026-09-09
`https://hrxone.com/sitemap.xml` → 201 URLs; `…/c1/jobs-board/Xu8hmPdNbCu8gLtP8ufM` → title "Warehouse Operative —
Denver, CO | C1 Staffing" with a valid JobPosting block ($19.29/hour, Denver 80239); missing post → 404.

## Still to do
- Submit the sitemap in Google Search Console (property hrxone.com; the site already carries
  public/googleb7ec2f235d73bfd4.html verification) — Greg's Google account.
- Watch Search Console → Enhancements → Job postings for validation errors after the first crawl (days).
- Description quality: JSON-LD `description` comes from `jobDescription`; postings with a thin description get a
  generated one-liner. Natalie could enrich descriptions on new postings.
- Job orders listed on the board that have no job_posting doc are only covered via `job-order-<id>` detail URLs; the
  sitemap lists job_postings only. Add open gig job orders to the sitemap if the board keeps showing them.
