# Unified Tasks Hub — Phase 1 Checklist

## 🎯 Goal
Ensure the Unified Tasks Hub is production-ready, polished, and provides a delightful user experience before broader rollout.

---

## ✅ Phase 1: Dogfood & QA (Critical — This Week)

### Core Functionality Testing

#### Task CRUD Operations
- [ ] **Create tasks from:**
  - [ ] Dashboard widget
  - [ ] Deal page (CRM)
  - [ ] Contact page (CRM)
  - [ ] Unified Tasks Hub (`/tasks`)
  - [ ] Verify task appears in correct group (Today/Upcoming/Overdue)

- [ ] **Complete tasks from:**
  - [ ] Dashboard widget
  - [ ] Deal page
  - [ ] Unified Tasks Hub
  - [ ] Verify real-time update across all views
  - [ ] Verify task moves to "Completed" group
  - [ ] Verify uncomplete works correctly

- [ ] **Snooze tasks:**
  - [ ] Test "Later Today" option
  - [ ] Test "Tomorrow" option
  - [ ] Test "Next Week" option
  - [ ] Test "Custom Date" option
  - [ ] Verify snoozed tasks disappear from active groups
  - [ ] Verify snoozed tasks appear in "Snoozed" group
  - [ ] Verify tasks automatically unsnooze when date arrives

- [ ] **Edit tasks:**
  - [ ] Edit from Unified Tasks Hub
  - [ ] Edit from task detail page (`/task/:taskId`)
  - [ ] Verify changes reflect in real-time across all views

- [ ] **Delete tasks:**
  - [ ] Delete from Unified Tasks Hub
  - [ ] Verify confirmation dialog
  - [ ] Verify task disappears from all views

#### Data Consistency & Real-time Updates
- [ ] **Group counts accuracy:**
  - [ ] Overdue count matches actual overdue tasks
  - [ ] Today count matches tasks due today
  - [ ] Upcoming count matches future tasks (next 14 days)
  - [ ] Snoozed count matches snoozed tasks
  - [ ] Completed count matches completed tasks

- [ ] **Real-time synchronization:**
  - [ ] Open Unified Tasks Hub in two browser tabs
  - [ ] Complete task in one tab → verify updates in other tab
  - [ ] Create task in one tab → verify appears in other tab
  - [ ] Snooze task in one tab → verify updates in other tab

#### Deep Linking
- [ ] **Task detail page (`/task/:taskId`):**
  - [ ] Navigate from Dashboard feed (if tasks appear in feed)
  - [ ] Navigate from Deal page task list
  - [ ] Navigate from Unified Tasks Hub
  - [ ] Verify task loads correctly
  - [ ] Verify "Back to Tasks" button works
  - [ ] Verify edit functionality from detail page

#### Mobile Experience
- [ ] **Responsive layout:**
  - [ ] Test on mobile viewport (375px width)
  - [ ] Test on tablet viewport (768px width)
  - [ ] Verify all task groups are accessible
  - [ ] Verify filters collapse properly on mobile
  - [ ] Verify floating "Add" button is accessible
  - [ ] Verify tap targets are at least 44px
  - [ ] Verify scrolling works in each group
  - [ ] Verify task cards are readable on small screens

#### Edge Cases
- [ ] **Empty states:**
  - [ ] No tasks assigned → shows helpful empty state
  - [ ] All tasks completed → completed section shows correctly
  - [ ] All tasks snoozed → snoozed section shows correctly

- [ ] **Filter edge cases:**
  - [ ] Apply multiple filters simultaneously
  - [ ] Clear all filters → returns to default view
  - [ ] Search with no results → shows appropriate message
  - [ ] Filter by non-existent source → handles gracefully

- [ ] **Date/time edge cases:**
  - [ ] Tasks with no due date → appear in "Upcoming"
  - [ ] Tasks with past due dates → appear in "Overdue"
  - [ ] Tasks due exactly today → appear in "Today"
  - [ ] Timezone handling (if applicable)

---

## 🎨 Phase 1: UX Polish (High Impact — This Week)

### Keyboard Shortcuts
- [ ] **Quick add:**
  - [ ] When search box is focused and empty, pressing `N` opens "New Task" modal
  - [ ] Add visual hint (tooltip or placeholder text: "Press 'N' to add task")

### Visual Feedback
- [ ] **Complete animation:**
  - [ ] When task is completed, add smooth fade-out/slide animation
  - [ ] Animation duration: ~300ms
  - [ ] Task should smoothly transition to completed state before moving to group

- [ ] **Loading states:**
  - [ ] Show skeleton loaders while tasks are loading
  - [ ] Show loading spinner during mutations (complete, snooze, delete)

### Smart Defaults
- [ ] **Initial filter state:**
  - [ ] On first load: Show only active tasks (hide Completed)
  - [ ] Default view: Overdue + Today + Upcoming visible
  - [ ] Completed section collapsed by default

- [ ] **Filter persistence:**
  - [ ] Remember last filter state in localStorage
  - [ ] Restore filters on page reload
  - [ ] Clear filters button resets to defaults

### Task Card Enhancements
- [ ] **Hover states:**
  - [ ] Subtle elevation increase on hover
  - [ ] Smooth transitions

