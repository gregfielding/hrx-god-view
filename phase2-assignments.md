# Phase 2 · Packet 2.2 — Assignments & Scheduling

This spec defines the second major recruiter workflow: moving from **Application → Assignment** and tracking scheduled work. It extends the Phase 1.5 foundation while keeping compatibility with the Firestore multi-tenant structure.

---

## 🎯 Goals
- Allow recruiters to **convert Applications into Assignments**.
- Track assignments per Job Order and per Candidate.
- Support **status lifecycle** (proposed → confirmed → active → completed → ended → canceled).
- Provide early support for **shift templates** and **timesheets** (minimal schema, more later).

---

## 📂 Firestore Structure
```
tenants/{tenantId}
  job_orders/{jobOrderId}
    assignments/{assignmentId}
      applicationId?       // link if sourced from an application
      candidateId          // required
      status               // proposed | confirmed | active | completed | ended | canceled
      startDate            // ISO date
      endDate?             // optional, blank if indefinite
      payRate              // decimal, tenant currency
      billRate             // decimal, tenant currency
      worksite             // ref to company_locations/{id}
      shiftTemplateId?     // optional
      timesheetMode        // mobile | kiosk | paper
      createdBy            // userId
      createdAt            // timestamp
      notes                // text

  shift_templates/{templateId}  // optional, referenced by assignments
    jobOrderId?
    name
    daysOfWeek[]               // e.g., [Mon,Tue,Wed]
    startTime, endTime
    breakRules?                 // JSON blob

  timesheets/{timesheetId}      // minimal stub for now
    assignmentId
    periodStart, periodEnd
    entries[]                   // [{date,in,out,breaks}]
    submittedBy
    approvedBy?
    status
```

---

## 🔑 Firestore Rules
```javascript
match /tenants/{tenantId}/job_orders/{jobOrderId}/assignments/{assignmentId} {
  allow read: if request.auth.token.tenantId == tenantId;
  allow create, update: if isRecruiterOrAdmin(tenantId);
  allow delete: if isAdmin(tenantId);
}
```
- Recruiters/Admins can create + update.
- Non-admins can only change `status` after assignment is `active`.
- Tenant isolation strictly enforced.

---

## 🖥️ UI Requirements
### Job Order → Assignments Tab
- **List View**
  - Columns: Candidate, Status, Start, End, Worksite, Pay, Bill, Notes
  - Filters: by status, by recruiter
  - Inline actions: edit, end, cancel

- **Create Assignment**
  - Button: "Convert from Application" (prefills candidate + link)
  - Button: "Create Assignment Manually"
  - Form fields: Candidate (search), Start/End, Pay/Bill, Status, Worksite, Shift template, Timesheet mode

- **Detail View**
  - Tabs: Overview, Timesheets (stub), Activity
  - Inline status editing

### Calendar View (read-only)
- Display confirmed + active assignments on a week grid
- Based on shift templates if present

---

## ⚙️ Logic
- **Auto-Fill Job Order Status**
  - When first `active` assignment created → Job Order `status=Filled` if headcount met.
  - When all assignments ended/canceled → Job Order `status=Completed` if `endDate` past.

- **Timesheet Stub**
  - Add empty tab + Firestore path for future expansion.
  - Current MVP: recruiter can view timesheet doc if exists.

- **Candidate Handling**
  - If converting from Application: ensure Candidate record exists. If not, auto-create Candidate with core info.

---

## 📊 Indexes
- `job_orders/{jobOrderId}/assignments` by `status`
- Global `assignments` collection group index:
  - by `candidateId + status`
  - by `tenantId + jobOrderId`

---

## 🧪 QA Checklist
- Create assignment manually → appears in Job Order tab.
- Convert Application → auto-links and creates Candidate if missing.
- Status transitions enforced by rules.
- Job Order headcount → auto status update when filled.
- Calendar view renders assignments correctly.
- Queries under 200ms with index support.

---

## 🚀 Deliverables for Cursor
1. Firestore subcollection + rules for assignments.
2. UI Tab: Assignments (list + detail).
3. Convert-from-Application workflow.
4. Calendar view component.
5. Candidate auto-create logic.
6. Index definitions for Firestore.

---

## 📌 Future Extensions (Phase 3)
- Full timesheet entry + approval.
- Bulk assignment creation from groups.
- Shift swap / replacement logic.
- Notifications for candidate status changes.
