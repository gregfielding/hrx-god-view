# HRX Marketing Module — Master Product & Implementation Outline

_Last updated: 2026-01-07_

This document defines the full **Marketing Module** for HRX — including UI, workflow logic, CRM integrations, Mailchimp sync, permissions, and analytics. It is meant to act as a **master blueprint** so we can return later and build the full system in structured phases.

---

## 🎯 Core Goals

The HRX Marketing Module should:

- Enable HRX + C1 teams to **send compliant marketing and transactional email** to CRM contacts
- Support **contact-level marketing segmentation**
- Sync **campaign + engagement analytics back to HRX**
- Support **Mailchimp API integration**
- Respect **compliance + consent controls**
- Be fully **role-based + auditable**
- Support **future SMS / multichannel expansion**

---

## 🧠 Key Concepts

### 1️⃣ CRM Contact = Source of Truth
All marketing begins with a CRM Contact record.

Every Contact will have structured **Marketing Metadata**, including:

```
marketing: {
  segment: "hospitality" | "healthcare" | "industrial" | "none",
  autoTags: ["Sodexo", "General Manager"],
  customTags: ["Prospect", "VIP"],
  mailchimp: {
    audienceId: string,
    lastSyncedAt: Timestamp,
    status: "subscribed" | "unsubscribed" | "cleaned",
    mcId: string
  }
}
```

👉 This supports **manual, automated, and hybrid tagging.**

---

### 2️⃣ Segments vs Tags — Definition

| Element | Purpose |
|--------|--------|
| **Segment** | High‑level audience classification (Healthcare, Industrial, Hospitality, None) |
| **Auto‑Tags** | Pulled from CRM metadata (Employer, Title, Role Type) |
| **Custom Tags** | Manually assigned strategic groupings |
| **External (MC) Tags** | Synced tags stored in Mailchimp |

Segments are:
```
Healthcare
Industrial
Hospitality
None
```

Auto‑Tags should include:
```
Company Name
Job Title
Division / Region (if available)
```

Examples:
```
"Sodexo"
"General Manager"
"Austin Region"
```

Custom Tags can include things like:
```
"VIP"
"Strategic Prospect"
"Former Customer"
"Cold Lead"
"Finance Exec"
```

---

## 🖥 UI — System‑Wide Locations

### CRM CONTACT HEADER (Already Started ✔)

Add below Email line:

```
Marketing:  [ Chip: Company ]  [ Chip: Job Title ]
Segment:   [ Dropdown ]
```

#### Interaction Rules

- Chips **are NOT editable here**
- Clicking chip opens **tag source**
- Dropdown persists immediately
- Segments validate options only
- Admins may open **Marketing Panel** from here

---

### 🔽 Marketing Panel — Full Editor UI

Accessible from:
- Contact Header
- Global Marketing Module
- Search / Bulk Edit

Panel Contains:

#### Contact Snapshot
- Name
- Company
- Role
- Owner
- Email
- Verified Status
- Bounce Flag

#### Marketing Fields
- Segment selector
- Auto‑tag list (read only)
- Custom tags (editable pills)
- Add‑tag input
- Tag categories

#### Compliance Fields
- Email consent status
- Last consent update
- Source of consent
- GDPR notes (if needed)
- Unsubscribe flag
- Bounce Flag

#### Mailchimp Sync Status
- Linked audience
- Tags → MC tags mapping
- Last sync time
- Status badge

> Sync status should be **non‑blocking + resilient**

---

## 📨 Campaigns — Future UI (Phase 2+)

We won’t build now — but define:

### Campaign Record Shape

```
campaigns/:id {
  name
  createdBy
  createdAt
  channel: "email"
  audienceType: "query" | "manual"
  query: {...}
  contacts: [ids]
  templateId
  mailchimpCampaignId?
  status
  metrics: {...}
}
```

This allows auditability + replay.

---

## 🔗 Mailchimp API — Master Integration Plan

### Why Mailchimp stays primary sender

✔ Better deliverability  
✔ ISP reputation management  
✔ Bounce management  
✔ CASL / GDPR tools  
✔ Compliance logs  
✔ Built‑in warmup + throttling  
✔ No HRX IP blacklisting risk  

---

## 🧩 Sync Model — Recommended Direction

### HRX → Mailchimp (Write)

We sync to MC:

- Email
- Name
- Company
- Segment → Tag
- Auto Tags
- Custom Tags
- Metadata

We do **NOT** sync unsubscribes outbound.

### Mailchimp → HRX (Read)

We sync back:

- Subscribed / Unsubscribed
- Bounces
- Campaign activity
- Open rates
- Clicks
- Engagement scoring (future)

This gives **full visibility from HRX**.

---

## 🛡 Compliance — Required

### Consent Must Be Tracked In HRX

Even when MC handles sends, HRX must know:

```
emailConsent: true | false
consentSource: "application" | "admin-add" | "manual"
consentUpdatedAt: Timestamp
```

### Auto‑Block Sending When

❌ Unsubscribed  
❌ Bounced  
❌ Marked sensitive  
❌ Legal hold  

MC unsubscribes **MUST override marketing flags**.

---

## 👤 Permissions — Role Driven

| Role | Access |
|------|--------|
| Admin | Full marketing control |
| Sales | View + apply tags |
| Recruiter | View only |
| Owner | Policy override |
| Read‑only | No marketing fields |

Every action should log to:

```
activity_logs/:id
```

---

## 📊 Analytics — Future Scope

We will eventually track:

- Emails sent
- Open rate
- Click rate
- Bounce rate
- Replies (if/when supported)
- Engagement by segment
- Performance by tag
- ROI heat‑maps

All surfaced in **Marketing Dashboard UI**.

---

## 🚦 Phase Plan

### Phase 1 — Foundation (NOW)
✔ Segments  
✔ Auto‑tags  
✔ Custom tags  
✔ Visible UI  
✔ Basic record model  
✔ Read‑only analytics placeholder  
✔ NO SENDING YET  

---

### Phase 2 — Sync
✔ Mailchimp audience connect  
✔ Contact sync rules  
✔ Unsubscribe sync back  
✔ Event sync back  
✔ Tag mappings  

---

### Phase 3 — Campaign UI
✔ Campaign builder  
✔ Audience builder UI  
✔ Suggested audiences  
✔ Send control & logs  
✔ Send scheduling  
✔ Admin approval workflow  

---

### Phase 4 — Optimization
✔ Engagement scoring  
✔ Predictive recommendations  
✔ CRM → AI copy assist  
✔ Auto A/B testing  

---

## 🔐 Security Model

### Protect Marketing Data

- Fields restricted by role
- All changes logged
- Export control w/ audit
- No bulk delete without admin
- Masked data for viewer‑only roles

---

## 📁 Firestore Schema Summary

```
crm_contacts/:id
mailchimp_sync/:logId
campaigns/:id
campaign_events/:id
marketing_settings/:tenantId
```

---

## 📝 Developer Notes

- All UI built in **React + MUI**
- All marketing data lives in **CRM contact doc**
- Sync runs via **Cloud Functions**
- Failures should **retry + alert**
- Feature flags protect rollout

---

## 🏁 Final Thought

We are **intentionally moving slow + structured** here.

Marketing systems can create:
✔ Revenue  
✔ Compliance risk  
✔ Brand exposure  

This blueprint ensures we scale properly 💪

When ready — we’ll break this doc into sprint‑ready specs.
