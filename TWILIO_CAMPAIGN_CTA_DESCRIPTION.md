# Twilio A2P Campaign CTA Description - For Approval

## Current Issue
Error: "The campaign submission has been reviewed and rejected due to issues verifying the Call to Action (CTA) provided for the campaign."

## Recommended CTA Description

**Use this description in the "How do end-users consent to receive messages?" field:**

```
End-users provide explicit consent to receive SMS messages through a multi-step process:

1. Account Creation/Sign-Up: During initial account creation or job application sign-up, users are presented with a clear consent checkbox that states: "I agree to receive SMS notifications about my application status, job assignments, shift reminders, and related employment communications from C1 Staffing." This consent is recorded in our database with a timestamp and stored in the user's profile under userAgreements.smsConsent.

2. Phone Verification: As part of the job application process, users must verify their mobile phone number through Twilio Verify. This verification step confirms the user controls the phone number and provides an additional layer of explicit consent, as users must actively enter their phone number and verify it via OTP code before receiving any SMS messages.

3. Opt-Out Mechanism: Users can opt-out at any time by:
   - Replying "STOP" to any SMS message (processed automatically by Twilio)
   - Managing SMS preferences in their account settings at https://hrxone.com/
   - Setting smsOptIn to false in their user profile

All consent is recorded with timestamps, and our system checks smsOptIn status before sending any SMS. Phone verification is required before users can receive application-related messages.
```

## Key Points to Include

1. **Clear consent checkbox** during sign-up/application
2. **Phone verification step** (Twilio Verify) as additional consent
3. **Opt-out mechanisms** (STOP keyword and account settings)
4. **Database recording** of consent with timestamps
5. **System checks** before sending (smsOptIn field)

## Sample Messages (Make Sure These Match Your Use Case)

**Sample Message #1:** (Keep as-is for OTP)
"Your one-time passcode is 1234"

**Sample Message #2:** (Keep for password reset)
"Click here to reset your password"

**Sample Message #3:** (Application confirmation - matches your template)
"Congratulations! Your application to work has been accepted. Visit https://c1staffing.com to view the job details."

**Sample Message #4:** (Application status update)
"Hi [FirstName], your application status has been updated. Check your account for details."

**Sample Message #5:** (Shift reminder)
"Just a reminder that you need to park in the designated employee parking lot today"

## Message Contents

✅ **Checked:** Messages will include embedded links
✅ **Checked:** Messages will include phone numbers  
❌ **Unchecked:** Messages include content related to direct lending or other loan arrangement
❌ **Unchecked:** Messages include age-gated content

## Campaign Description

**Current:** "This campaign validates phone numbers, sends one-time passcodes, and will also sometime send updates to job candidates for positions they have applied to work."

**Recommendation:** Make it more specific:

```
This campaign sends transactional and informational SMS messages for employment-related communications, including:
1. Phone number verification via one-time passcodes (OTP) for account security
2. Application status updates (e.g., application received, screening complete, interview scheduled, offer extended, application accepted/rejected)
3. Job assignment notifications (shift confirmations, schedule changes, shift reminders)
4. Employment-related updates (onboarding instructions, work eligibility requirements, document upload reminders)

All messages are sent only to users who have explicitly consented during account creation and verified their phone numbers. Users can opt-out via STOP keyword or account settings.
```

## Next Steps

1. **Copy the CTA description** above into the Twilio campaign form
2. **Update the campaign description** to be more specific
3. **Verify sample messages** match actual use cases
4. **Review all checkboxes** are correct
5. **Resubmit** for approval

The key issue is that carriers need to see a CLEAR, VERIFIABLE consent flow. The description above explicitly outlines:
- Where consent happens (account creation checkbox)
- Additional verification (phone verification step)
- How to opt-out (STOP keyword + account settings)
- Technical implementation (database storage, system checks)

