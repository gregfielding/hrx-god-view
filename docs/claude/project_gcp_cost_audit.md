# gcp cost audit

> "GCP/Firebase cost audit 2026-08-12 — Places field-mask fix shipped, 47M-doc crm_analysis + test_logs deletion approved+running, SerpAPI cancelled; target ~$1,500→$600-700/mo"

Greg 2026-08-12: "cut our firebase/google cloud costs". Billing account "Firebase Payment" (014E66-91D309-FB59A2) covers hrx1-d3beb + rally-dash. Aug 1-12 spend $738.95, forecast $1,528/mo.

**Top SKUs found (billing console via his personal Chrome + gcloud)**:
- Places API "Place Details Enterprise + Atmosphere" $190/12d (~$475/mo, NEW in Aug — started with the ADDR address-collection work): 13 GoogleAutocomplete widgets across 12 pages had NO fields restriction → every selection billed premium tier. **FIXED + DEPLOYED 2026-08-12**: shared `PLACES_ADDRESS_FIELDS_OPTIONS` (src/utils/placesAutocompleteOptions.ts, module-level const per prop-churn footgun) injected via codemod. Watch the SKU drop over next days.
- Cloud Firestore Zonal Backup Storage $74.66 (2,489 GiB-months!) + Firestore storage: driven by junk collections (below). Backup schedule = daily, 10-day retention (864000s), PITR off.
- Firestore Read Ops $30 (51M reads/12d), functions CPU ~$30, egress $11.62 — acceptable.
- chatWithGPT is the ONLY min-instance function (1×512Mi, ~$7/mo). 999 functions total but idle gen2 = free; Artifact Registry 0GB (auto-cleaned). No VMs. rally-dash ≈ idle (1 run service, App Engine+BigQuery enabled, negligible).

**Firestore junk (census 2026-08-12, root collections)**:
- `crm_analysis`: **47,275,377 docs (~24GB raw + indexes)** — every doc a STORED ERROR ("query requires an index") from a deleted AI pipeline (logIds from 2025). Zero code references. **DELETION APPROVED by Greg ("delete them")**. Run 1 died silently at 4.19M docs — BulkWriter rejects the per-op promise after 5 failed attempts and the un-caught rejection kills Node 20 (pipeline exit 0 masked it via grep). FIXED (.catch on every delete) + relaunched 2026-08-13 03:33 UTC DETACHED via nohup (PID 18676, log: functions/.scratch/delete-junk.log — survives session close; check `tail` there for progress). ~43.1M remained at relaunch; observed ~440 deletes/s ramping → expect completion within ~a day. test_logs deletes after crm_analysis in the same run.
- `test_logs`: 549k docs × 26KB (~15GB) — before/after user-doc dumps from `testUserUpdate` debug trigger (exists in firestoreTriggers.ts but NOT deployed). Same deletion run.
- Recovery: 10-day backups retain deleted data post-deletion.
- Next-largest legit: users 159MB, parsedResumes 43MB — fine.

**Also cancelled 2026-08-12**: SerpAPI $75/mo (2/5,000 searches used; expires 8/22; news cron deleted; task #247 = repoint DecisionMakers panel to Apollo + remove SERP callables). Hunter.io Data-platform plan: 1,000 searches + 1,000 verifications UNUSED until 2027-08 — earmarked for bounce-list verification.

**Projected**: ~$1,528/mo → ~$600-700/mo. Optional not-yet-approved: trim backup retention 10d→5d after DB shrinks. Follow-up habit: glance at Places SKU + backup line next week to confirm the drops. [[feedback_email_bounce_handling]]
