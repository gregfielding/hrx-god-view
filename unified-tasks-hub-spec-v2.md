# Unified Tasks Hub — Cursor-Ready Implementation Spec (v2)

This document defines the design + build specification for the **Unified Tasks Hub** — a single page where internal team users manage all assigned tasks across CRM, Recruiting, Onboarding, Admin, and Google Tasks.

This spec is actionable and ready for Cursor.

---

## 🎯 Goals

Give every team member **one mission‑control page** to:
- View all tasks assigned to them
- Complete work quickly
- Snooze + reschedule work
- Filter by urgency, source, status, and more
- Create or edit tasks
- See linked context (deal, client, candidate, etc.)

This makes daily execution **simpler, calmer, and more productive**.

---

## 🧠 Core Concepts

### 🟦 Unified Task Model (`UnifiedTask`)

All tasks — regardless of origin — are normalized into a single schema.

File: `src/types/UnifiedTask.ts`

```ts
export type TaskSourceType =
  | 'crm'
  | 'recruiting'
  | 'onboarding'
  | 'admin'
  | 'google_tasks';

export interface UnifiedTask {
  id: string;
  title: string;
  description?: string;

  dueDate?: Timestamp | null;
  completed: boolean;
  completedAt?: Timestamp | null;

  priority: 'low' | 'medium' | 'high';
  type: string;
  category?: string;

  assignedTo: string;

  sourceType: TaskSourceType;
  sourceId?: string;
  sourceName?: string;

  recurring?: boolean;
  scheduled?: boolean;
  synced?: boolean;

  snoozedUntil?: Timestamp | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## 📡 Data Sources

Tasks may originate from:

| System | Examples |
|-------|---------|
| CRM | Follow‑ups, meeting prep |
| Recruiting | Candidate actions |
| Onboarding | New hire workflow |
| Admin Ops | Internal reminders |
| Google Tasks | External synced tasks |

All normalize → `UnifiedTask`

---

## 🧩 Hooks

### `useMyTasks()`

Real‑time fetch + transforms + grouping.

Returns:
```ts
{
  overdue: UnifiedTask[];
  today: UnifiedTask[];
  upcoming: UnifiedTask[];
  snoozed: UnifiedTask[];
  completed: UnifiedTask[];
  loading: boolean;
}
```

---

### `useTaskMutations()`

Supports:
- create
- update
- complete / uncomplete
- delete
- snooze / unsnooze

---

### `useTaskFilters()`

Manages:
- search
- status
- priority
- type
- source
- due window

Includes persistent state.

---

## 📄 Main Page
### `src/pages/UnifiedTasksPage.tsx`

Page sections:

```
Header — “My Tasks”
Search Bar
Filter Ribbon
Task Groups
Floating Add Button
```

---

## 🧱 Task Groups

### 🔴 Overdue
Past‑due + not completed

### 🔵 Today
Due today

### 🟢 Upcoming
Future‑dated tasks

### 🟡 Snoozed
Paused tasks

### ⚪ Completed
Collapsed by default

---

## 💬 Task Card Component

File: `components/tasks/UnifiedTaskCard.tsx`

Each card includes:
- Title
- Due date
- Priority chip
- Source badge
- Quick‑action buttons
- Check‑complete icon
- Context preview

#### ⚡ Quick Actions
- ✔ Complete
- ⏰ Snooze
- ✎ Edit
- 🗑 Delete

---

## 😴 Snooze Options

Default buttons:
- Later today
- Tomorrow
- Next week
- Custom date

Stores → `snoozedUntil`

Unsnoozes automatically when date arrives.

---

## 🧠 Filters

Filters include:
- Status
- Priority
- Type
- Category
- Source
- Date Range
- Text Search

---

## 🔗 Linked Objects

Examples:
- Deal
- Company
- Candidate

Shown inside card if present.

---

## 📱 Mobile Experience

Key rules:
- Cards stack vertically
- Swipe actions optional later
- Floating button always visible
- Filters collapse into drawer
- Search is sticky

---

## 🚀 MVP Deliverables Checklist

✓ Unified task model  
✓ Real‑time subscriptions  
✓ Snooze logic  
✓ Status grouping  
✓ Filters  
✓ Task create / edit modal  
✓ Quick complete / delete  
✓ Linked context  
✓ Mobile‑ready layout  

---

## 🌟 Future Enhancements

🔹 Bulk actions  
🔹 Recurring generator  
🔹 Google Tasks sync  
🔹 Keyboard shortcuts  
🔹 Smart task suggestions  

---

## 🎨 Design Guidance

Tone = **calm, focused, supportive**

Avoid loud colors. Emphasize clarity.

Green = complete  
Blue = active / neutral  
Red = overdue  
Yellow = snoozed  

---

## 🧪 Testing Requirements

Scenarios:
✔ overdue sorting  
✔ timezone edge cases  
✔ snooze behavior  
✔ task editing  
✔ delete flow  
✔ multiple filters applied simultaneously  
✔ mobile breakpoints  

---

## 🛡 Permissions

Users see ONLY tasks assigned to them.

Admins may receive a dashboard view later.

---

## 📍 Routes

```
/tasks
/task/:taskId
```

---

## ✔ Acceptance Criteria

A user must be able to:

✅ See all tasks from every system  
✅ Complete tasks in seconds  
✅ Snooze distractions  
✅ Filter what matters  
✅ Search instantly  
✅ Add new tasks easily  
✅ Feel organized, not overwhelmed  

---

Built for: **HRX / C1 Platform**
