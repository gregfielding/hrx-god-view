# C1/HRX institutional knowledge (Claude knowledge base)

Everything non-obvious about this codebase and its operations, written for
any teammate's Claude Code session. **This directory is the canonical home
for ops/dev knowledge** — when you (Claude) learn a durable ops/dev fact,
update the file here (create one if needed) and keep this index current.
Personal/strategy context stays in the operator's local memory, not here.

Load the files relevant to the task at hand; don't read all of them.

## Ongoing projects & system state

- [ai provider openai](project_ai_provider_openai.md) — SUPERSEDED 2026-08-21 by [llm provider claude](project_llm_provider_claude.md): new AI work uses `getClaudeChat()` (utils/claudeChat.ts, claude-opus-5); Phase-2 files + embeddings still on OpenAI
- [assignment backbone review](project_assignment_backbone_review.md) — "2026-07-23 full review — assignment is truth for pay/bill/schedule/identity/entity but WC code+rate and worksite street NEVER exist on assignments (no writer stamps, no consumer reads, 0/135 live docs); fix plan proposed"
- [bgc compliance migration](project_bgc_compliance_migration.md) — Background-check compliance program — policy v1.1 + P0 kit + P1 (incl. webhook secret ENFORCED) + P2 cases + P2.5 + policy page + P3 notices ALL DEPLOYED 2026-07-14; P3 FULLY LIVE (first real send verified 2026-07-14); P4 intake needs dedicated compliance-Gmail connect; P5-P6 unbuilt
- [carrier account buildout](project_carrier_account_buildout.md) — "Carrier national account — 23 Distribution Center child accounts created from coverage-map CSV 2026-07-08; markup 40, pay rates NOT yet applied"
- [conventions](project_conventions.md) — Cross-cutting code conventions that aren't obvious from grep — multi-tenant filtering, AccessRoles utility, schema codegen path, Cloud Function defaults, notifications channel, AI-logging map
- [csv timesheet import](project_csv_timesheet_import.md) — "Customer-CSV timesheet importer (new Timesheets tab): upload → parse/map → match worker by email → fill missing → review grid → submit to Everee. Architecture decisions + phase plan + Phase 0 state."
- [everee wire class splits](project_everee_wire_class_splits.md) — Everee wire → QBO class-split report for the bookkeeper — builder script + all the Everee/QBO wire-reconciliation facts (funding ids, paging params, memo formats)
- [everify disabled](project_everify_disabled.md) — "E-Verify processing in HRX was fully disabled (full stop) on 2026-06-30 at the user's request; reversible by flipping EVERIFY_ENABLED back to true + redeploy."
- [expensify card pipeline](project_expensify_card_pipeline.md) — Relay card → QBO → HRX → Expensify feed LIVE (CSV import steady state); EXP-6 class + EXP-7 note/receipt write-back Expensify→QBO WORKING e2e (2026-08-14 first full sync: 32 classes, 9 memos, 190 receipt PDFs attached); scheduled submit via CLASSIC only; receipt URLs are login-gated — per-report includeFullPageReceiptsPdf is the only server path
- [fieldglass intake pipeline](project_fieldglass_intake_pipeline.md) — "Sodexo/Fieldglass → HRX automated order-intake project — sample notification-email field inventory, gaps, and the phased plan reusing the Indeed Flex pipeline"
- [gcp cost audit](project_gcp_cost_audit.md) — "GCP/Firebase cost audit 2026-08-12 — Places field-mask fix shipped, 47M-doc crm_analysis + test_logs deletion approved+running, SerpAPI cancelled; target ~$1,500→$600-700/mo"
- [migration source convention](project_migration_source_convention.md) — Bulk-imported user docs carry a migrationSource string; the suppression helper userIsInActiveMigration() matches ^tempworks_ or ^bi1_ prefixes to silence outbound automation across 5+ message paths
- [multiday shifts](project_multiday_shifts.md) — "Multi-day gig shifts redesign — day-by-day apply/confirm/hire; P0/P1a/P1b/P2/P1c ALL shipped 2026-08-01 (P1c = one Placements card per day)"
- [offer messaging tiers](project_offer_messaging_tiers.md) — "Qwick-style offer messaging — Tier 1 (invitation framing) SHIPPED 2026-07-11; Tier 2 (true one-tap Accept Offer + Greg's \"always hire\" auto-accept designation) PARKED pending rock-solid SOPs"
- [open shift feature](project_open_shift_feature.md) — "Spec for the \"Open Shift\" feature (date-range, no-times standing-crew shift) — agreed product decisions + slice plan, before/while building"
- [payroll cost attribution](project_payroll_cost_attribution.md) — "HRX→Everee payroll cost attribution — Payroll Costs report + Everee note/label tagging; entry-status vocab, attribution fallbacks, submit-day wire splits; P3/P4 next"
- [placement id dual format](project_placement_id_dual_format.md) — Placement docs for a (shift, user) pair exist under two ID schemes — simple ${shiftId}__${userId} (UI-created) and day-scoped ${shiftId}__${userId}__${yyyy-mm-dd} (server-recreated by placementsCancelAssignment) — any read/write code must handle both
- [prescreen cumulative interview](project_prescreen_cumulative_interview.md) — "Cumulative worker pre-screen — worker-level answer bank, delta interviews, zero-delta auto-complete; shipped 2026-08-01"
- [ontrac account](project_ontrac_account.md) — OnTrac via Indeed Flex: signed agreement terms (W-2 only, fixed markups, SLAs, screening + per-booking attestation), coverage-sheet deliverable, JIT Section-2 decision, executed 116-site account build-out
- [llm provider claude](project_llm_provider_claude.md) — OpenAI → Claude migration (2026-08-21): OpenAI-shaped adapter utils/claudeChat.ts on claude-opus-5, Phase 1 (21 functions) deployed, Phase 2 file list, embeddings stay on OpenAI, the credits-outage root cause
- [indeedflex accounts](project_indeedflex_accounts.md) — Indeed Flex client-account build pipeline (coverage-sheet gviz fetch, national+children spawn footguns) + per-client build records (Mattress Firm 60 sites 2026-08-20; CORT/Purolator/AFC/Carrier Enterprise/Rhino/Domino's tabs pending)
- [recruiter roster adoption](project_recruiter_roster_adoption.md) — Why all 3 recruiter groups run on spreadsheets (people-first vs HRX shift-first), Rosa's Venue Smart sheet anatomy + 88% match test, verdict on the per-JO Google Sheets sync, and the agreed bridge: "Paste your list" → Claude-parsed confirmed assignments (design, not built — shared with Mark)
- [worker onboarding everee](project_worker_onboarding_everee.md) — Venue Smart onboarding investigation (593 active: 38 Everee-stuck, 860 tenant-wide `created`, 20% no address, 12 dup phones); embed already login-free since 2026-06-23; Everee complete-record API (`/api/v2/workers/{contractor,employee}`) enables widget-free onboarding; options 1/2/3 + phone-auth keystone (design, shared with Mark)
- [reports library](project_reports_library.md) — The /reports library — registry architecture (one entry + one route per report), live reports, and the researched roadmap of payroll/finance/compliance reports (gross margin, unbilled/WIP, cash-gap = HRX's unique pay-vs-bill position)
- [qbo invoicing](project_qbo_invoicing.md) — "QBO deep integration — D1-D3 locked; Phases 1-3 SHIPPED 2026-07-24 (read spine + 30-min cron + full UI, Venue Smart mapped+verified $549,409.96); Phase 4 (webhooks, invoice creation, AI collections) unbuilt"
- [role terminology](project_role_terminology.md) — Two distinct concepts that briefs sometimes conflate — "Recruiter" is the Firebase Auth security role + per-worker durable relationship; "Onboarding Specialist" is a per-user-group operating-role assignment for welcome calls
- [scheduling system review](project_scheduling_system_review.md) — Top-down review of HRX scheduling/assignment architecture + the drift diagnosis and phased fix (2026-07-17)
- [staff instructions jo cascade](project_staff_instructions_jo_cascade.md) — "How staff instructions reach job orders — materialized (stamped on the JO doc), not read-time resolved; creation trigger + manual sync button + 3-way merge"
- [wc classification](project_wc_classification.md) — "WC classification project — carrier import, catalog, AI classifier (slice 2 shipped 2026-07-29), and the C1 Events contractor-WC decision"

## Feature deep-dives

- [ca break penalties](feature_ca_break_penalties.md) — "CA break penalties in timesheet totals — 2026-07-30: REST penalty now DISABLED (always 0); MEAL penalty is duration-only (any >=30-min break clears it, >5h only); existing entries backfilled"
- [csv import resolution chain](feature_csv_import_resolution_chain.md) — "How the CSV timesheet importer resolves each Everee-bound field per row (worker, pay rate, WC, worksite) + the learn-once mappings"
- [dnr do not return](feature_dnr_do_not_return.md) — DNR (Do Not Return) — per-account worker blocks; model, callable, 4 enforcement points, posting account-lineage denormalization; item 2 (termination/separation) planned next
- [grid worker swap](feature_grid_worker_swap.md) — "Timesheet Grid worker swap — import rows use reassignImportEntryWorker pencil; scheduled rows use swapScheduledAssignmentWorker (assignment+entries MOVE, ids are structural)"
- [indeed flex automation roadmap](feature_indeed_flex_automation_roadmap.md) — "Indeed Flex email→JO pipeline (Phase 1 shipped 2026-07-08) + PI-7 portal Chrome extension SHIPPED 2026-07-27 (JSON courier taps agency_portal API → roster→assignments) + PI-TS timesheets capture/coverage reconcile SHIPPED 2026-08-01; awaiting Greg's one-time extension install (v1.1.0) + smoke test"
- [interview sms cadence](feature_interview_sms_cadence.md) — "Worker AI pre-screen interview-SMS outreach — the 7 trigger entry points, the 5-day cadence hard stop, and where it's enforced"
- [separation termination](feature_separation_termination.md) — Worker termination/separation (item 2) — separateWorker callable, CA final-pay gate, auto-cancel, notices, rehire block; Everee side is manual (no termination API); I-9 mirror nuance discovered
- [ts1 phase4 state](feature_ts1_phase4_state.md) — None
- [venuesmart travel crew](feature_venuesmart_travel_crew.md) — "VenueSmart C1 Select travel crew payroll pattern: Mon–Sun custom week, per-event work state (WC dialog picker), $50/day untaxed per-diem Reimbursement column, cross-entity pairing trap"

## Footguns & hard-won lessons

- [addressinfo dual schema](feedback_addressinfo_dual_schema.md) — users.addressInfo had two blind writer schemas (profile streetAddress/zip vs Everee addressLine1/postalCode) — wizard addresses displayed blank; mirrorAddressShapes is canonical
- [ai automation ethos](feedback_ai_automation_ethos.md) — Greg wants bleeding-edge AI/automation baked into every HRX build step; recommend forward-thinking ideas as we go
- [apply address dropdown stall](feedback_apply_address_dropdown_stall.md) — apply-wizard dropdown-only address rule hard-stalled mobile signups (accounts w/o addresses); manual-entry + placesGeocodeAddress callable is the fix; browser Maps key CANNOT geocode (REQUEST_DENIED)
- [apply wizard auth step drop](feedback_apply_wizard_auth_step_drop.md) — Apply/signup wizard restores activeStep from localStorage/?step= without checking auth — can drop logged-out workers past account creation
- [assignment point of truth](feedback_assignment_point_of_truth.md) — "Greg directive 2026-08-05: fill data holes by MATERIALIZING assignments (rate/company/worksite/WC), never read-time patches — completeVenueMapping is the pattern; apply to timesheet processing too"
- [auth uid orphan footgun](feedback_auth_uid_orphan_footgun.md) — Four signup entry points create fresh Auth UIDs instead of reusing the existing Firestore UID when a doc with the same email already exists — bulk-import / migration work must explicitly reuse Firestore UIDs to avoid orphaning user docs
- [chrome automation tab throttling](feedback_chrome_automation_tab_throttling.md) — "claude-in-chrome automation tabs are BACKGROUND tabs (document.hidden) — Chrome throttling starves the HRX SPA (eternal spinners, skeletal sidebar, empty queries); looks exactly like a prod outage but isn't"
- [conditional worker layout](feedback_conditional_worker_layout.md) — src/layouts/ConditionalWorkerLayout.tsx renders <Outlet /> for unauthenticated visitors — routes under it that require auth must also be wrapped in WorkerRoute, or unauth users hit a dead-end
- [everee antifraud address](feedback_everee_antifraud_address.md) — None
- [everee dual worker repair](feedback_everee_dual_worker_repair.md) — "Dual HRX-profile/Everee-worker tangles are fixable via API: worker-identifier PUT swaps externalWorkerId, list+delete worked shifts, repoint linkage doc — no Everee support needed (Zaon Cox 2026-08-13)"
- [everee wire gotchas](feedback_everee_wire_gotchas.md) — None
- [firebase spa route cache footgun](feedback_firebase_spa_route_cache_footgun.md) — "Firebase hosting header rules match REQUEST paths, not served files — SPA routes served via rewrite cached stale bundles for 1h after every deploy"
- [functions memory floor](feedback_functions_memory_floor.md) — New Cloud Functions in functions/src/ need memory: '512MiB'; the default 256MiB OOMs on cold start because the module bundle eats ~200+ MiB
- [i18n source of truth](feedback_i18n_source_of_truth.md) — None
- [i18n source vs generated](feedback_i18n_source_vs_generated.md) — Worker/jobs-board i18n keys must be edited in i18n/locales/*.json (source); public/i18n/locales/*.json are generated by the prebuild copy and get overwritten on every build
- [invisible uf8ff literal](feedback_invisible_uf8ff_literal.md) — "Literal U+F8FF chars in Firestore prefix-range bounds render invisibly and get misreported as empty-range bugs — always write the \uf8ff escape; verify suspected empty ranges with hexdump before \"fixing\""
- [local functions run parity](feedback_local_functions_run_parity.md) — Running functions code locally via ts-node scratch scripts silently diverges from prod — MockSmsProvider + Firestore undefined-value crashes; how to get parity
- [nontechnical recruiter ux](feedback_nontechnical_recruiter_ux.md) — "Recruiters are not tech-savvy — every HRX surface must be one-obvious-action, plain-English, impossible to miss a step"
- [orderby missing field invisibility](feedback_orderby_missing_field_invisibility.md) — "Firestore orderBy silently drops docs missing the field — bulk loads without createdAt made all 1,817 Sodexo contacts invisible on /contacts"
- [pii csvs at repo root](feedback_pii_csvs_at_repo_root.md) — select.CSV and events.CSV live at the repo root and contain SSN-last-4, phone, email — gitignore must exclude *.CSV; the project's .cursorrules requires redacting sensitive data
- [react google maps prop churn](feedback_react_google_maps_prop_churn.md) — "@react-google-maps/api Autocomplete: ALL props must be identity-stable — inline options/handlers cause setOptions churn that deadens the suggestion dropdown on busy pages"
- [rrv7 transition starvation](feedback_rrv7_transition_starvation.md) — "Frozen navigation ROOT CAUSE FOUND: identity-unstable effect loops in RecruiterJobOrders restarted RRv7's navigation transition forever; fix = memoized filter + stable id-key deps + no-op state writes (a6684083); NavigationWatchdog stays as belt-and-braces"
- [scoped functions deploy](feedback_scoped_functions_deploy.md) — "Never run a bare `firebase deploy --only functions` (all functions) in this repo — always deploy an explicit, named list of just the changed/new functions."
- [shared mirror](feedback_shared_mirror.md) — The repo keeps two copies of the shared/ tree because CRA's ModuleScopePlugin blocks ../shared imports from src/ — any edit to one must be mirrored to the other in the same commit
- [swr dep effect refetch amplification](feedback_swr_dep_effect_refetch_amplification.md) — SWR cache hooks (useTenantWorkerDirectory etc.) as effect deps re-fire fetch effects 3-5x per page view; cancel-flag pattern makes each re-fire cancel+restart expensive server scans — dedup by filter key + monotonic run id instead
- [tenantids map creation paths](feedback_tenantids_map_creation_paths.md) — "Every users/{uid} creation path MUST write tenantIds.{T}={securityLevel,role,addedAt}; shared/tenantMembership.ts is canonical; legacy top-level tenantId+securityLevel alone = invisible user"
- [undefined stripper timestamp footgun](feedback_undefined_stripper_timestamp_footgun.md) — "Object.entries-based undefined-strippers collapse Date/FieldValue/Timestamp into plain maps — corrupted 180/268 job_orders createdAt to {} in prod; use stripUndefinedDeep or a plain-object prototype guard"

## Reference

- [team claude setup](team_claude_setup.md) — how a teammate gets a fully-context-loaded Claude (individual plans, repo-resident brain; no Team workspace needed)


- [canonical docs](reference_canonical_docs.md) — Pointers to the load-bearing design docs in this repo — read these before touching the corresponding subsystems
- [everee environments and submit](reference_everee_environments_and_submit.md) — "Everee sandbox vs prod token model, where creds live, and how the CSV importer submits (P4 = contractor payables)"
- [scratch scripts workflow](reference_scratch_scripts_workflow.md) — Operational scripts (migrations, backfills, one-shot sends) live in functions/.scratch/, are gitignored, and run locally with npx ts-node — the directory's tsconfig.json already includes ../shared for cross-imports
- [tenant entity ids](reference_tenant_entity_ids.md) — Hardcoded production constants for the C1 Staffing tenant and its hiring entities — referenced in scripts, suppression logic, Everee routing, and deep links
