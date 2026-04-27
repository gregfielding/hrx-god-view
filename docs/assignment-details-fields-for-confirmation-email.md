# Assignment Details – Fields and Conditional Displays (for Confirmation Email)

This document lists every field and section shown on the worker Assignment Details page (`/c1/workers/assignments/:assignmentId`). Use this list to ensure the same fields (and conditional logic) are included in the email sent to the worker upon assignment confirmation.

**Page URL pattern:** `http://localhost:3000/c1/workers/assignments/{assignmentId}`

---

> **IMPORTANT — Keep in sync:**  
> Whenever you add **new data, fields, or sections** to the Assignment Details layout (e.g. in `src/pages/AssignmentDetails.tsx`), you must:
> 1. **Update this markdown file** — add the new field(s) or section(s) here with label, data source, format, and any conditional logic.
> 2. **Update the confirmation email** — include the same field(s)/section(s) in the email sent to the worker upon assignment confirmation.
>
> This keeps the worker’s in-app view and the confirmation email consistent.

---

## 1. Header (always shown when assignment loads)

| Field | Description | Format / Notes |
|-------|-------------|----------------|
| **Assignment status** | Status of the assignment (e.g. Confirmed, Proposed, Active, Cancelled) | Capitalized; displayed as a chip. Values: proposed, confirmed, active, cancelled/canceled, declined, completed, etc. |

---

## 2. Assignment Info card (always shown)

All 8 fields are always present; use a placeholder (e.g. "—" or omit line) when value is missing.

| # | Field label | Data source | Format / Conditional |
|---|-------------|-------------|----------------------|
| 1 | **Job Title** | `assignment.jobTitle` | Plain text. Fallback: "—". |
| 2 | **Start Date** | `assignment.startDate` | Formatted: "MMMM dd, yyyy" (e.g. February 15, 2026). Fallback: "—". |
| 3 | **Pay Rate** | `assignment.payRate` | Formatted: "$X/hr". Fallback: "—". |
| 4 | **Company Name** | Resolved from CRM company doc when assignment has `companyId` and name is missing or looks like an ID; else `assignment.companyName` | Plain text. Fallback: "—". |
| 5 | **Worksite name** | Resolved from CRM/location doc when assignment has `worksiteId` and name is missing or ID-like; else `assignment.worksiteName` or `assignment.location` | Plain text. Fallback: "—". |
| 6 | **Worksite address** | Resolved from location doc (`address`, `street`, `city`, `state`, `zipCode`/`zipcode`); else `assignment.worksiteAddress` (street/address, city, state, zipCode) | Full one-line address. In UI this is a map link; in email can be plain text or link. Fallback: "—". |
| 7 | **Required uniform** | `assignment.uniformRequirements` (job order pack, e.g. "Business Casual") + `assignment.customUniformRequirements` (free text) | Both concatenated with double newline if both present. Pre-wrap for line breaks. Fallback: "—". |
| 8 | **Required PPE** | `assignment.ppeRequirements` | Plain text (may be comma-separated if from array). Fallback: "—". |

---

## 3. My Schedule card (always shown)

Structure depends on shift type (multi-day with weekly schedule vs single-day). Include only the branches that apply.

### 3a. When shift is multi-day with weekly schedule

(`scheduleShift.shiftMode === 'multi'` and `scheduleShift.weeklySchedule` has entries)

| Field | Description | Format |
|-------|-------------|--------|
| **Weekly schedule** | List of days and times | For each day of week (Mon–Sun) where `enabled`: "Day: start – end" (e.g. "Monday: 9:00 AM – 5:00 PM"). Times from `weeklySchedule[dow].startTime`, `endTime` formatted as "h:mm a". |
| **Start date** | Assignment start date | Only if `assignment.startDate`. Format: "MMMM dd, yyyy". |
| **End date** | Assignment or shift end date | **Conditional:** Only for **gig** when `assignment.endDate` or `scheduleShift.endDate` exists. Format: "MMMM dd, yyyy". |
| **Duration** | Ongoing indicator | **Conditional:** Only for **career** when there is no end date. Display: "Ongoing". |

### 3b. When shift is single-day or no weekly schedule

| Field | Description | Format |
|-------|-------------|--------|
| **Date** | Assignment start date | Only if `assignment.startDate`. Format: "MMMM dd, yyyy". |
| **Time** | Start and end time | Only if any of: `assignment.startTime`, `assignment.endTime`, `scheduleShift.defaultStartTime`, `scheduleShift.defaultEndTime`. Format: "9:00 AM – 5:00 PM". |
| **End date** | Assignment end date | Only if `assignment.endDate`. Format: "MMMM dd, yyyy". |
| **No schedule details** | Empty state | **Conditional:** Only when there is no start date, no start/end time, and no default times. Display: "No schedule details available." |

