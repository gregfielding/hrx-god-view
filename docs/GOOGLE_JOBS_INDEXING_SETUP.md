# Google Jobs Indexing API Setup Guide

This guide explains how to set up automatic job posting submission to Google for Jobs using the Google Indexing API.

---

## Benefits

- **Immediate Indexing**: Jobs appear in Google Search within hours instead of days/weeks
- **Automatic Updates**: Jobs automatically submitted when posted
- **Better Visibility**: Jobs show in Google's job search widget
- **Direct Apply**: Applicants can apply directly from Google Search

---

## Prerequisites

1. Google Cloud Project (already created: hrx1-d3beb)
2. Firebase project with Cloud Functions enabled
3. Verified domain in Google Search Console (hrxone.com)

---

## Step-by-Step Setup

### 1. Enable Google Indexing API

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/library/indexing.googleapis.com?project=hrx1-d3beb)
2. Click **"Enable"** for the Indexing API
3. Wait for API to be enabled (usually instant)

### 2. Create Service Account

1. Navigate to [IAM & Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=hrx1-d3beb)
2. Click **"Create Service Account"**
3. Name: `google-indexing-api`
4. Description: "Service account for Google Indexing API"
5. Click **"Create and Continue"**
6. Grant role: **"Service Account User"** (optional, can skip)
7. Click **"Done"**

### 3. Create Service Account Key

1. Find your new service account in the list
2. Click the **three dots** → **"Manage keys"**
3. Click **"Add Key"** → **"Create new key"**
4. Choose **JSON** format
5. Click **"Create"**
6. Save the downloaded file as `service-account-key.json`

**IMPORTANT**: 
- Store this file securely
- DO NOT commit to Git
- Add to `.gitignore`: `service-account-key.json`

### 4. Add Service Account to Search Console

1. Copy the service account email from the JSON file  
   (e.g., `google-indexing-api@hrx1-d3beb.iam.gserviceaccount.com`)
