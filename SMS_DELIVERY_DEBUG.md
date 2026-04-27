# SMS Delivery Debugging Guide

## ✅ Issue Identified: Error 30034 - A2P 10DLC Registration Required

**Status:** Messages are being sent correctly, but Twilio cannot deliver them because the sending number is not registered for A2P 10DLC compliance.

**Error Code:** `30034 - US A2P 10DLC - Message from an Unregistered Number`

## Current Status
- ✅ Trigger fired successfully
- ✅ User ID extracted
- ✅ Phone verified
- ✅ Twilio secrets accessible
- ✅ SMS accepted by Twilio
- ❌ **A2P 10DLC registration missing** - Messages rejected by carriers

## Message Details (from logs)
- **Message ID:** `SMdde9ac2961a393f1d49be7bedcc72fba`
- **To:** `+19254480579`
- **From:** `+18888058650`
- **Status:** "queued" or "sent" (Twilio initial status)

## ✅ SOLUTION: Fix Failed Campaign Registration

### Current Status:
- ✅ **Customer Profile:** Approved
- ✅ **Brand Registration:** Registered  
- ❌ **Campaign Registration:** **FAILED** ← This is the issue

### Required Steps:
1. **Fix Failed Campaign**
   - Go to: https://console.twilio.com/us1/develop/sms/a2p-10dlc
   - Find the failed campaign (likely "Low Volume Mixed A2P Messaging Service")
   - Check failure reason - common issues:
     * Missing or incomplete use case description
     * Missing sample messages
     * Opt-in/opt-out flow not properly configured
     * Business information mismatch
     * Carrier review requirements not met

2. **Resubmit Campaign**
   - Fix any identified issues
   - Ensure all required fields are complete
   - Submit for approval

3. **Wait for Approval**
   - Campaign approval typically takes 1-3 business days
   - Once approved, messages will deliver successfully
   - No code changes needed - will work automatically

### Cost:
- Brand Registration: ~$4 one-time
- Campaign Registration: ~$40-100 one-time
- Monthly costs vary by volume

### Timeline:
- Campaign Resubmission: Fix issues and resubmit (immediate)
- Campaign Approval: 1-3 business days after resubmission
- Until approved: Messages will continue to fail with error 30034

### Current Configuration:
- **Sending Number:** `+1 888 805 8650`
- **Messaging Service:** Low Volume Mixed A2P Messaging Service
- **Status:** Campaign registration failed - needs to be fixed and resubmitted

## Other Possible Issues

### 1. Twilio Trial Account Limitations
If using a Twilio trial account:
- Can only send to **verified phone numbers**
- Must verify recipient phone in Twilio Console
- Check: https://console.twilio.com/us1/develop/phone-numbers/manage/verified

**Fix:** Verify `+19254480579` in Twilio Console

### 2. Wrong Phone Number
Verify the phone number is correct:
- Check Firestore: `users/{userId}/phoneE164`
- Should be exactly: `+19254480579`
- Ensure user verified the correct number

### 3. Carrier Filtering / Spam
- Check spam/junk folder
- Some carriers filter unknown numbers
- Try replying to the number: `+18888058650`

### 4. Check Twilio Console
Check delivery status in Twilio:
1. Go to: https://console.twilio.com/us1/monitor/logs/sms
2. Find message ID: `SMdde9ac2961a393f1d49be7bedcc72fba`
3. Check delivery status:
   - `queued` = In queue (normal)
   - `sent` = Sent to carrier (normal)
   - `delivered` = ✅ Received
   - `failed` = ❌ Failed
   - `undelivered` = Carrier rejected

### 5. Check Message Content
Check what message was actually sent:
- Firestore: `sms_messages` collection
- Find document with `messageId: "SMdde9ac2961a393f1d49be7bedcc72fba"`
- Check `content` field to see actual message text

## Quick Checks

### Check User's Phone Number
```bash
# In Firestore Console
users/{userId}
  phoneE164: "+19254480579"
  phoneVerified: true
```

### Check SMS Message Record
```bash
# In Firestore Console
sms_messages
  Find document with messageId: "SMdde9ac2961a393f1d49be7bedcc72fba"
  Check:
    - to: "+19254480579"
    - content: (message text)
    - status: (Twilio status)
    - errorCode: (if any)
    - errorMessage: (if any)
```

### Check Twilio Logs
1. Go to Twilio Console → Monitor → Logs → SMS
2. Search for: `SMdde9ac2961a393f1d49be7bedcc72fba`
3. Check:
   - Delivery Status
   - Error Code (if any)
   - Error Message (if any)

## Next Steps

1. **Verify phone number in Twilio** (if trial account)
2. **Check Twilio Console** for delivery status
3. **Verify phone number** in user document matches actual phone
4. **Check spam folder** on phone
5. **Try sending test SMS** directly from Twilio Console

## Test Again

After verifying:
1. Submit a new application
2. Check logs for message content
3. Check Twilio Console immediately
4. Check phone (including spam folder)

