# SendGrid Email Deliverability Setup Guide

## Problem: Emails Going to Spam

If your test emails are landing in spam folders, you need to complete domain authentication in SendGrid. This is **critical** for email deliverability.

## Required Steps in SendGrid Dashboard

### 1. **Domain Authentication (SPF, DKIM, DMARC)**

This is the **most important** step to prevent emails from going to spam.

1. Go to SendGrid Dashboard → **Settings** → **Sender Authentication**
2. Click **Authenticate Your Domain**
3. Enter your domain (e.g., `hrxone.com` or `c1staffing.com`)
4. SendGrid will provide DNS records to add:
   - **CNAME records** for DKIM
   - **TXT record** for SPF
   - **TXT record** for DMARC (optional but recommended)
5. Add these records to your domain's DNS (via your domain registrar or DNS provider)
6. Wait for verification (can take up to 48 hours, usually much faster)
7. Once verified, SendGrid will show a green checkmark

**Important**: You must use a **verified sender email** from your authenticated domain. For example:
- ✅ `noreply@hrxone.com` (if `hrxone.com` is authenticated)
- ✅ `notifications@c1staffing.com` (if `c1staffing.com` is authenticated)
- ❌ `noreply@hrxone.com` (if domain is NOT authenticated)

### 2. **Verify Sender Email**

1. Go to **Settings** → **Sender Authentication** → **Single Sender Verification**
2. Add your sender email (e.g., `noreply@hrxone.com`)
3. Verify the email by clicking the link in the verification email
4. Update your `SENDGRID_FROM_EMAIL` secret to use this verified address

### 3. **Set Up Unsubscribe Groups (Optional but Recommended)**

1. Go to **Marketing** → **Unsubscribe Groups**
2. Create a group (e.g., "Transactional Messages")
3. Note the Group ID
4. Update the code to use this Group ID in the `asm.groupId` field

### 4. **Check Sender Reputation**

1. Go to **Activity** → **Email Activity**
2. Check for any bounces, spam reports, or blocks
3. Monitor your sender reputation score

## Current Code Improvements

I've already added:
- ✅ `List-Unsubscribe` headers (required by Gmail/Outlook)
- ✅ `List-Unsubscribe-Post` header (one-click unsubscribe)
- ✅ Proper email headers for tracking
- ✅ Unsubscribe URL structure

## Immediate Actions

1. **Check your current `SENDGRID_FROM_EMAIL`**:
   ```bash
   # Check what email is currently configured
   firebase functions:config:get
   ```

2. **Authenticate your domain in SendGrid** (see steps above)

3. **Update `SENDGRID_FROM_EMAIL` to use a verified sender**:
   ```bash
   # Set the secret (use a verified email from your authenticated domain)
   firebase functions:secrets:set SENDGRID_FROM_EMAIL
   # Enter: noreply@hrxone.com (or your verified domain)
   ```

4. **Redeploy functions** after updating secrets:
   ```bash
   firebase deploy --only functions:sendMessageApi
   ```

## Testing Deliverability

After completing domain authentication:

1. Send a test email
2. Check if it lands in inbox (not spam)
3. Use Gmail's "Show Original" to verify:
   - SPF: `pass`
   - DKIM: `pass`
   - DMARC: `pass` (if configured)

## Common Issues

- **"Domain not authenticated"**: Complete Step 1 above
- **"Sender not verified"**: Complete Step 2 above
- **Still going to spam**: Check sender reputation, avoid spam trigger words, ensure proper HTML structure
- **Bounces**: Verify email addresses are valid

## Next Steps

Once domain authentication is complete, emails should have much better deliverability. The headers I added will also help Gmail/Outlook recognize legitimate transactional emails.

---

## ✅ Domain Authentication Complete

**Status**: Domain `hrxone.com` has been authenticated in SendGrid.

**Current Configuration**:
- `SENDGRID_FROM_EMAIL`: `sender@hrxone.com` ✅ (works, but consider using a more standard address)

**Recommended Update**:
Since the domain is authenticated, you can use any email address from `@hrxone.com`. Consider updating to:
- `noreply@hrxone.com` (standard for transactional emails)
- `notifications@hrxone.com` (for user notifications)
- `support@hrxone.com` (if you want replies)

**To update the sender email**:
```bash
firebase functions:secrets:set SENDGRID_FROM_EMAIL
# Enter: noreply@hrxone.com (or your preferred address)
firebase deploy --only functions:sendMessageApi
```

**Verification**:
1. Send a test email
2. Check Gmail's "Show Original" (three dots → Show Original)
3. Verify these headers show `pass`:
   - `SPF: pass`
   - `DKIM: pass`
   - `DMARC: pass` (if DMARC was configured)

