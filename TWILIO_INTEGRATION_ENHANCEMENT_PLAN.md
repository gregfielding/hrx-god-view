# Twilio Integration Enhancement Plan

## Overview
This plan addresses gaps in the Twilio integration to ensure phone verification works correctly, add automatic SMS triggers for assignments/applications/shifts, integrate SMS into broadcasts, and enable group messaging capabilities.

## Current State Analysis

### ✅ Working Components
1. **Phone Verification (OTP)**
   - Functions: `sendOtp`, `checkOtp` in `functions/src/twilio.ts`
   - Client utilities: `startPhoneVerification`, `confirmPhoneCode` in `src/utils/phoneVerificationTwilio.ts`
   - **Issue**: Authentication disabled (`invoker: 'public'`) - needs review

2. **Worker Messaging**
   - Function: `sendWorkerMessage` in `functions/src/twilio.ts`
   - Used manually in `PlacementsTab` when assigning workers to shifts
   - Has permission checks, opt-in validation, A2P 10DLC error handling

### ❌ Missing Components
1. **Automatic SMS Triggers** - No SMS sent when:
   - Assignments are created/updated automatically
   - Application status changes
   - Shifts are created/updated
   
2. **Broadcast SMS Integration** - Broadcasts only create in-app notifications, no SMS

3. **Group Messaging** - No bulk SMS capability to user groups

## Implementation Tasks

### Phase 1: Phone Verification Confirmation & Authentication

#### Task 1.1: Verify Phone Verification is Working
**Files to check:**
- `src/components/EligibilityModal.tsx` - Phone verification UI flow
- `src/utils/phoneVerificationTwilio.ts` - Client implementation
- `functions/src/twilio.ts` - Server implementation

**Actions:**
1. Test phone verification flow end-to-end
2. Verify Firestore updates (`phoneVerified`, `phoneE164`, `phoneVerifiedAt`)
3. Check error handling for invalid codes, expired codes, rate limiting

#### Task 1.2: Re-enable Authentication (Optional)
**File:** `functions/src/twilio.ts`

**Current code:**
```typescript:105:116:functions/src/twilio.ts
export const sendOtp = onCall(
  {
    secrets: [twilioAccountSid, twilioAuthToken, verifyServiceSid],
    cors: true,
    invoker: 'public', // Allow unauthenticated calls for now
  },
  async (request) => {
  // For now, allow unauthenticated calls for testing
  // TODO: Add proper authentication back
  // if (!request.auth) {
  //   throw new HttpsError('unauthenticated', 'Must be signed in to verify phone');
  // }
```

**Decision needed:** 
- Keep public for apply flow (users may not be logged in yet)
- OR require authentication and handle guest users differently

### Phase 2: Automatic SMS Triggers for Assignments

#### Task 2.1: Add SMS Trigger on Assignment Creation
**File:** `functions/src/index.ts` (existing assignment triggers at lines 8334-8349)

