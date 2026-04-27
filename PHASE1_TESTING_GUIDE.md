# Phase 1 Testing Guide - SMS Messaging System

## 🎯 Testing Overview

This guide walks you through testing all Phase 1 functionality: template management, recruiter numbers, and automated SMS triggers.

---

## Prerequisites

1. **Firebase Functions Deployed** ✅ (Already done)
2. **Twilio Secrets Configured:**
   ```bash
   firebase functions:secrets:set TWILIO_ACCOUNT_SID
   firebase functions:secrets:set TWILIO_AUTH_TOKEN
   firebase functions:secrets:set TWILIO_VERIFY_SERVICE_SID
   firebase functions:secrets:set TWILIO_MESSAGING_PHONE_NUMBER
   ```
3. **User Access:** You need admin access (security level 5+) to test Settings > Messaging
4. **Test Phone Number:** Have a verified phone number ready to receive test SMS

---

## Test 1: SMS Template Management UI

### 1.1 Access the Messaging Tab
- [ ] Navigate to **Settings** (top menu)
- [ ] Click on **Messaging** tab
- [ ] Verify you see two sub-tabs: "SMS Templates" and "Recruiter Numbers"

### 1.2 Create Your First Template
- [ ] Click **"Create Template"** button
- [ ] Fill in the form:
  - **Name:** "Application Received - Screened"
  - **Category:** Application
  - **Trigger Type:** Application Status Change
  - **Trigger Status:** `screened`
  - **Message Template:** 
    ```
    Hi {firstName}. Thank you for applying to be a {jobTitle} in {locationCity}. We are currently reviewing applicants and will be in touch soon.
    ```
  - **Enabled:** ✓ (checked)
- [ ] Verify **Preview** shows sample text with placeholder values filled in
- [ ] Click **"Create"**
- [ ] Verify success message appears
- [ ] Verify template appears in the table

### 1.3 Test Template Preview
- [ ] Click the **Preview icon** (eye) on any template
- [ ] Verify preview shows the template with sample data
- [ ] Verify variables like `{firstName}`, `{jobTitle}` are replaced with sample values

### 1.4 Edit Template
- [ ] Click **Edit icon** on a template
- [ ] Modify the message template
- [ ] Verify preview updates in real-time
- [ ] Click **"Update"**
- [ ] Verify changes are saved

### 1.5 Enable/Disable Template
- [ ] Toggle the **Switch** on any template
- [ ] Verify template status changes immediately
- [ ] Disabled templates should NOT be used by triggers

### 1.6 Delete Template
- [ ] Click **Delete icon** on a template
- [ ] Confirm deletion in dialog
- [ ] Verify template is removed from table

### 1.7 Create Multiple Templates
Create templates for different scenarios:
- [ ] Application status: "advanced" (interview scheduled)
- [ ] Application status: "hired" (job offer)
- [ ] Application status: "rejected" (application declined)
- [ ] Assignment created (different category)
- [ ] Shift created (different category)

---

## Test 2: Recruiter Number Management

### 2.1 View Available Numbers
- [ ] Navigate to **Messaging** > **Recruiter Numbers** tab
- [ ] Click **"Assign Number"**
- [ ] In the dialog, verify **Available Numbers** dropdown shows Twilio numbers
- [ ] If no numbers available, you'll need to purchase numbers in Twilio console

### 2.2 Assign Number to Recruiter
- [ ] Click **"Assign Number"**
- [ ] Select a recruiter from dropdown (security level 5+)
- [ ] Select a phone number (or choose "Use Main Number")
- [ ] Click **"Assign"**
- [ ] Verify assignment appears in the table
- [ ] Verify number shows correctly

### 2.3 Test "Use Main Number" Option
- [ ] Assign a recruiter with "Use Main Number" option
- [ ] Verify this shows in the table as "Main Number"
- [ ] This recruiter will use the tenant's main Twilio number

### 2.4 Release Number
- [ ] Click **Release** button on any assignment
- [ ] Confirm release
- [ ] Verify assignment is removed from table
- [ ] Verify number becomes available again

---

## Test 3: Application Status Change SMS Trigger

### 3.1 Prepare Test Data
- [ ] Create or find a test user with:
  - Verified phone number (`phoneE164` and `phoneVerified: true`)
  - SMS opt-in enabled (`smsOptIn: true` or `notificationSettings.sms.enabled: true`)
- [ ] Create or find an application for that user
- [ ] Note the application ID and current status

### 3.2 Test Template-Based SMS
1. **Create matching template:**
   - [ ] Create template with:
     - Category: `application`
     - Trigger Type: `applicationStatusChange`
     - Trigger Status: `screened`
     - Enabled: `true`

2. **Trigger status change:**
   - [ ] Update application status to `screened` (in application UI or Firestore)
   - [ ] Wait 10-30 seconds for trigger to fire
   - [ ] Check your phone - should receive SMS with template content
   - [ ] Verify variables (firstName, jobTitle, etc.) are filled correctly

### 3.3 Test Default Message Fallback
1. **Disable or delete template:**
   - [ ] Disable the template OR change triggerStatus to something else

2. **Trigger status change:**
   - [ ] Update application status to `screened`
   - [ ] Wait 10-30 seconds
   - [ ] Check phone - should receive default hardcoded message
   - [ ] Default message should still have basic info

### 3.4 Test Different Statuses
Test with different application statuses:
- [ ] `screened` - Initial screening
- [ ] `advanced` - Advanced to next stage
- [ ] `interview` - Interview scheduled
- [ ] `offer` - Job offer made
- [ ] `hired` - Application accepted
- [ ] `rejected` - Application rejected

