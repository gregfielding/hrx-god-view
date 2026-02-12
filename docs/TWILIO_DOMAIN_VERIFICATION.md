# Twilio Domain Verification for hrxone.com

Use this guide to verify hrxone.com in Twilio (needed for Link Shortening and other features).

## Step 1: In Twilio Console

1. Go to **Domains** (Admin Center) or **Develop → Messaging → Services → [your service] → Link Shortening**
2. Enter domain: `hrxone.com`
3. Select **DNS** verification
4. Click **Save & Continue**
5. Twilio will show you a **unique verification token** (a long alphanumeric string)

## Step 2: Add TXT Record to DNS

In your DNS provider (Cloudflare, GoDaddy, Namecheap, Firebase, etc.):

| Type | Name / Host                | Value                    | TTL   |
|------|----------------------------|--------------------------|-------|
| TXT  | `_twilio` or `_twilio.hrxone.com` | *(paste the token from Twilio)* | 300 or default |

**Notes:**
- Some providers want only `_twilio` (they auto-append the domain)
- Others want `_twilio.hrxone.com` or `hrxone.com` as the host
- The **Value** is the exact token Twilio shows—no quotes unless your provider requires them

## Step 3: Wait for Propagation

- DNS can take from a few minutes up to 72 hours
- Twilio will check periodically; verification usually completes within 24 hours
- You can re-check status in the Twilio Domains page

## Step 4: Optional – Use a Subdomain for Link Shortening

If you prefer not to use the root domain for Link Shortening, use a subdomain like:
- `link.hrxone.com` or
- `go.hrxone.com`

Add a CNAME record pointing to Twilio's Link Shortening target (from the Link Shortening onboarding guide). That keeps your main site untouched and isolates link-shortening traffic.