### 3c. Schedule card – optional sections (only if content exists)

| Field | Condition | Format |
|-------|-----------|--------|
| **Shift-Specific Details or Job Description** | `scheduleShift.shiftDescription` is non-empty (trimmed) | Plain text; preserve line breaks (pre-wrap). |
| **Shift Info to Email Staff** | `scheduleShift.emailIntro` is non-empty (trimmed) | Plain text; preserve line breaks (pre-wrap). |

---

## 4. Staff Instructions (one block per section; only if section has content or attachments)

Each section below is **conditional**: include only if the section has **text** or **at least one file attachment**.

| Section title | Text source | Attachments source |
|----------------|-------------|--------------------|
| **First Day Instructions** | `assignment.staffInstructions.firstDay.text` | `assignment.staffInstructions.firstDay.files` |
| **Parking Instructions** | `assignment.staffInstructions.parking.text` | `assignment.staffInstructions.parking.files` |
| **Check-In Instructions** | `assignment.staffInstructions.checkIn.text` or `assignment.checkInInstructions` | `assignment.staffInstructions.checkIn.files` |
| **Uniform Instructions** | `assignment.staffInstructions.uniform.text` | `assignment.staffInstructions.uniform.files` |
| **Credential Instructions** | `assignment.staffInstructions.credentials.text` | `assignment.staffInstructions.credentials.files` |
| **Other Instructions** | `assignment.staffInstructions.other.text` | `assignment.staffInstructions.other.files` |
| **Other Attachments** | (no text) | `assignment.staffInstructions.attachments.files` (section shown only if there are files) |

For each section that is included:

- **Text:** Plain text; preserve line breaks.
- **Attachments:** List of files. Each file has `url`, and `label` or `name` (display as link or "View File").

---

## 5. Additional Notes (conditional)

| Field | Condition | Format |
|-------|-----------|--------|
| **Additional Notes** | `assignment.notes` is non-empty | Plain text; preserve line breaks. |

---

## 6. Metadata (conditional)

Include only if at least one of the following is present:

| Field | Source | Format |
|-------|--------|--------|
| **Created** | `assignment.createdAt` | "Created: MMMM dd, yyyy, h:mm a" |
| **Last Updated** | `assignment.updatedAt` | "Last Updated: MMMM dd, yyyy, h:mm a" |

---

## 7. My Recruiter (sidebar; include in email as a section)

| Content | Condition | Format |
|---------|-----------|--------|
| **Recruiter(s)** | `recruiters.length > 0` (from job order `assignedRecruiters` or `recruiterId`, then user docs for name/phone/email) | For each recruiter: **Name** (bold), **Phone** (optional, link to SMS), **Email** (optional, link to mailto). |
| **Empty state** | No recruiters assigned | "No recruiter assigned to this job order. Reach out via Inbox if you need support." |

---

## Data sources summary (for email implementation)

- **Assignment doc:** `tenants/{tenantId}/assignments/{assignmentId}` (or from job order when loaded via `loadFromJobOrder`).
- **Shift doc (for schedule, shiftDescription, emailIntro):** `tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}`.
- **Company name (lookup):** `tenants/{tenantId}/crm_companies/{companyId}` → `name` or `companyName`.
- **Worksite name & address (lookup):** `tenants/{tenantId}/crm_companies/{companyId}/locations/{worksiteId}` or `tenants/{tenantId}/locations/{worksiteId}` → street from `address` or `street`; city, state, zip from `city`, `state`, `zipCode`/`zipcode`; name from `nickname`, `title`, `name`, `locationName`.
- **Recruiters:** Job order `assignedRecruiters` or `recruiterId` → user docs `users/{uid}` for `firstName`, `lastName`, `displayName`, `email`, `phone`/`phoneNumber`/`phoneE164`.

---

## Formatting reference

- **Date:** `MMMM dd, yyyy` (e.g. February 15, 2026).
- **DateTime:** `MMMM dd, yyyy, h:mm a` (e.g. February 15, 2026, 9:00 AM).
- **Time (HH:mm → display):** Convert to "h:mm a" (e.g. 09:00 → "9:00 AM", 17:00 → "5:00 PM").
- **Pay rate:** `$X/hr` (number).
- **Placeholder when empty:** "—" or omit the line in email.