**Implementation:**
1. Enhance `logAssignmentCreated` trigger to send SMS
2. Fetch assignment details including worker phone number
3. Fetch job order/shift details for message content
4. Call `sendWorkerMessage` with appropriate template
5. Handle errors gracefully (don't fail assignment creation if SMS fails)

**Message template:**
```
Hi {firstName}, you've been assigned to {jobTitle} on {date} at {location}. 
Shift time: {timeRange}
Please confirm your availability: {jobUrl}
```

**Files to modify:**
- `functions/src/index.ts` - Enhance `logAssignmentCreated`
- Import `sendWorkerMessage` from `twilio.ts` (or create internal helper)

#### Task 2.2: Add SMS Trigger on Assignment Status Update
**File:** `functions/src/index.ts` - Enhance `logAssignmentUpdated`

**Scenarios:**
- Assignment confirmed → Send confirmation SMS
- Assignment cancelled → Send cancellation SMS
- Assignment completed → Send completion/feedback request

### Phase 3: Automatic SMS Triggers for Applications

#### Task 3.1: Create Application Status Change Trigger
**New file:** `functions/src/applicationSmsTriggers.ts`

**Trigger:** Firestore trigger on `tenants/{tenantId}/applications/{applicationId}` updates

**Status change scenarios:**
- `screened` → "Your application for {jobTitle} has been screened. We'll contact you soon."
- `advanced` → "Congratulations! Your application for {jobTitle} has advanced to the next stage."
- `interview` → "You have an interview scheduled for {jobTitle}. Check your account for details."
- `offer` → "Congratulations! You've received an offer for {jobTitle}. Please check your account."
- `rejected` → "Thank you for your interest. Your application for {jobTitle} has been reviewed."
- `hired` → "Welcome to the team! Your application for {jobTitle} has been accepted."

**Implementation:**
1. Create `onApplicationUpdated` trigger
2. Detect status changes (compare before/after)
3. Fetch user phone from `users` collection
4. Send SMS with appropriate message template
5. Respect user's `smsOptIn` preference

**Files to create/modify:**
- `functions/src/applicationSmsTriggers.ts` - New file
- `functions/src/index.ts` - Export the trigger

### Phase 4: Automatic SMS Triggers for Shifts

#### Task 4.1: Add Shift Reminder SMS
**File:** `functions/src/shiftSmsTriggers.ts` (new)

**Scenarios:**
1. **Shift Created** - Notify assigned workers immediately
2. **Shift Updated** - Notify workers of changes (time, location, cancellation)
3. **Shift Reminder** - Scheduled reminder 24 hours before shift

**Implementation:**
1. Enhance existing `onShiftCreated` and `onShiftUpdated` triggers in `functions/src/updateNextShiftDate.ts`
2. OR create new dedicated triggers in `functions/src/shiftSmsTriggers.ts`
3. Fetch all assignments for the shift
4. Send SMS to each assigned worker's phone

**Message templates:**
- **Shift Created:** "New shift assigned: {jobTitle} on {date} from {timeRange} at {location}"
- **Shift Updated:** "Shift update: {jobTitle} on {date}. Changes: {changeDetails}"
- **Shift Reminder:** "Reminder: You have a shift tomorrow at {time} for {jobTitle} at {location}"

### Phase 5: Broadcast SMS Integration

#### Task 5.1: Add SMS to Broadcast System
**File:** `functions/src/index.ts` - `sendBroadcastInternal` function (line 3794)

**Current implementation:**
- Only creates in-app notifications in `broadcast_notifications` collection
- No SMS integration

**Enhancement:**
1. After creating notifications, fetch all recipients' phone numbers
2. Filter recipients by `smsOptIn: true` (if field exists, default to true for verified phones)
3. Send SMS to each recipient using `sendWorkerMessage`
4. Log SMS sends in broadcast metadata
5. Handle failures gracefully (continue even if some SMS fail)

**Implementation details:**
```typescript
// In sendBroadcastInternal, after creating notifications:
const recipientsWithPhones = await Promise.all(
  recipients.map(async (recipient) => {
    const userDoc = await db.doc(`users/${recipient.id}`).get();
    const userData = userDoc.data();
    if (userData?.phoneE164 && userData?.phoneVerified && userData?.smsOptIn !== false) {
      return { ...recipient, phoneE164: userData.phoneE164 };
    }
    return null;
  })
);

// Filter out nulls and send SMS
const validPhones = recipientsWithPhones.filter(r => r !== null);
for (const recipient of validPhones) {
  try {
    await sendWorkerMessageInternal(recipient.phoneE164, broadcast.message);
    // Log success
  } catch (error) {
    // Log failure but continue
  }
}
```

**Files to modify:**
- `functions/src/index.ts` - Enhance `sendBroadcastInternal`
- Consider creating `sendWorkerMessageInternal` helper that doesn't require auth context

### Phase 6: Group Messaging (Bulk SMS)

#### Task 6.1: Create Bulk SMS Function
**New file:** `functions/src/groupMessaging.ts`

**Function:** `sendGroupMessage`

**Parameters:**
- `recipientIds: string[]` - Array of user IDs OR
- `userGroupId: string` - Send to all members of a user group
- `message: string` - Message content
- `template?: string` - Optional template

**Implementation:**
1. If `userGroupId` provided, fetch all members from `userGroups/{groupId}/members`
2. Fetch phone numbers for all recipients from `users` collection
3. Filter by `smsOptIn` and `phoneVerified`
4. Send SMS in batches (to avoid rate limits)
5. Return success/failure counts

**Rate limiting:**
- Twilio allows ~1 message/second per phone number
- Batch sends with delays between batches
- Use Promise.all with concurrency limits

**Files to create:**
- `functions/src/groupMessaging.ts` - New bulk messaging functions
- `functions/src/index.ts` - Export new functions

#### Task 6.2: Create Client-Side Group Messaging Hook
**File:** `src/hooks/useGroupMessaging.ts` (new)

**Hook:** `useGroupMessaging`

**Features:**
- Send message to multiple users
- Send message to user group
- Track progress (sent/failed counts)
- Handle errors gracefully

### Phase 7: Internal Helper Functions

#### Task 7.1: Create Internal SMS Helper
**File:** `functions/src/twilio.ts`

**New function:** `sendWorkerMessageInternal`

**Purpose:** Internal version of `sendWorkerMessage` that doesn't require auth context (for use in triggers)

**Differences from `sendWorkerMessage`:**
- No auth validation
- No sender permission checks
- Accepts system context for logging
- Same SMS sending logic

**Usage:** Called from Firestore triggers and scheduled functions

### Phase 8: Configuration & Testing

#### Task 8.1: Verify Twilio Secrets Configuration
**File:** `functions/src/twilio.ts`

**Required secrets:**
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`
- `TWILIO_MESSAGING_PHONE_NUMBER` (or `TWILIO_A2P_CAMPAIGN`)

**Action:** Verify all secrets are set in Firebase Functions configuration

#### Task 8.2: Test Phone Verification Flow
1. Test with valid phone number
2. Test with invalid phone number
3. Test with expired code
4. Test with wrong code
5. Verify Firestore updates

#### Task 8.3: Test Automatic Triggers
1. Create assignment → Verify SMS sent
2. Update application status → Verify SMS sent
3. Create/update shift → Verify SMS sent
4. Create broadcast → Verify SMS sent to recipients

#### Task 8.4: Test Group Messaging
1. Send to user group
2. Send to array of user IDs
3. Verify opt-in filtering works
4. Test with large groups (100+ users)

## File Structure

### Files to Modify
1. `functions/src/twilio.ts` - Add internal helper functions
2. `functions/src/index.ts` - Enhance assignment triggers, broadcast SMS
3. `functions/src/updateNextShiftDate.ts` - Add SMS to shift triggers (or create new file)

### Files to Create
1. `functions/src/applicationSmsTriggers.ts` - Application status change triggers
2. `functions/src/shiftSmsTriggers.ts` - Shift-related SMS triggers (if separate from updateNextShiftDate)
3. `functions/src/groupMessaging.ts` - Bulk/group messaging functions
4. `src/hooks/useGroupMessaging.ts` - Client-side group messaging hook

## Error Handling & Resilience

### Principles
1. **Never fail primary operation** - If SMS fails, don't fail assignment/application/shift creation
2. **Log all SMS attempts** - Success and failure in Firestore `sms_messages` collection
3. **Respect user preferences** - Always check `smsOptIn` before sending
4. **Rate limiting** - Batch sends with delays for group messages
5. **Graceful degradation** - If Twilio is down, log error but continue

### Error Scenarios
- Twilio API errors → Log and continue
- Invalid phone numbers → Skip and continue
- Opt-out users → Skip silently
- Rate limits → Batch with delays
- A2P 10DLC errors → Log warning, return failure status

## Testing Checklist

- [ ] Phone verification works end-to-end
- [ ] Assignment creation triggers SMS
- [ ] Assignment status update triggers SMS
- [ ] Application status change triggers SMS
- [ ] Shift creation triggers SMS
- [ ] Shift update triggers SMS
- [ ] Broadcast sends SMS to recipients
- [ ] Group messaging works (user groups and user arrays)
- [ ] Opt-in filtering works correctly
- [ ] Error handling doesn't break primary operations
- [ ] Rate limiting works for bulk sends
- [ ] All SMS logged in `sms_messages` collection

## Deployment Considerations

1. **Deploy functions incrementally** - Test each phase before moving to next
2. **Monitor costs** - SMS costs ~$0.0079 per message, monitor usage
3. **Watch for rate limits** - Twilio has rate limits, batch sends appropriately
4. **A2P 10DLC** - Ensure registration is complete for production
5. **Secrets** - Verify all secrets are set before deployment

## Success Metrics

1. Phone verification success rate > 95%
2. SMS delivery rate > 90% for automatic triggers
3. Zero failures of primary operations due to SMS errors
4. Group messaging handles 100+ recipients successfully
5. All SMS attempts logged in Firestore