- [ ] **Priority visual hierarchy:**
  - [ ] Overdue tasks have subtle red border or background tint
  - [ ] High priority tasks stand out visually
  - [ ] Completed tasks are visually de-emphasized (opacity, strikethrough)

---

## 🔄 Phase 1: Google Tasks Sync (Optional — Nice to Have)

### Sync Badge & Status
- [ ] **Visual indicators:**
  - [ ] Add "Synced to Google Tasks" badge on synced tasks
  - [ ] Add tooltip: "View in Google Tasks" with link
  - [ ] Show sync status icon (synced/pending/failed)

### Backend Sync Logic
- [ ] **One-way sync (HRX → Google):**
  - [ ] When task is created → sync to Google Tasks
  - [ ] When task is updated → update Google Tasks
  - [ ] When task is completed → mark complete in Google Tasks
  - [ ] Store `googleTaskId` in task document

- [ ] **Prevent infinite loops:**
  - [ ] Add `externalSourceId` field to track Google Tasks ID
  - [ ] Skip sync if task was created from Google Tasks
  - [ ] Add sync timestamp to prevent duplicate syncs

### Sync Settings
- [ ] **User preference:**
  - [ ] Add toggle in Settings: "Sync tasks to Google Tasks"
  - [ ] Per-task override: "Don't sync this task"

---

## 📊 Phase 1: Basic Analytics (Optional — Can Defer)

### Event Logging
- [ ] **Track key events:**
  - [ ] `taskCreated` — when task is created
  - [ ] `taskCompleted` — when task is marked complete
  - [ ] `taskSnoozed` — when task is snoozed
  - [ ] `taskDeleted` — when task is deleted
  - [ ] `taskEdited` — when task is edited

### Logging Implementation
- [ ] **Firestore collection: `taskEvents`:**
  - [ ] Document structure: `{ userId, taskId, eventType, timestamp, metadata }`
  - [ ] Write events via Cloud Function or client-side (with security rules)

### Future: Dashboard Summary Card
- [ ] **Weekly summary (Phase 2):**
  - [ ] "You completed X tasks this week 🎉"
  - [ ] "Y overdue tasks need attention"
  - [ ] "Z tasks due today"

---

## 📚 Phase 1: Task Templates (Optional — Can Defer)

### Template System
- [ ] **Create template collection:**
  - [ ] Firestore: `tenants/{tenantId}/taskTemplates`
  - [ ] Template fields: `title`, `description`, `type`, `category`, `priority`, `defaultDuration`

- [ ] **Common templates:**
  - [ ] "New lead follow-up" (email, high priority, follow_up category)
  - [ ] "Send proposal" (custom, high priority, proposal category)
  - [ ] "Check-in 30 days post start" (phone_call, medium priority, follow_up category)
  - [ ] "Schedule demo" (scheduled_meeting_virtual, high priority, demo category)
  - [ ] "Research company" (research, medium priority, prospecting category)

### Template UI
- [ ] **Quick-add dropdown:**
  - [ ] In "New Task" modal, add "Use Template" dropdown
  - [ ] Selecting template pre-fills form fields
  - [ ] User can still edit pre-filled fields

---

## 🐛 Known Issues to Fix

### High Priority
- [ ] Verify Firestore query indexes are created for:
  - [ ] `assignedTo` + `scheduledDate` composite index
  - [ ] `assignedTo` + `status` composite index (if filtering by status)
  - [ ] `assignedTo` + `priority` composite index (if filtering by priority)

- [ ] **Performance:**
  - [ ] Test with 100+ tasks assigned to user
  - [ ] Verify grouping logic is performant
  - [ ] Verify filters don't cause excessive re-renders

### Medium Priority
- [ ] **Error handling:**
  - [ ] Network errors show user-friendly messages
  - [ ] Permission errors are handled gracefully
  - [ ] Failed mutations show retry option

- [ ] **Accessibility:**
  - [ ] Keyboard navigation works (Tab, Enter, Escape)
  - [ ] Screen reader labels on interactive elements
  - [ ] Color contrast meets WCAG AA standards

---

## 🎬 Phase 1 Deliverables

### Must Have (Before Launch)
- ✅ All Core Functionality Testing items completed
- ✅ All Mobile Experience items verified
- ✅ All Edge Cases tested
- ✅ Keyboard shortcut for quick add (`N`)
- ✅ Complete animation
- ✅ Smart default filters
- ✅ Filter persistence

### Nice to Have (Can Launch Without)
- 🔹 Google Tasks sync
- 🔹 Analytics/logging
- 🔹 Task templates
- 🔹 Weekly summary card

---

## 📝 Testing Notes Template

For each test case, document:
- **Test Date:** 
- **Tester:** 
- **Result:** Pass / Fail / Needs Fix
- **Notes:** 
- **Screenshots:** (if applicable)

---

## 🚀 Post-Phase 1: Future Enhancements

### Phase 2 Ideas
- Bulk actions (complete multiple, delete multiple)
- Recurring task generator
- Task dependencies
- Task comments/notes
- Task attachments
- Team task views (for managers)
- Task analytics dashboard
- Mobile swipe gestures (swipe to complete/snooze)

---

**Last Updated:** [Current Date]
**Status:** Phase 1 In Progress

