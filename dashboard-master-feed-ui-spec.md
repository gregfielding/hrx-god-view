
# HRX Dashboard — Master Feed, Calendar & To‑Do UI Spec (Phase 1–3)

_Last updated: Jan 4, 2026_

## 🎯 Product Purpose

The Dashboard is **Mission Control** for HRX users. It enables users to:

✔ See what needs attention now  
✔ Respond without leaving the Dashboard  
✔ Track work across communication channels  
✔ Stay organized and in control  

The Dashboard includes three primary widgets:

1. **Master Feed**
2. **Calendar**
3. **To‑Dos**
4. **Global Quick Actions Toolbar**

All interaction should be **real‑time, role‑aware, and Drawer‑first.**  
Every row in the Feed and To‑Dos **opens in the Universal Drawer.**

---

# 1️⃣ Master Feed — Product & UI Rules

## Purpose
Unify activity streams from multiple channels into a **single chronological feed.**

### Initial Sources
✔ Email (Inbox)  
✔ Slack DMs  
✔ Slack Channels (that user is a member of and NOT muted)

> Future: Job Applications, CRM actions, Alerts, System Events, Payroll, Compliance

---

## Feed Data Model (Firestore – Suggested)

```
feedEvents/
  id
  type: email|slack_dm|slack_channel|system|task|calendar
  title
  snippet
  sourceRef
  actor
  relatedEntities[]
  createdAt (timestamp)
  updatedAt (timestamp)
  assignedTo[]
  priority
  orgId
  tenantId
  visibility[]
  unreadBy[]
  metadata{}
```
This enables flexible expansion later.

---

## Feed UI Layout

### Columns
| Column | Purpose |
|--------|--------|
| Source Badge | Icon + color indicating event type |
| Title | Main meaningful text |
| Snippet | Context preview |
| From | Sender / actor |
| Status | Optional workflow state |
| Timestamp | Relative time |

---

## Source Badge — Color Semantics

| Type | Default Color |
|------|----------------|
| Email | Blue |
| Slack | Purple |
| System | Grey |
| Calendar | Green |
| Tasks | Yellow |
| Alerts | Red |

---

## Time Grouping Rules

The Feed should group rows using the following headers:

- **Now**
- **Earlier Today**
- **Yesterday**
- **This Week**
- **Older**

This improves scanning & mental triage.

---

## Feed Row Micro‑States

Each row supports:

- **Unread**
- **Requires action**
- **Assigned to me**
- **Muted**
- **Snoozed**
- **Completed**

Indicators should be subtle — dots, muted chips, or light text.

---

## Hover Actions Per Row

When user hovers a row, display quick actions:

🗨 Reply (Slack / Email)  
🗹 Mark complete  
🔔 Snooze  
➡ Open in Drawer  

(Default click = open in Drawer)

---

## Role‑Aware Feed Visibility

| Role | Feed Default |
|------|--------------|
| Recruiter | Candidates • Slack • Tasks • DMs |
| Sales | Email • CRM • Prospect Events |
| Admin | System • Errors • Payroll • All Comms |
| HRX Internal | Global‑scope |

Toggle options:

```
My Feed | Team Feed | Org Feed
```

Make this runtime‑configurable.

---

# 2️⃣ Slack Channel Feed Inclusion Rules

Feed items only include Slack channel activity where:

✔ User is a **member**
✔ Channel is **NOT muted**

Muting removes the channel from the Feed — but does NOT affect membership.

---

# 3️⃣ Calendar Widget UI Rules

## Purpose

Provide **time‑aware context & event launchpad** without leaving Dashboard.

### Features
✔ Tabs for Google / CRM calendars  
✔ Day, week, month view (MVP = month)  
✔ Real‑time sync  
✔ Open event in Drawer  

---

## Enhancements for Phase 2

### Event Density Indicators
Place small dots beneath dates:

- • for one
- •• for two
- `+5` for overflow

---

### Agenda Preview (Phase 2)

Below calendar show:

```
Next Up Today
9:30 — Interview — John Smith
11:00 — Client Call — Volvo Logistics
2:00 — Applicant Review
```

Button: **View More**

---

# 4️⃣ To‑Dos Widget UI Rules

## Purpose
Provide friction‑free task handling.

### Displayed Fields
- Title
- Due date / relative time
- Priority (low/medium/high/urgent)
- Status chip (scheduled / blocked / done)

---

## Filters
Task view must support tabs:

```
Assigned to Me
Created by Me
Due Today
Overdue
Completed
```

---

## Hover Controls
Icons appear on hover:

🗹 Complete  
✏ Edit  
🔔 Snooze  
🗑 Delete  

---

# 5️⃣ Global Quick Actions Toolbar

Group actions visually (MVP layout ok):

### 🧑 Candidates
• New Job Order  
• New Job Post  

### 👥 CRM
• Add Contact  
• Add Company  
• Open CRM  

### 📋 Tasks
• Open Tasks  

> Important: Buttons should **never feel crowded.**  
Spacing & pill‑style design recommended.

---

# 6️⃣ Universal Drawer — Required Behavior

Whenever user clicks:

✔ Feed row  
✔ Calendar event  
✔ Task  
✔ Slack notification  
✔ Email item  

The corresponding context pane opens in the Drawer.

Users **should not leave Dashboard unless absolutely necessary.**

---

# 7️⃣ Real‑Time Requirements

Feed & widgets must update using:

```
onSnapshot
```

Reloading page should not be required.

---

# 8️⃣ Performance & Pagination

### Feed Rules
✔ Paginate  
✔ Lazy‑load  
✔ Index queries  
✔ Ordering by `createdAt desc`  
✔ Supports infinite scroll (preferred)

---

# 9️⃣ Visual Identity & UX Principles

The Dashboard should feel like:

🧠 Calm  
🎯 Focused  
⚡ Fast  
💼 Enterprise‑grade

No visual noise. No shouting colors.  
Information hierarchy > flash.

---

# 🔐 Security & Visibility Controls

Feed visibility should respect:

- org
- tenant
- role
- assignment
- permissions
- Slack workspace mapping
- email account mapping

---

# 📈 Future Expansion Framework

This spec supports easily adding:

✔ Job Application Events  
✔ CRM Engagements  
✔ Payroll Alerts  
✔ Worker Support Cases  
✔ Worker Attendance Flags  
✔ AI‑Suggested Actions  

---

# ✅ Acceptance Criteria (Cursor‑Ready)

A feature is complete when ALL are true:

- Feed displays unified activity from Email, Slack DMs, Slack Channels (member + not muted)
- Feed groups by time buckets
- Clicking any Feed item opens Universal Drawer
- Feed rows support hover actions
- Calendar syncs CRM + Google
- Calendar opens events in Drawer
- To‑Dos support filtering & hover controls
- Dashboard updates in real‑time via `onSnapshot`
- Role‑aware visibility is enforced
- Feed pagination works smoothly
- UI theme matches existing app style

---

# 🚀 North Star Outcome

Users should say:

> “I can run my whole day from the Dashboard without losing context.”

When that is true → this feature is a success.

---

_End of Spec_
