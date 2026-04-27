# Firebase Functions - Twilio Integration

This document describes the Twilio SMS verification and messaging integration for the HRX platform.

## Overview

The Twilio integration provides:
- **Phone Verification**: OTP-based phone number verification using Twilio Verify
- **Worker Messaging**: SMS messaging to workers for notifications and updates

## Setup Instructions

### 1. Twilio Account Setup

1. **Create Twilio Account**: https://www.twilio.com/try-twilio
2. **Upgrade to Paid Account**: Trial accounts have limitations for SMS
3. **Buy Phone Number**: Go to Phone Numbers > Buy a Number
4. **Create Verify Service**: https://console.twilio.com/us1/develop/verify/services

### 2. Required Twilio Credentials

- **Account SID**: Starts with `AC...`
- **Auth Token**: Available in Twilio Console
- **Verify Service SID**: Starts with `VA...`
- **Messaging Phone Number**: Your Twilio phone number (E.164 format)

### 3. Firebase Configuration

Set the following Firebase Functions config variables:

```bash
firebase functions:config:set \
  twilio.accountsid="AC..." \
  twilio.authtoken="..." \
  twilio.verifyservicesid="VA..." \
  twilio.messagingphonenumber="+1..."
```

### 4. Deploy Functions

```bash
firebase deploy --only functions
```

## Available Functions

### `sendOtp`
Sends OTP verification code via Twilio Verify.

**Parameters:**
- `phoneE164` (string): Phone number in E.164 format

**Returns:**
- `success: true` on successful send

**Errors:**
- `unauthenticated`: User must be signed in
- `invalid-argument`: Invalid phone number format
- `resource-exhausted`: Too many attempts

### `checkOtp`
Verifies OTP code and updates user profile.

**Parameters:**
- `phoneE164` (string): Phone number in E.164 format
- `code` (string): 6-digit verification code

**Returns:**
- `success: true` on successful verification

**Updates Firestore:**
- Sets `phoneE164` and `phoneVerified: true`
- Sets `workEligibility: true` if DOB is also verified

**Errors:**
- `unauthenticated`: User must be signed in
- `invalid-argument`: Invalid code format
- `permission-denied`: Incorrect code
- `deadline-exceeded`: Code expired

### `sendWorkerMessage`
Sends SMS message to worker via Twilio Programmable Messaging.

**Parameters:**
- `to` (string): Recipient phone number (E.164 format)
- `message` (string, optional): Custom message content
- `template` (string, optional): Predefined message template

**Templates:**
- `shift_reminder`: Shift reminder message
- `onboarding`: Welcome message for new workers
- `status_update`: Application status update
- `custom`: Generic notification

**Returns:**
- `success: true`
- `messageId`: Twilio message SID
- `status`: Message delivery status

**Permissions Required:**
- Admin (security level 5+)
- Manager
- Recruiter

**Prerequisites:**
- Recipient must have `smsOptIn: true`

## Client-Side Usage

### Phone Verification

```typescript
import { startPhoneVerification, confirmPhoneCode } from '../utils/phoneVerificationTwilio';

// Send OTP
await startPhoneVerification('+17025550147');

// Verify code
await confirmPhoneCode('123456', '+17025550147');
```

### Worker Messaging

```typescript
import { useWorkerMessaging } from '../hooks/useWorkerMessaging';

const { sendMessage, isLoading, error } = useWorkerMessaging();

// Send custom message
await sendMessage('+17025550147', 'Your shift starts in 30 minutes');

// Send template message
await sendMessage('+17025550147', undefined, 'shift_reminder');
```

## Security Considerations

- All Twilio operations happen server-side
- Client cannot directly set `phoneVerified` or `workEligibility`
- Authentication required for all functions
- Worker messaging requires appropriate permissions
- Recipients must opt-in to SMS (`smsOptIn: true`)

## Cost Considerations

- **Twilio Verify**: ~$0.05 per verification
- **Twilio SMS**: ~$0.0079 per message (US)
- **A2P 10DLC**: Required for production SMS (~$40-100 registration)

## A2P 10DLC Requirements

For production SMS messaging in the US:

1. **Brand Registration**: Register your business
2. **Campaign Registration**: Register messaging use cases
3. **Compliance**: Ensure opt-in/opt-out mechanisms

See: https://www.twilio.com/docs/messaging/a2p-10dlc

## Error Handling

All functions include comprehensive error handling for:
- Authentication failures
- Invalid input formats
- Twilio service errors
- Rate limiting
- Permission issues

## Testing

### Local Development
Use the mock SMS system for development (see `phoneVerificationSimple.ts`).

### Production Testing
1. Deploy functions to Firebase
2. Test with real phone numbers
3. Verify Firestore updates
4. Test worker messaging permissions

## Troubleshooting

### Common Issues

1. **"Twilio connection failed"**
   - Verify Account SID and Auth Token
   - Ensure account is not suspended

2. **"Verify Service test failed"**
   - Verify Service SID is correct
   - Ensure service is active

3. **"Invalid phone number"**
   - Use E.164 format (+1XXXXXXXXXX)
   - Ensure number can receive SMS

4. **"Insufficient permissions"**
   - Check user security level
   - Verify user has appropriate role

### Logs

View function logs:
```bash
firebase functions:log --only sendOtp,checkOtp,sendWorkerMessage
```

## Configuration Script

Use the helper script to configure Twilio:

```bash
cd functions
npx ts-node scripts/configureTwilio.ts
```

This script will:
- Test Twilio credentials
- Validate Verify Service
- Generate Firebase config commands
- Provide setup instructions
