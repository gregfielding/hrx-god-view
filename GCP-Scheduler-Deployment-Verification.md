# Deployment & Verification Instructions for Hardened Schedulers

**Owner:** Platform/Infra  
**Audience:** Cursor (code-first)  
**Context:** After adding `setGlobalOptions`, kill-switch env flags, and helper libs, these steps finalize safe deployment and cost verification.

---

## 1) Environment Setup (Kill Switches)

### Firebase CLI Deployment (Functions v2)
Use `.env` files:

```
functions/
  .env
  .env.production
  .env.staging
```

Example `.env.production` (enable only what you truly need):

```env
ENABLE_SCHEDULED_CHECKINS=false
ENABLE_SCHEDULED_TESTS=false
ENABLE_EXECUTE_CAMPAIGNS=true
ENABLE_GMAIL_MONITORING=true
ENABLE_WEEKLY_ENRICHMENT=false
ENABLE_ASSOCIATIONS_INTEGRITY=true
```

Example `.env.staging`:

```env
ENABLE_SCHEDULED_CHECKINS=false
ENABLE_SCHEDULED_TESTS=false
ENABLE_EXECUTE_CAMPAIGNS=false
ENABLE_GMAIL_MONITORING=false
ENABLE_WEEKLY_ENRICHMENT=false
ENABLE_ASSOCIATIONS_INTEGRITY=false
```

Deploy:
```bash
firebase deploy --only functions --project <prod|staging>
```

### gcloud Deployment (Gen2)
```bash
gcloud functions deploy executePendingCampaigns \
  --gen2 --region=us-central1 \
  --set-env-vars=ENABLE_EXECUTE_CAMPAIGNS=true
```

---

## 2) Verification Runbook

### A) Confirm schedulers gated by env flags
```bash
gcloud logging read \
'resource.type="cloud_function" AND jsonPayload.job="associationsIntegrityNightly" AND jsonPayload.event="job_summary"' \
--limit=20 --freshness=2d --format="value(jsonPayload)"
```

Expect **no executions** (or “disabled by flag”) if flag is false.

### B) Confirm singleton & bounded runs
```bash
gcloud logging read \
'resource.type="cloud_function" AND jsonPayload.event="job_summary"' \
--limit=50 --freshness=2d --format="json"
```

Check: `duration_ms` stable, `processed` counts bounded, no concurrent runs.

### C) Check Cloud Scheduler (if still used)
```bash
gcloud scheduler jobs list --location=us-central1 --format='table(name, schedule, state, lastAttemptTime)'
```

Pause unneeded:
```bash
gcloud scheduler jobs pause JOB_NAME --location=us-central1
```

### D) BigQuery Billing Export (optional but recommended)
Enable in **Billing → Cost & Usage → Data Export → BigQuery**.

Sample SKU query:
```sql
SELECT sku.description, SUM(cost) AS cost_usd
FROM `YOUR_DATASET.gcp_billing_export_v1_*`
WHERE service.description = 'App Engine'
  AND usage_start_time >= '2025-10-01'
GROUP BY 1 ORDER BY cost_usd DESC;
```

---

## 3) Frequency Adjustments (Cursor PR)

- **associationsIntegrityNightly** → keep nightly 02:00.  
- **executePendingCampaigns** → every 2–4h (not hourly).  
- **scheduledGmailMonitoring** → every 2h.  
- **scheduled tests/check-ins** → daily/weekly only, default off.  
- **weekly enrichment** → weekly only.

Cursor should propose cron changes and note rationale in PR descriptions.

---

## 4) Guardrails & Savings Persistence

- **Logging retention**: 30 days
  ```bash
  gcloud logging buckets update _Default --location=global --retention-days=30
  ```
- **Budgets**: Alerts on App Engine service at 25/50/75/100% spend.
- **IAM**: Remove `App Engine Deployer/Admin` in prod unless required.
- **Lifecycle**: Apply 30–60 day lifecycle rules only to backup prefixes.

---

## 5) Optional Enhancements

- Add structured **disabled_flag** logs:
```ts
if (!ENABLE_ASSOCIATIONS_INTEGRITY) {
  console.info(JSON.stringify({
    event: "job_summary", job: "associationsIntegrityNightly",
    success: false, reason: "disabled_flag"
  }));
  return;
}
```

- Emit **unique run IDs** in logs for correlation.  
- Centralize scheduler config in `schedulerConfig.ts` (timeouts, page size, etc).

Example:
```ts
export const schedulerConfig = {
  associationsIntegrityNightly: { pageSize: 500, timeoutSeconds: 300 },
  executePendingCampaigns:     { pageSize: 200, timeoutSeconds: 180 },
  scheduledGmailMonitoring:    { pageSize: 200, timeoutSeconds: 120 }
} as const;
```

---

## 6) Checklist

- [ ] `.env.production` and `.env.staging` created with correct flags.  
- [ ] Deploy with correct env.  
- [ ] Verify logs → disabled jobs silent, enabled jobs bounded.  
- [ ] Adjust cron schedules.  
- [ ] Set Logging retention to 30 days.  
- [ ] (Optional) Enable Billing→BigQuery export.  

---
