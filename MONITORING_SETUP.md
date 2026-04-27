# Cloud Logging & BigQuery Monitoring Setup

This guide covers setting up comprehensive monitoring and cost tracking for Firebase Functions.

## 📊 Phase 2: Cloud Logging Metrics

### 1. Enable Cloud Logging API
```bash
gcloud services enable logging.googleapis.com --project=hrx1-d3beb
```

### 2. Create Log-Based Metrics

#### Function Execution Count
```bash
gcloud logging metrics create function_execution_count \
  --description="Count of function executions" \
  --log-filter='resource.type="cloud_function"
    AND jsonPayload.message="Function execution completed"' \
  --value-extractor='EXTRACT(jsonPayload.functionName)' \
  --metric-kind=DELTA \
  --value-type=INT64
```

#### Cold Start Frequency
```bash
gcloud logging metrics create function_cold_starts \
  --description="Count of cold starts" \
  --log-filter='resource.type="cloud_function"
    AND textPayload=~".*cold start.*"' \
  --metric-kind=DELTA \
  --value-type=INT64
```

#### Error Rate
```bash
gcloud logging metrics create function_error_rate \
  --description="Function error rate" \
  --log-filter='resource.type="cloud_function"
    AND severity>=ERROR' \
  --metric-kind=DELTA \
  --value-type=INT64
```

#### Function Duration (Latency)
```bash
gcloud logging metrics create function_duration_ms \
  --description="Function execution duration in milliseconds" \
  --log-filter='resource.type="cloud_function"
    AND jsonPayload.metrics.durationMs>0' \
  --value-extractor='EXTRACT(jsonPayload.metrics.durationMs)' \
  --metric-kind=GAUGE \
  --value-type=INT64
```

### 3. Create Custom Dashboards

