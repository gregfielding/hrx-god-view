# HRX — Unified Tasks Hub (My Work Page)

A single page where a user can see and manage every task assigned to them — across CRM, recruiting, onboarding, admin workflows, and Google Tasks sync.

---

## Objectives

- Centralize all tasks per user
- Support completion, snoozing, editing, and creation from one place
- Provide clear prioritization + reduce cognitive load
- Maintain links back to source objects
- Sync with Google Tasks when enabled

---

## Page Layout

Header → Filters → Task List → Floating Add Button

Sections auto‑group:

- Overdue
- Today
- Upcoming (next 14 days)
- Snoozed
- Completed (collapsed)

---

## Filters

- Status
- Priority
- Type
- Assigned By
- Due Window
- Source Object
- Search

---

## Task Card Format

Title
Linked Object + Source
Due + Priority
Badges: Scheduled / Recurring / Synced
Actions: Complete / Snooze / Edit / Menu

---

## Creation Modal

Fields include title, description, assignment, due date, recurring, priority, links, sync toggle, notifications.

---

## Firestore Model (Suggested)

- id
- title
- description
- assignedToUserId
- createdByUserId
- dueDate
- completedAt
- snoozedUntil
- priority
- status
- sourceType
- sourceId
- category
- recurringRule
- googleTaskId
- createdAt
- updatedAt

---

## Hooks

useMyTasks
useTaskMutations
useTaskFilters

---

## Behavior

Completing should be satisfying.
Snoozing removes stress.
Recurring regenerates cleanly.
Google sync stays in parity.

---

## Deep Links

/task/:taskId

---

## Mobile

Swipe complete / snooze

---

## Permissions

Workers → own tasks
Managers → team
Admins → org

---

## Phases

MVP → Productivity → Gamification

---

