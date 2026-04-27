# Workforce System Polish — QA Scenarios

Use this doc to validate onboarding, employment, compliance, payroll, and readiness in both **Admin** (User Profile) and **Worker** (My Employment) UIs. No assignment gating; readiness is informational only.

**Automated tests:** The six scenarios and edge cases are covered by unit tests. Run:

```bash
npm test -- --testPathPattern="complianceExpiration|workerReadiness" --watchAll=false
```

---

## Standard wording reference

Use these exact strings when checking labels. No raw enums (e.g. `not_ready`, `at_risk`) in UI.

| Context | Expected label |
|--------|-----------------|
| **Readiness status (admin chip)** | Ready · Onboarding · Not ready · At risk · Blocked |
| **Employment status (admin + worker)** | Onboarding · Active · Inactive · Terminated |
| **Employment status (active + worker type)** | Active Employee (w2) · Active Contractor (1099) |
| **Worker readiness banner** | "Complete onboarding to start working" · "Some items need to be completed" · "Some items need attention soon" · "You are not eligible to work right now" |
| **Worker compliance banner** | "Action required: some of your documents need attention." · "Some documents will expire soon." |
| **Payroll status** | Not started · Invite sent · Account created · In progress · Complete · Blocked · Inactive |
| **Compliance status** | Not started · Pending · Submitted · In review · Complete · Expired · Failed · Waived |

---

## 1. Fully complete worker → Ready

**Setup**

- At least one entity employment with status **active**
- All required compliance items **complete** (and none expired / expiring soon)
- Payroll (if configured for entity) status **complete**
- Onboarding pipeline (if any) all steps complete

**Expected**

| Where | Result |
|-------|--------|
| **Admin — User Profile → Employment tab** | Readiness card: **Ready** (green chip), no reasons |
| **Admin — User Profile → Compliance tab** | No expiration alert; table may show items as Complete |
| **Worker — My Employment detail** | No readiness banner; no compliance attention banner; Payroll card shows "Payroll setup is complete" and "Open Payroll Portal" if URL set; Compliance card only shows if there are required items that are incomplete/expired/expiring |

---

## 2. Onboarding incomplete → Onboarding

**Setup**

- At least one entity employment with status **onboarding**
- Onboarding pipeline has at least one step not complete (or step count complete < total)

**Expected**

| Where | Result |
|-------|--------|
| **Admin — Employment tab** | Readiness: **Onboarding** (blue chip), reason "Complete onboarding to start working" |
| **Worker — My Employment detail** | Readiness banner (info): **"Complete onboarding to start working"**; Onboarding progress card visible with step summaries |

---

## 3. Payroll incomplete → Not ready

**Setup**

- At least one active or onboarding employment
- Entity has payroll configured (e.g. TempWorks) and worker has a payroll account with status **not_started**, **invite_sent**, **account_created**, or **in_progress**
- No compliance blockers (no required expired, no payroll blocked)

**Expected**

| Where | Result |
|-------|--------|
| **Admin — Employment tab** | Readiness: **Not ready** (gray chip), reason "Payroll setup incomplete" |
| **Worker — My Employment detail** | Readiness banner: **"Some items need to be completed"**; Payroll card shows status (e.g. "Not started", "Invite sent") and "Open Payroll Setup" if URL set |

---

## 4. Expired required compliance item → Blocked

**Setup**

- At least one active or onboarding employment
- At least one **required** compliance item with status **expired** or **expiresAt** in the past (for a type with expiration, e.g. work permit, driver’s license)

**Expected**

| Where | Result |
|-------|--------|
| **Admin — Employment tab** | Readiness: **Blocked** (red chip), reason e.g. "Work permit expired"; compliance warning alert if any expired/expiring items |
| **Admin — Compliance tab** | Alert: "Some compliance items have expired"; table row(s) with red left border and Expired status |
| **Worker — My Employment detail** | Readiness banner (error): **"You are not eligible to work right now"**; compliance banner: **"Action required: some of your documents need attention."**; Compliance card lists item(s) with **Expired** chip |

---

## 5. Expiring-soon required item → At risk

**Setup**

- At least one active or onboarding employment
- No required items expired; no payroll blocked
- At least one **required** compliance item with **expiresAt** within the next 30 days (and not past)

**Expected**

| Where | Result |
|-------|--------|
| **Admin — Employment tab** | Readiness: **At risk** (yellow chip), reason e.g. "Driver’s license expires soon" |
| **Admin — Compliance tab** | Warning alert: "Some items will expire within 30 days"; table row(s) with yellow left border and expiring-soon indicator |
| **Worker — My Employment detail** | Readiness banner (warning): **"Some items need attention soon"**; compliance banner: **"Some documents will expire soon."**; Compliance card lists item(s) with **Expiring soon** chip |

---

## 6. No active/onboarding employment → Not ready

**Setup**

- No entity employments, **or**
- All entity employments have status **inactive** or **terminated**

**Expected**

| Where | Result |
|-------|--------|
| **Admin — Employment tab** | If no records: info message "No entity employment records yet…". If only inactive/terminated: Readiness **Not ready**, reason "No active or onboarding employment" |
| **Worker — My Employment list** | Empty state: "You don’t have any employment records yet…" or list shows only inactive/terminated; Worker — My Employment detail only reachable per employment, so N/A for "no employment" |

---

## Label and copy checks

- **Admin:** Readiness chip shows **Ready** / **Onboarding** / **At risk** / **Blocked** / **Not ready** (no raw `not_ready`, `at_risk`).
- **Admin:** Employment status chips show **Onboarding**, **Active**, **Inactive**, **Terminated** (or Active Employee / Active Contractor where applicable).
- **Admin:** Compliance table Status column shows **Complete**, **Expired**, **Pending**, etc. (no raw `complete`, `expired`).
- **Admin:** Payroll block shows **Not started**, **Invite sent**, **Complete**, etc. (no raw enums).
- **Worker:** Same friendly labels on Payroll and Compliance cards; readiness and document banners use the exact copy above (no jargon).

---

## Edge cases to spot-check

- **Payroll blocked:** Entity has payroll; worker payroll account status = **blocked** → Readiness **Blocked**, reason "Payroll setup blocked".
- **Multiple reasons:** e.g. one expired item + payroll incomplete → Readiness **Blocked** (expired wins), reasons list the expired item(s).
- **Worker with no compliance items:** Compliance card hidden; no compliance banner; readiness driven by employment + onboarding + payroll only.
- **Worker with no payroll configured for entity:** No Payroll card on worker detail; readiness not penalized for payroll for that employment.

---

## Sign-off

- [ ] Scenario 1 — Ready
- [ ] Scenario 2 — Onboarding
- [ ] Scenario 3 — Payroll incomplete → Not ready
- [ ] Scenario 4 — Expired compliance → Blocked
- [ ] Scenario 5 — Expiring soon → At risk
- [ ] Scenario 6 — No active employment → Not ready
- [ ] Labels and copy (admin + worker) match spec
- [ ] No raw enums or internal jargon in UI
