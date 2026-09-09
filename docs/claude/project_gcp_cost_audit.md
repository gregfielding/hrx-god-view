# gcp cost audit

> "GCP/Firebase cost audit — 2026-09-09 RE-AUDIT: the bill is ~$2,100/mo of Firestore STORAGE (8.4 TiB, billed under service name 'App Engine'); ~1.8 BILLION dead docs in context_analysis (~1.45B) + tasks_ai_analysis (~316M) + crm_analysis (41M) that the Aug audit missed; both Aug deletion runs died; testUserUpdate trigger still live. Fix = managed `gcloud firestore bulk-delete`, never a laptop script"

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

---

## 2026-09-09 re-audit (Greg: "latest charge was $2,400+")

**The Aug 12 audit was wrong about the shape of the problem.** Bill has been ~$2,000/mo since at least May 2026 (May $2,024, Jun $2,091, Jul $1,919, Aug $2,527 incl. Places). Daily run-rate is a flat **$62-75/day** with no change after any Aug fix.

**Where it goes (Aug 2026, from the BigQuery billing export `hrx1-d3beb.billing_export`)**:
- Cloud Firestore Storage **$1,595** + Zonal Backup Storage **$498** = 83% of the bill. ⚠️ In this billing account Firestore SKUs are booked under **service = "App Engine"**, not "Cloud Firestore" — filter by SKU, not service, or you will miss it (the Aug audit did).
- Places Enterprise+Atmosphere $190 (posted 8/2 as a lump; $0 so far in Sep → the field-mask fix held). Read ops $71, functions CPU $63+$13 min-instance, egress $25. All fine.

**Database is 8.4 TiB** (metric `firestore.googleapis.com/storage/data_and_index_storage_bytes`, flat Jul→Sep). Backups ~16 TiB (schedule is WEEKLY Sunday, not daily; 10-day retention → two full copies overlap).

**What the 8.4 TiB is** — three orphaned collections from the AI logging pipeline removed in 342401df 2025-11-24 (dev-notes/logging-refactor.md explicitly marked context_analysis "Only used for AI debugging → Delete"; last write in all three = 2025-08-28 14:07 PT; zero code references; docs are `{logId, analysis, timestamp}`):
| collection | docs | avg doc | method |
|---|---|---|---|
| `context_analysis` | **~1.45 BILLION** | 341 B | ID-prefix sampling (count() times out) |
| `tasks_ai_analysis` | **~316 MILLION** | 194 B | ID-prefix sampling |
| `crm_analysis` | 41,231,877 | 505 B | exact count() |
| `test_logs` | 684,513 (+135k since Aug) | 27 KB | exact; STILL GROWING |
Sampling calibration: prefix estimate for crm_analysis = 47.1M vs true 41.2M (~15% high). Subcollection sweep (174 collection-group ids) found nothing else large (biggest legit: messageLogs 2.1M, activityLogs 219k). Scripts: `functions/.scratch/storage_census{,2,3}.ts`.

**Why the Aug deletion never happened**: run 1 died at 4.19M, the nohup relaunch died at 1.8M ~90 min in (log `functions/.scratch/delete-junk.log` ends 2026-08-13 05:02Z; laptop sleep/reboot). Nobody checked. At the observed 440 deletes/s, 1.8B docs would take ~47 days from a laptop anyway — **use the managed server-side operation instead**:
```
gcloud firestore bulk-delete --database='(default)' --project=hrx1-d3beb \
  --collection-ids=context_analysis,tasks_ai_analysis,crm_analysis,test_logs --async
gcloud firestore operations list --project=hrx1-d3beb   # progress
```
Managed bulk delete bills as ordinary deletes (nam5 $0.02/100k) → ~$360 one-time for 1.8B docs, pays back in ~5 days. It deletes by collection-GROUP id: verified none of the four names is used as a subcollection anywhere (`test_logs/mockSms/events` is group `events`; those docs become orphans, harmless).

