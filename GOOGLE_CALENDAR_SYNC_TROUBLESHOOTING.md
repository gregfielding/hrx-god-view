# 🔍 Google Calendar Sync Troubleshooting Guide

## Overview
This guide helps diagnose and fix issues with Google Calendar sync for tasks and appointments in the HRX system.

## 🚨 Common Issues & Solutions

### 1. **"Google Calendar not connected" Error**

**Symptoms:**
- Tasks with `classification: 'appointment'` are not syncing to Google Calendar
- Error message: "Google Calendar not connected. Please authenticate first."

**Root Causes:**
- User hasn't completed Google Calendar OAuth flow
- Calendar tokens are missing or expired
- OAuth configuration is incorrect

**Solutions:**

#### A. Check User Authentication Status
```javascript
// Run diagnostic script
node debugCalendarSync.js
```

#### B. Verify OAuth Configuration
1. Check Firebase environment variables:
   ```bash
   firebase functions:config:get
   ```

2. Ensure these variables are set:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET` 
   - `GOOGLE_REDIRECT_URI`

3. Verify Google Cloud Console settings:
   - OAuth 2.0 client ID is configured
   - Redirect URI matches your Firebase function URL
   - Calendar API is enabled

#### C. Re-authenticate User
1. Navigate to Calendar Management in the app
2. Click "Connect Google Calendar"
3. Complete the OAuth flow
4. Verify tokens are stored in user document

### 2. **"Token expired" Error**

**Symptoms:**
- Calendar sync worked before but now fails
- Error message: "Calendar authentication expired"

**Solution:**
The system now automatically refreshes expired tokens. If manual refresh is needed:

```javascript
// Check token expiry
const userDoc = await db.collection('users').doc(userId).get();
const userData = userDoc.data();
const tokenExpiry = userData.calendarTokens?.expiry_date;

if (tokenExpiry && new Date(tokenExpiry) <= new Date()) {
  // Token is expired, user needs to re-authenticate
  console.log('Token expired, re-authentication required');
}
```

### 3. **Tasks Not Syncing Despite Correct Classification**

**Symptoms:**
- Tasks with `classification: 'appointment'` are created but not synced
- No calendar events appear in Google Calendar

**Root Causes:**
- Missing required fields (`startTime`, `duration`)
- Task creation flow not triggering sync
- Sync function errors

**Solutions:**

#### A. Verify Task Data Structure
Ensure appointment tasks have:
```javascript
{
  classification: 'appointment',
  startTime: '2024-01-15T10:00:00.000Z', // Required for appointments
  duration: 60, // Required for appointments (in minutes)
  title: 'Meeting Title',
  // ... other fields
}
```

#### B. Check Task Creation Flow
1. Verify `CreateTaskDialog` sets correct fields
2. Ensure `taskEngine.ts` calls `syncTaskToCalendar`
3. Check for sync errors in Firebase logs

#### C. Manual Sync Test
```javascript
// Test sync manually
node testCalendarSync.js
```

### 4. **OAuth Configuration Inconsistencies**

**Symptoms:**
- Authentication works in some parts but not others
- Inconsistent error messages

**Root Cause:**
Different files use different OAuth configuration methods:
- `calendarSyncService.ts` uses `defineString()`
- Some files use `process.env`

**Solution:**
All OAuth configurations now use consistent `defineString()` method.

### 5. **Environment Variable Issues**

**Symptoms:**
- OAuth client creation fails
- "Invalid client" errors

**Solutions:**

#### A. Check Firebase Config
```bash
# View current config
firebase functions:config:get

# Set config if missing
firebase functions:config:set google.client_id="YOUR_CLIENT_ID"
firebase functions:config:set google.client_secret="YOUR_CLIENT_SECRET"
firebase functions:config:set google.redirect_uri="YOUR_REDIRECT_URI"
```

#### B. Verify Google Cloud Console
1. Go to Google Cloud Console
2. Navigate to APIs & Services > Credentials
3. Verify OAuth 2.0 client ID settings
4. Ensure Calendar API is enabled

## 🔧 Diagnostic Tools

### 1. **Debug Script**
```bash
node debugCalendarSync.js
```
This script checks:
- Environment variables
- User calendar tokens
- Recent appointment tasks
- OAuth client setup
- Sync errors

### 2. **Test Script**
```bash
node testCalendarSync.js
```
This script:
- Creates a test appointment task
- Attempts calendar sync
- Verifies calendar event creation
- Cleans up test data

### 3. **Firebase Logs**
```bash
firebase functions:log --only calendarSyncService
```

## 📋 Troubleshooting Checklist

### For Users:
- [ ] Completed Google Calendar OAuth flow
- [ ] Calendar shows as "Connected" in app
- [ ] Creating tasks with `classification: 'appointment'`
- [ ] Tasks have `startTime` and `duration` fields

### For Developers:
- [ ] Environment variables configured
- [ ] Google Cloud Console settings correct
- [ ] Calendar API enabled
- [ ] OAuth redirect URI matches
- [ ] Firebase functions deployed
- [ ] No sync errors in logs

### For System:
- [ ] User has valid calendar tokens
- [ ] Tokens not expired
- [ ] Task data structure correct
- [ ] Sync function executing
- [ ] Calendar API responding

## 🚀 Quick Fixes

### 1. **Reset User Calendar Connection**
```javascript
// Clear user's calendar tokens
await db.collection('users').doc(userId).update({
  calendarTokens: null,
  calendarConnected: false
});
// User will need to re-authenticate
```

### 2. **Force Sync Existing Tasks**
```javascript
// Manually trigger sync for existing tasks
const tasks = await db.collectionGroup('tasks')
  .where('classification', '==', 'appointment')
  .where('syncStatus', '!=', 'synced')
  .get();

for (const task of tasks.docs) {
  await syncTaskToCalendar(
    task.data().assignedTo,
    task.data().tenantId,
    task.id,
    task.data()
  );
}
```

### 3. **Update Environment Variables**
```bash
firebase functions:config:set google.client_id="NEW_CLIENT_ID"
firebase functions:config:set google.client_secret="NEW_CLIENT_SECRET"
firebase deploy --only functions
```

## 📞 Support

If issues persist after following this guide:

1. Run diagnostic scripts and share output
2. Check Firebase function logs
3. Verify Google Cloud Console settings
4. Test with a fresh user account
5. Contact development team with detailed error logs

## 🔄 Recent Fixes Applied

1. **OAuth Configuration Consistency**: All files now use `defineString()` for OAuth config
2. **Token Refresh**: Automatic token refresh when expired
3. **Better Error Handling**: More detailed error messages and logging
4. **Sync Status Tracking**: Tasks now track sync status and last sync time
5. **Diagnostic Tools**: Added comprehensive debugging scripts