For each:
- [ ] Create matching template (optional)
- [ ] Change application status
- [ ] Verify SMS received
- [ ] Verify correct template or default used

---

## Test 4: Notification Settings

### 4.1 Test SMS Opt-Out
- [ ] Update user's `smsOptIn` to `false` (or `notificationSettings.sms.enabled: false`)
- [ ] Trigger application status change
- [ ] Verify NO SMS is sent
- [ ] Check function logs for "SMS opt-out" message

### 4.2 Test Per-Type Settings
- [ ] Set `notificationSettings.sms.applicationUpdates: false`
- [ ] Keep `smsOptIn: true`
- [ ] Trigger application status change
- [ ] Verify NO SMS is sent (even though global SMS is enabled)

### 4.3 Test Re-Enable
- [ ] Re-enable SMS settings
- [ ] Trigger status change again
- [ ] Verify SMS is now sent

---

## Test 5: Assignment and Shift Triggers

### 5.1 Assignment Created SMS
- [ ] Create a new assignment for a worker
- [ ] Verify worker receives SMS with assignment details:
  - Job title
  - Date and time
  - Location (if applicable)
  - Link to details

### 5.2 Shift Created SMS
- [ ] Create a new shift
- [ ] Verify assigned workers receive SMS notification
- [ ] Verify shift details are included

### 5.3 Shift Updated SMS
- [ ] Update an existing shift (time, date, location)
- [ ] Verify workers receive update SMS

### 5.4 Shift Deleted SMS
- [ ] Delete a shift
- [ ] Verify workers receive cancellation SMS

---

## Test 6: Error Handling

### 6.1 Invalid Phone Number
- [ ] Create user with invalid phone number format
- [ ] Trigger SMS
- [ ] Verify error is logged but doesn't crash function
- [ ] Verify other users still receive SMS

### 6.2 Missing User Data
- [ ] Create application with missing user data
- [ ] Trigger status change
- [ ] Verify function handles gracefully
- [ ] Verify error is logged

### 6.3 Template Resolution Errors
- [ ] Create template with invalid variable syntax
- [ ] Trigger SMS with that template
- [ ] Verify fallback to default message
- [ ] Verify error is logged

---

## Test 7: Firestore Verification

### 7.1 Verify Template Storage
- [ ] Check Firestore: `tenants/{tenantId}/smsTemplates/{templateId}`
- [ ] Verify all template fields are stored correctly
- [ ] Verify `variables` array is auto-populated
- [ ] Verify timestamps are set

### 7.2 Verify SMS Audit Logs
- [ ] Check Firestore: `tenants/{tenantId}/sms_messages` collection
- [ ] After sending SMS, verify log entry created:
  - `to` (phone number)
  - `message` (sent message)
  - `status` (success/failed)
  - `timestamp`
  - `source`, `sourceId` (for tracking)

### 7.3 Verify Recruiter Numbers
- [ ] Check Firestore: `tenants/{tenantId}/recruiterNumbers/{recruiterId}`
- [ ] Verify assignment data is stored correctly
- [ ] Verify webhook URL is set in Twilio (if applicable)

---

## Common Issues & Troubleshooting

### Issue: Templates not loading
- **Check:** Browser console for errors
- **Check:** Firebase Functions logs
- **Fix:** Verify `getSmsTemplates` function is deployed and accessible

### Issue: SMS not sending
- **Check:** Twilio secrets are configured correctly
- **Check:** Phone number is verified (`phoneE164` and `phoneVerified`)
- **Check:** User has `smsOptIn: true` or `notificationSettings.sms.enabled: true`
- **Check:** Firebase Functions logs for errors
- **Check:** Twilio console for delivery status

### Issue: Template variables not resolving
- **Check:** Variable names match exactly (case-sensitive)
- **Check:** User/job data exists in Firestore
- **Check:** Function logs for variable resolution errors
- **Fix:** Verify template uses correct variable names from supported list

### Issue: Recruiter Numbers not showing
- **Check:** You have Twilio numbers in your account
- **Check:** `getAvailableTwilioNumbers` function is working
- **Check:** Firebase Functions logs for errors
- **Fix:** Purchase numbers in Twilio console if needed

### Issue: Triggers not firing
- **Check:** Function logs in Firebase Console
- **Check:** Trigger function is deployed (`onApplicationStatusChanged`, etc.)
- **Check:** Firestore trigger permissions
- **Fix:** Verify function deployment and permissions

---

## Success Criteria

✅ **Template Management:**
- Can create, edit, delete templates
- Preview works with sample data
- Templates stored in Firestore correctly

✅ **Recruiter Numbers:**
- Can assign/release numbers
- Numbers show in UI
- Assignments stored correctly

✅ **Automated SMS:**
- Application status changes trigger SMS
- Templates are used when available
- Default messages work as fallback
- Notification settings are respected

✅ **Error Handling:**
- Invalid data doesn't crash functions
- Errors are logged properly
- Users without opt-in don't receive SMS

---

## Next Steps After Testing

Once Phase 1 testing is complete:
1. ✅ Fix any bugs found
2. ✅ Document any issues
3. 🚀 Proceed to Phase 2: Bulk & Direct Messaging

---

## Testing Checklist Summary

- [ ] Template CRUD operations
- [ ] Template preview functionality
- [ ] Recruiter number assignment
- [ ] Application status change SMS (with template)
- [ ] Application status change SMS (default fallback)
- [ ] Assignment created SMS
- [ ] Shift created/updated/deleted SMS
- [ ] Notification settings (opt-out)
- [ ] Error handling
- [ ] Firestore data verification

**Total Tests:** ~30+
**Estimated Time:** 30-60 minutes