**`testUserUpdate` IS deployed** (Aug audit said it wasn't): gen2 trigger on `users/{userId}` updated, ~77k executions/week, each writing a 27 KB before+after dump of the user doc (PII) to `test_logs`. Exported at functions/src/index.ts ~L9249. Remove the export + `gcloud functions delete testUserUpdate --region=us-central1` (also frees a Cloud Run slot).

**Expected after cleanup**: storage → ~$5-10/mo, backups → ~$5/mo once the two 8-TiB weekly backups age out (≤10 days; or delete them early with `gcloud firestore backups delete`). Total ≈ **$250-300/mo** (functions ~$90, reads ~$70, egress/hosting/misc). Watch `data_and_index_storage_bytes` drop over the days after the operation.

**DONE 2026-09-09 (Greg ran / approved)**:
- Greg launched `gcloud firestore bulk-delete` on the four collections 16:45Z. Google's own estimate: **1,805,725,726 docs / 697 GB raw**. Op name in `gcloud firestore operations list` (BulkDeleteDocumentsMetadata). Early throughput was slow (~150-250 docs/s in the first 30 min); if it plateaus under ~1k/s the fallback is a parallel key-range deleter as a Cloud Run job.
- `testUserUpdate` function DELETED (all regions, no Run service) + its export removed from index.ts. Do not re-export.
- `chatWithGPT` min instance removed: `minInstances: 1` dropped from gptGateway.ts AND `gcloud run services update chatwithgpt --min-instances=0` applied directly (0 executions in the prior 30 days; was ~$20/mo).

**Remaining levers after storage (~$300/mo → maybe $220)** — per-function CPU Sep 1-7 and a client-side read audit:
- Firestore reads 120M/mo ($71) + Firestore→internet egress 234 GB/mo ($25) are mostly the WEB CLIENT. Full-`users`-collection `getDocs` (14.3k docs × 14.8 KB ≈ 210 MB per fire, no projection): `src/components/recruiter/RecruiterMultiSelect.tsx:42` (on mount when no `options` prop — RecruiterUserGroupDetails doesn't pass one), `src/utils/userGroupManagerCandidateUsers.ts:37` (UserGroupsTab + UserGroupDetails mounts), `src/pages/TenantViews/OrgTreeView.tsx:199` (page mount, only to count job titles). Per-keystroke `limit(500)` full-doc pulls (~7 MB each): `src/hooks/useMentionSearch.ts:40,291`, `src/components/MessageDrawer.tsx:454`; on mount: SenderManagementPage.tsx:84, MessagingTab.tsx:1905. `CompanyDirectory.tsx:143` passes `_cacheBust: Date.now()` to getUsersByTenant, defeating its 10-min cache. Worker-facing views are clean.
- `listTenantWorkerDirectory` (8.5k user reads/call, 639 calls/wk ≈ 23M reads/mo): `src/hooks/useTenantWorkerDirectory.ts` revalidates on EVERY mount even with a warm IndexedDB cache — add a freshness gate (~15 min).
- `evereeReconcileCron` = 20% of all function CPU (every 2h × 8.6 min, sweeps every worker across tenants; ~$12/mo). 2h cadence is a product decision (I-9 auto-clear ≤2h) — only change with Greg.
- `fetchFollowedCompanyNews` scheduled full `users` scan + per-user subcollection query (~28.6k reads/run).
- Everything else (Pub/Sub $3.6, Scheduler $3.9, Secret Manager $2.3, Artifact Registry $2.1, hosting) is noise.

**Throughput / economics measured 2026-09-09 17:20-17:40Z** (so nobody re-learns this):
- Managed bulk-delete ramped 150/s → ~1,500-1,700/s by +45 min and plateaued there (~12-14 days for 1.8B). Billed deletes + 1 read per 1,000 index entries.
- TTL policies (`gcloud firestore fields ttls update timestamp --collection-group=X --enable-ttl`) started deleting within ~6 min even while state still said CREATING: `document/ttl_deletion_count` ≈ 500-1,000/s. Billed deletes only. Stacks with the managed op.
- A parallel Cloud Run Job (`junk-deleter`, code in functions/.scratch/junk-deleter/, 3,844 ID-prefix ranges × N tasks × BulkWriter) did ~1,000 deletes/s per task on 3-field docs, ~100/s on test_logs (27 KB docs → hundreds of index entries each). BUT keys-only `select()` queries bill a FULL document read per key (verified: read_count rose ≈ delete_count during the test; `api/billable_read_units` is Enterprise-only, no data). So a DIY deleter costs +$0.06/100k = ~$1,080 for 1.8B keys — more than the ~$50/day of storage it would save by finishing a week sooner. Only use it if the managed op + TTL stall. Job left deployed (not running); smoke executions cancelled.
