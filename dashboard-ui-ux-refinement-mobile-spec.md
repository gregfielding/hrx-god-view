
# HRX Dashboard — UX Refinement & Mobile Responsive Spec  
_Last updated: Jan 4, 2026_

## 🎯 Goal
Improve overall usability, spacing, readability, and interaction consistency across the **Dashboard widgets**:

1. Master Feed  
2. Calendar (Today‑first view)  
3. To‑Dos  
4. Global Quick Actions toolbar  

The experience must feel **calm, clean, enterprise‑ready, and mobile‑friendly.**  

---

# 1️⃣ Global Layout & Spacing Standards

## Spacing Scale (Design Token Recommendation)
```
4px   → micro spacing (icons, chip gaps)
8px   → compact padding
12px  → tighter internal spacing
16px  → base spacing
24px  → card padding
32px  → section spacing
```

### Apply Consistently Everywhere
✔ Card padding → **24px**  
✔ Page section spacing → **32px**  
✔ Table row minimum height → **56–64px**  
✔ Text line height → **1.5**  
✔ Rounded corners → **12px**  

---

## Typography Rules
| Element | Size | Weight |
|--------|------|--------|
| Page Title | 22–24px | 600 |
| Section Header | 16–18px | 600 |
| Table Text | 14–15px | 400 |
| Metadata text | 13–14px | 400 |

Use spacing — not borders — to separate.

---

## Dashboard Grid Layout

### Desktop (≥ 1200px Wide)
```
|  Feed (8 cols)  |  Sidebar: Calendar + To‑Dos (4 cols)  |
```
Feed is **primary**. Sidebar = utility.

### Tablet (768–1199px)
```
Feed full‑width
Sidebar stacked below
```

### Mobile (≤ 767px)
```
Tabs:
Feed | Calendar | To‑Dos
```
Each widget becomes a full‑screen panel.

---

# 2️⃣ Master Feed — UX Enhancements

## Purpose
Provide a **single chronological activity stream** that is fast to scan and easy to act on.

---

## Standard Feed Row Layout

```
[Icon]  [Title + Snippet stacked]                 [Time + Quick Actions]
```

### Row Content Rules
**Title**
- Bold
- Single line max

**Snippet**
- Muted text
- Max 2 lines before truncation

**Metadata = Small Chips**
Examples:
```
Email • Slack • System • Candidate • CRM
```

---

## Row Size & Alignment

| Property | Value |
|--------|-------|
| Row height | 56–64px |
| Left padding | 16px |
| Between content & icon | 12–16px |
| Text line height | 1.5 |
| Timestamp alignment | right |

---

## Hover & Interaction Rules

### Hover
Row highlights subtly

### Shown on hover:
🗨 Reply / Open Thread  
✔ Mark Complete  
🔔 Snooze  
➡ Open Drawer (default click)

### Click
Always opens in Universal Drawer

### Keyboard Support
```
Enter → open
Space → mark complete (task rows)
Up/Down → navigate
Esc → close drawer
```

---

## Time Grouping Headers
```
Now
Earlier Today
Yesterday
This Week
Older
```
These improve scannability.

---

## Feed Items Included Today
✔ Email  
✔ Slack DMs  
✔ Slack Channels where:
- user is a **member**
- channel is **not muted**

---

# 3️⃣ Calendar — Today‑First UX

## Replace Month View With:
### **Today Panel (Recommended Default)**

```
Today — Jan 4

🕘 9:00 AM  Sales Standup
📞 11:30 AM Client Call — Arcil
📨 1:00 PM  Interview — Jane Doe

+ Add Event
```

---

## Optional Toggle
```
Today • Week • Month
```
Default = **Today**

---

## Interaction Rules
✔ Click event → open in Drawer  
✔ Can add event from today view  
✔ Past‑today events fold under **Earlier Today**

---

## Mobile Calendar Behavior
- Always starts in **Today view**
- List‑style agenda
- Swipe to move days
- Floating CTA: `+ Event`

---

# 4️⃣ To‑Dos — Simplify & Focus

## Goal
Help users **take action quickly — not manage UI.**

---

## Row Layout

```
[ ] Title
    Due: Today • Priority: Medium • Assigned: Greg
```

---

## Interaction Rules

### Click Row
Opens full task in Drawer

### Checkbox
Toggles complete

### Keyboard
```
Enter = open
Space = complete
```

---

## Grouping
```
Overdue
Today
Upcoming
Completed (collapsed by default)
```

---

## Row Sizing
- Minimum height = **52–56px**
- Metadata muted and secondary

---

# 5️⃣ Global Quick Actions Toolbar

Group buttons into simple categories:

```
Candidates
CRM
Tasks
System
```

Spacing is more important than button count.

Button style recommendation:
- Pill buttons
- Icon + label
- Even spacing

---

# 6️⃣ Universal Drawer — Required Behavior

Any click on:
✔ Feed item  
✔ Calendar event  
✔ Task  
✔ Slack message  
✔ Email  

→ Opens the corresponding Drawer view.

User should rarely leave Dashboard.

---

# 7️⃣ Real‑Time Updating
All widgets should update using Firestore:

```
onSnapshot
```

No refresh required.

---

# 8️⃣ Mobile‑Responsive Rules (Critical)

## Navigation Pattern
Use tabs:
```
Feed | Calendar | To‑Dos
```

---

## Feed on Mobile
- Full‑width cards
- Swipe to reveal actions (future enhancement)
- Timestamp moves under title

---

## Calendar Mobile
- Default to Today list view
- “Add Event” → floating CTA bottom right
- Week view optional toggle

---

## To‑Dos Mobile
- Stacked layout
- Larger checkbox hit area
- Keep swipe potential in mind

---

# 9️⃣ Accessibility + Usability Requirements

✔ Min click target = **44px**  
✔ Color contrast = **WCAG AA**  
✔ Avoid tiny grey text  
✔ Keyboard accessible  
✔ Screen reader friendly labels  

---

# 🔟 Final Success Criteria

This UX pass is successful when users say:

> “It’s calm, readable, and I can run my day from here without thinking.”

---

# 🚀 Implementation Order for Devs

1. Apply spacing scale globally  
2. Standardize row sizes + fonts  
3. Implement Today‑first calendar  
4. Simplify To‑Do rows  
5. Add mobile behavior + tabs  
6. QA accessibility + keyboard flow  

---

_End of Spec_
