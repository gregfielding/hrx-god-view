# Quick Test Checklist - Application Created SMS

## ✅ Will It Work?

**YES, if these conditions are met:**

### 1. **User Has Verified Phone** ✅
Check in Firestore: `users/{userId}`
- [ ] `phoneE164` exists (e.g., `"+17025550147"`)
- [ ] `phoneVerified: true`

**If missing:** SMS will be skipped (trigger won't fail, just logs warning)

### 2. **Template is Created and Enabled** ✅
Check in UI: Settings > Messaging > SMS Templates
- [ ] Template exists with:
  - Category: "Application"
  - Trigger Type: "New Application Received"
  - Enabled: ✓ (toggle on)

**If missing:** Will use default message instead

### 3. **User Has SMS Enabled** ✅
Check in Firestore: `users/{userId}`
- [ ] `smsOptIn: true` OR
- [ ] `notificationSettings.sms.enabled: true`

---

## 🧪 Test It Now

1. **Submit an application** to any job posting
2. **Wait 10-30 seconds**
3. **Check your phone** for SMS
4. **Check Firebase Functions logs** if SMS doesn't arrive

---

## 📊 How to Verify

### Option 1: Check Function Logs
```bash
firebase functions:log --only onApplicationCreated --limit 10
```

Look for:
- ✅ "New application created: {id}"
- ✅ "SMS sent for new application"
- ⚠️ "has no verified phone" → Fix: Verify user's phone
- ⚠️ "SMS disabled" → Fix: Enable SMS in user settings

### Option 2: Check SMS Messages Collection
Firestore: `tenants/{tenantId}/sms_messages`
- Should see new document after application
- Check `to`, `message`, `status` fields

### Option 3: Check Phone
- SMS should arrive within 10-30 seconds
- Message should match your template (or default)

---

## 🔍 Most Common Issue

**"No SMS Received"**

**Likely cause:** User doesn't have verified phone

**Fix:**
1. User must verify phone number first (via OTP)
2. Check `users/{userId}`:
   - `phoneE164` must exist
   - `phoneVerified` must be `true`

**If user is applying without account:**
- Application might have `candidateId` instead of `userId`
- Need to ensure external applicants also have verified phone stored

---

## ✅ Expected Result

If everything is configured:
1. Submit application → Trigger fires → SMS sent → You receive message

If something is missing:
1. Submit application → Trigger fires → Logs warning → No SMS (application still succeeds)

---

## Quick Debug Commands

```bash
# Check if function is deployed
firebase functions:list | grep onApplicationCreated

# Watch function logs in real-time
firebase functions:log --only onApplicationCreated

# Check Firestore (browser console)
# Navigate to: tenants/{tenantId}/applications
# Look for new application document
```

---

## Need Help?

Check `TESTING_APPLICATION_CREATED_TRIGGER.md` for detailed troubleshooting guide.

