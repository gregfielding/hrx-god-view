# Testing "Application Created" SMS Trigger

## ✅ Prerequisites Checklist

Before testing, verify these conditions:

### 1. **Function is Deployed** ✅
- Function: `onApplicationCreated`
- Path: `tenants/{tenantId}/applications/{applicationId}`
- Status: ✅ Deployed

### 2. **User Has Verified Phone** ⚠️
The trigger requires:
- `phoneE164` - Phone number in E.164 format (e.g., `+17025550147`)
- `phoneVerified: true` - Phone must be verified

**Check in Firestore:**
```
users/{userId}
  phoneE164: "+17025550147"  ✅ Required
  phoneVerified: true         ✅ Required
```

**If missing:** The trigger will skip SMS and log:
```
"User {userId} has no verified phone, skipping SMS for application {applicationId}"
```

### 3. **Template Exists and is Enabled** ⚠️
**Check in Firestore:**
```
tenants/{tenantId}/smsTemplates/{templateId}
  category: "application"              ✅ Required
  triggerType: "applicationCreated"    ✅ Required
  enabled: true                        ✅ Required
```

**If missing:** Falls back to default message:
```
"Hi {firstName}. Thank you for applying to be a {jobTitle} in {locationCity}. We are currently reviewing applicants and will be in touch soon."
```

### 4. **User Notification Settings** ⚠️
The trigger checks notification settings:
- `smsOptIn: true` OR
- `notificationSettings.sms.enabled: true` AND
- `notificationSettings.sms.applicationUpdates: true`

**Default behavior:** If settings don't exist, defaults to allowing SMS (if `smsOptIn` is true).

---

## 🧪 Testing Steps

### Step 1: Verify Prerequisites

**Check User Phone:**
1. Open Firestore Console
2. Navigate to `users/{yourUserId}`
3. Verify:
   - `phoneE164` exists (format: `+17025550147`)
   - `phoneVerified: true`

**Check Template:**
1. Open Firestore Console
2. Navigate to `tenants/{tenantId}/smsTemplates`
3. Verify you have a template with:
   - `category: "application"`
   - `triggerType: "applicationCreated"`
   - `enabled: true`

**Check Notification Settings:**
1. Navigate to `users/{yourUserId}`
2. Verify `smsOptIn: true` (or notificationSettings exists)

### Step 2: Submit Test Application

1. Navigate to a job posting in your app
2. Fill out and submit an application
3. **Important:** Use the same user account that has the verified phone

### Step 3: Verify Trigger Fired

**Check Function Logs:**
1. Open Firebase Console → Functions → Logs
2. Filter for `onApplicationCreated`
3. Look for log entries:
   - ✅ `"New application created: {applicationId} in tenant {tenantId}"`
   - ✅ `"SMS sent for new application {applicationId} to {phone}"`
   - OR warnings if something failed

**Check SMS Delivery:**
1. Check your phone for the SMS message
2. Should arrive within 10-30 seconds of application submission

**Check Audit Log:**
1. Open Firestore Console
2. Navigate to `tenants/{tenantId}/sms_messages`
3. Look for new document with:
   - `to: "{phoneE164}"`
   - `source: "application_created"`
   - `sourceId: "{applicationId}"`

---

## 🔍 Troubleshooting

### Issue: No SMS Received

**Check 1: Function Logs**
```bash
# Check if trigger fired
firebase functions:log --only onApplicationCreated
```

Look for:
- ✅ "New application created" → Trigger fired
- ⚠️ "has no verified phone" → User missing phone
- ⚠️ "SMS disabled" → Notification settings blocking
- ⚠️ "Failed to send SMS" → Twilio error

**Check 2: Phone Verification**
- User must have `phoneE164` and `phoneVerified: true`
- If missing, trigger will skip SMS

**Check 3: Template Matching**
- Template must have exact match:
  - `category: "application"`
  - `triggerType: "applicationCreated"`
  - `enabled: true`
- If no template, uses default message

**Check 4: Twilio Configuration**
- Verify Twilio secrets are set
- Check Twilio console for delivery status
- Check for A2P 10DLC errors

### Issue: Wrong Message Received

**Check Template:**
- Verify template message is correct
- Check if template is enabled
- Verify template variables are correct

**Check Variables:**
- Variables should resolve from:
  - User document (firstName, etc.)
  - Job order document (jobTitle, locationCity, etc.)
  - Application document (applicationId, etc.)

### Issue: Template Variables Not Resolving

**Check Data:**
- Verify job order exists if `jobOrderId` present
- Verify location exists if location lookup needed
- Check function logs for lookup errors (warnings are okay)

**Check Variable Names:**
- Must use exact variable names: `{firstName}`, not `{first_name}`
- Case-sensitive

---

## 📋 Quick Test Checklist

- [ ] User has `phoneE164` and `phoneVerified: true`
- [ ] User has `smsOptIn: true` or notification settings enabled
- [ ] Template exists with correct category/triggerType/enabled
- [ ] Function `onApplicationCreated` is deployed
- [ ] Application is created at `tenants/{tenantId}/applications/{applicationId}`
- [ ] Check function logs after submission
- [ ] Check phone for SMS
- [ ] Check `sms_messages` collection for audit log

---

## Expected Behavior

**If everything is configured correctly:**
1. User submits application
2. Trigger fires within 1-2 seconds
3. Function fetches user, job order, location data
4. Function finds matching template (or uses default)
5. Function resolves all variables
6. Function checks notification settings
7. Function sends SMS via Twilio
8. SMS arrives on user's phone within 10-30 seconds
9. Audit log entry created in `sms_messages`

**If something is missing:**
- Missing phone → Logs warning, skips SMS (application still succeeds)
- No template → Uses default message
- SMS fails → Logs error, application still succeeds
- Notification disabled → Logs info, skips SMS

---

## Common Issues

### Issue: "User has no verified phone"
**Fix:** User needs to verify their phone number first

### Issue: Template not found
**Fix:** Check template category, triggerType, and enabled status

### Issue: Variables showing as `{variableName}` in SMS
**Fix:** Variable name might be wrong, or data is missing - check resolver logs

### Issue: Location city is empty
**Fix:** Check if job order has location data, or if locationId needs lookup

---

## Testing with Different Scenarios

### Scenario 1: User with Verified Phone + Template
✅ Should send SMS using template

### Scenario 2: User with Verified Phone, No Template
✅ Should send default SMS message

### Scenario 3: User without Verified Phone
⚠️ Should skip SMS, log warning

### Scenario 4: User with SMS Disabled
⚠️ Should skip SMS, log info

### Scenario 5: Application with Job Order + Location
✅ Should resolve all location variables correctly

### Scenario 6: Application without Job Order
✅ Should still send SMS with available data

---

## Next Steps After Testing

If test is successful:
1. ✅ Trigger is working correctly
2. ✅ Template system is working
3. ✅ Variable resolver is working
4. 🚀 Ready for production use!

If test fails:
1. Check function logs for specific errors
2. Verify all prerequisites
3. Check Twilio configuration
4. Review troubleshooting section above