Navigate to [Cloud Monitoring Dashboards](https://console.cloud.google.com/monitoring/dashboards?project=hrx1-d3beb)

Create a new dashboard with:
- **Function Invocations** (Time series chart, grouped by function_name)
- **Error Rate %** (Scorecard showing errors/total)
- **Cold Start %** (Gauge chart)
- **Average Duration** (Heatmap by function)
- **Cost Estimates** (from Firestore metrics_rollups)

### 4. Set Up Alerts

#### High Error Rate Alert
```bash
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="High Function Error Rate" \
  --condition-display-name="Error rate > 5%" \
  --condition-threshold-value=0.05 \
  --condition-threshold-duration=300s \
  --condition-filter='metric.type="logging.googleapis.com/user/function_error_rate"
    resource.type="cloud_function"'
```

#### Cost Spike Alert
```bash
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="Function Cost Spike" \
  --condition-display-name="Estimated daily cost > $50" \
  --condition-threshold-value=50.0 \
  --condition-threshold-duration=3600s \
  --condition-filter='metric.type="firestore.googleapis.com/document/read_count"
    resource.type="firestore_instance"'
```

## 💰 BigQuery Billing Export

### 1. Enable BigQuery Data Transfer Service
```bash
gcloud services enable bigquerydatatransfer.googleapis.com --project=hrx1-d3beb
```

### 2. Set Up Billing Export

1. Navigate to [Billing Export Settings](https://console.cloud.google.com/billing/export?project=hrx1-d3beb)
2. Enable **Detailed usage cost** export
3. Set dataset: `billing_export`
4. Enable **Pricing** data export

### 3. Create Cost Analysis Views

```sql
-- Daily function costs by SKU
CREATE OR REPLACE VIEW `hrx1-d3beb.billing_export.daily_function_costs` AS
SELECT
  DATE(usage_start_time) as date,
  service.description as service_name,
  sku.description as sku_description,
  REGEXP_EXTRACT(labels.value, r'functions/([^/]+)') as function_name,
  SUM(cost) as total_cost_usd,
  SUM(usage.amount) as usage_amount,
  usage.unit as usage_unit
FROM `hrx1-d3beb.billing_export.gcp_billing_export_v1_*`
CROSS JOIN UNNEST(labels) as labels
WHERE service.description = 'Cloud Functions'
  AND labels.key = 'resource_name'
GROUP BY date, service_name, sku_description, function_name, usage_unit
ORDER BY date DESC, total_cost_usd DESC;

-- Top 10 most expensive functions this month
CREATE OR REPLACE VIEW `hrx1-d3beb.billing_export.top_functions_this_month` AS
SELECT
  REGEXP_EXTRACT(labels.value, r'functions/([^/]+)') as function_name,
  SUM(cost) as total_cost_usd,
  COUNT(*) as invocation_count
FROM `hrx1-d3beb.billing_export.gcp_billing_export_v1_*`
CROSS JOIN UNNEST(labels) as labels
WHERE service.description = 'Cloud Functions'
  AND labels.key = 'resource_name'
  AND DATE(usage_start_time) >= DATE_TRUNC(CURRENT_DATE(), MONTH)
GROUP BY function_name
ORDER BY total_cost_usd DESC
LIMIT 10;

-- Cost trend over last 30 days
CREATE OR REPLACE VIEW `hrx1-d3beb.billing_export.function_cost_trend_30d` AS
SELECT
  DATE(usage_start_time) as date,
  SUM(cost) as daily_cost_usd,
  COUNT(DISTINCT REGEXP_EXTRACT(labels.value, r'functions/([^/]+)')) as unique_functions
FROM `hrx1-d3beb.billing_export.gcp_billing_export_v1_*`
CROSS JOIN UNNEST(labels) as labels
WHERE service.description = 'Cloud Functions'
  AND labels.key = 'resource_name'
  AND DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY date
ORDER BY date DESC;
```

### 4. Schedule Daily Rollups

Create a scheduled query to populate the `metrics_rollups` collection:

```typescript
// Already implemented in functions/src/utils/metricsLogger.ts
import { createDailyRollup } from './utils/metricsLogger';

// Run via Cloud Scheduler
export const scheduledMetricsRollup = onSchedule({
  schedule: 'every day 02:00',
  timeZone: 'America/New_York'
}, async () => {
  const yesterday = new Date(Date.now() - 86400000);
  await createDailyRollup(yesterday);
});
```

## 🔍 Useful Queries

### Find Functions with High Cold Start Rate
```sql
SELECT
  function_name,
  cold_starts,
  total_executions,
  ROUND((cold_starts / total_executions) * 100, 2) as cold_start_percentage
FROM (
  SELECT
    REGEXP_EXTRACT(resource.labels.function_name, r'([^/]+)$') as function_name,
    COUNTIF(textPayload LIKE '%cold start%') as cold_starts,
    COUNT(*) as total_executions
  FROM `hrx1-d3beb.logs.cloudaudit_googleapis_com_activity`
  WHERE resource.type = 'cloud_function'
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  GROUP BY function_name
)
WHERE cold_start_percentage > 10
ORDER BY cold_start_percentage DESC;
```

### Find Most Expensive Firestore Operations
```sql
SELECT
  DATE(usage_start_time) as date,
  sku.description as operation_type,
  SUM(cost) as total_cost_usd,
  SUM(usage.amount) as operation_count
FROM `hrx1-d3beb.billing_export.gcp_billing_export_v1_*`
WHERE service.description = 'Cloud Firestore'
  AND DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
GROUP BY date, operation_type
ORDER BY date DESC, total_cost_usd DESC;
```

## 📈 Monitoring Best Practices

1. **Set Budget Alerts**: Configure billing alerts at $100, $250, $500 thresholds
2. **Review Weekly**: Check top 10 most expensive functions every Monday
3. **Track Cold Starts**: Keep cold start rate < 20% for critical functions
4. **Monitor Error Rates**: Investigate if any function exceeds 2% error rate
5. **Log Sampling**: Use structured logging with appropriate severity levels
6. **Cost Attribution**: Tag functions with `cost_center` labels for departmental tracking

## 🚨 Emergency Procedures

If costs spike unexpectedly:

1. **Immediate**: Disable high-volume triggers using `ENABLE_*` flags
2. **Review**: Check `metrics_rollups` collection for recent anomalies
3. **Investigate**: Query BigQuery for top cost drivers
4. **Rollback**: Revert recent deployments if necessary
5. **Optimize**: Apply hardening patterns to affected functions

## 📚 Resources

- [Cloud Logging Documentation](https://cloud.google.com/logging/docs)
- [Cloud Monitoring Dashboards](https://console.cloud.google.com/monitoring/dashboards?project=hrx1-d3beb)
- [BigQuery Billing Export](https://cloud.google.com/billing/docs/how-to/export-data-bigquery)
- [Function Metrics](https://console.firebase.google.com/project/hrx1-d3beb/firestore/data/~2Fmetrics_rollups)