2. Go to [Google Search Console](https://search.google.com/search-console)
3. Select your property (hrxone.com)
4. Go to **Settings** → **Users and permissions**
5. Click **"Add user"**
6. Paste the service account email
7. Set permission to **"Owner"**
8. Click **"Add"**

### 5. Install the Service Account Key

**Option A: For Cloud Functions (Recommended)**
```bash
# Place the key file in the functions directory
cp service-account-key.json functions/
```

**Option B: For Local Development**
```bash
# Store as environment variable
export GOOGLE_APPLICATION_CREDENTIALS="./service-account-key.json"
```

### 6. Install Required npm Package

```bash
cd functions
npm install googleapis
cd ..
```

### 7. Update functions/src/index.ts

Add the new indexing functions to your functions exports:

```typescript
// Import the indexing functions
export { 
  notifyGoogleJobsIndexing, 
  requestJobIndexing, 
  batchSubmitJobsToGoogle 
} from './notifyGoogleJobsIndexing';
```

### 8. Deploy the Functions

```bash
# Deploy only the new indexing functions
firebase deploy --only functions:notifyGoogleJobsIndexing,functions:requestJobIndexing,functions:batchSubmitJobsToGoogle
```

---

## How It Works

### Automatic Indexing (Recommended)

Once deployed, the `notifyGoogleJobsIndexing` function automatically triggers when:
- A new job posting is created
- An existing job posting is updated

The function:
1. Checks if job is active and public
2. Constructs the job URL
3. Notifies Google via Indexing API
4. Logs success/failure

**No manual intervention needed!**

### Manual Indexing (On-Demand)

You can manually request indexing for a specific job:

```javascript
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();
const requestIndexing = httpsCallable(functions, 'requestJobIndexing');

const result = await requestIndexing({ 
  tenantId: 'BCiP2bQ9CgVOCTfV6MhD', 
  postId: 'IrjoUTzuJg0pzt6FOEik' 
});

console.log('Indexing requested:', result.data);
```

### Batch Indexing (Initial Setup)

To submit all existing jobs at once:

```javascript
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();
const batchSubmit = httpsCallable(functions, 'batchSubmitJobsToGoogle');

const result = await batchSubmit({ 
  tenantId: 'BCiP2bQ9CgVOCTfV6MhD'
});

console.log(`Submitted ${result.data.successful}/${result.data.total} jobs`);
```

---

## Testing

### 1. Test Structured Data

Use Google's Rich Results Test:
```
https://search.google.com/test/rich-results?url=https://hrxone.com/c1/jobs/IrjoUTzuJg0pzt6FOEik
```

Should show:
- ✅ JobPosting detected
- ✅ All required fields present
- ✅ No errors

### 2. Test Indexing API Function

Deploy a test job posting and check Firebase Function logs:
```bash
firebase functions:log --only notifyGoogleJobsIndexing
```

Look for:
```
✅ Successfully notified Google Indexing API for job: {postId}
URL: https://hrxone.com/c1/jobs/{postId}
```

### 3. Verify in Search Console

1. Go to Search Console → **Enhancements** → **Job postings**
2. Should start seeing jobs appear within 24-48 hours
3. Check for errors/warnings

---

## Quota Limits

Google Indexing API limits:
- **200 requests per day** (free tier)
- **100 requests per minute**

Our implementation includes:
- Automatic rate limiting (100ms between requests in batch)
- Error handling (won't fail if quota exceeded)
- Logging for monitoring

For higher quotas, request an increase in Google Cloud Console.

---

## Troubleshooting

### Error: "Permission denied"
- **Cause**: Service account not added to Search Console
- **Fix**: Follow Step 4 above

### Error: "API not enabled"
- **Cause**: Indexing API not enabled in Google Cloud
- **Fix**: Follow Step 1 above

### Error: "Invalid credentials"
- **Cause**: Service account key file not found
- **Fix**: Ensure `service-account-key.json` is in `functions/` directory

### Jobs not appearing in Google Search
- **Wait Time**: Can take 24-48 hours even with Indexing API
- **Check**: Verify structured data with Rich Results Test
- **Verify**: Check Search Console for errors

---

## Alternative: Manual Submission

If you don't want to set up Cloud Functions, you can manually submit URLs:

### Using Google Search Console

1. Go to **URL Inspection** tool
2. Enter: `https://hrxone.com/c1/jobs/IrjoUTzuJg0pzt6FOEik`
3. Click **"Request Indexing"**
4. Repeat for each job

### Using cURL (with service account)

```bash
# Get access token
ACCESS_TOKEN=$(gcloud auth application-default print-access-token)

# Submit URL
curl -X POST \
  https://indexing.googleapis.com/v3/urlNotifications:publish \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "url": "https://hrxone.com/c1/jobs/IrjoUTzuJg0pzt6FOEik",
    "type": "URL_UPDATED"
  }'
```

---

## Monitoring

### Check Indexing Status

Use the Indexing API to check status:

```javascript
const getIndexingStatus = httpsCallable(functions, 'getJobIndexingStatus');
const status = await getIndexingStatus({ postId: 'xyz' });
```

### Search Console Dashboard

Monitor in Search Console:
- **Coverage**: See indexed URLs
- **Enhancements → Job postings**: See job-specific metrics
- **Performance**: Track clicks and impressions

---

## Best Practices

1. **Only submit public, active jobs** - Don't waste quota on drafts/expired jobs
2. **Update on changes** - Notify Google when job details change
3. **Remove when deleted** - Use `URL_DELETED` type when job is removed
4. **Monitor quota usage** - Check Cloud Console for API usage
5. **Test before deploying** - Use Rich Results Test to validate schema

---

## Security Notes

**NEVER commit service account keys to Git!**

Add to `.gitignore`:
```
service-account-key.json
functions/service-account-key.json
```

Store keys securely:
- Use Firebase Environment Config for production
- Use Google Secret Manager for sensitive data
- Rotate keys periodically

---

## Resources

- [Google Indexing API Documentation](https://developers.google.com/search/apis/indexing-api/v3/quickstart)
- [JobPosting Schema Reference](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
- [Google for Jobs Guidelines](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
- [Search Console Help](https://support.google.com/webmasters/answer/9012289)

---

## Summary

**Quick Start (5 minutes):**
1. Enable Indexing API in Cloud Console
2. Create service account + download JSON key
3. Add service account to Search Console as Owner
4. Place key in `functions/service-account-key.json`
5. Deploy functions
6. Jobs auto-submit to Google when posted!

**Your jobs will start appearing in Google Search within 24-48 hours.** 🎉

