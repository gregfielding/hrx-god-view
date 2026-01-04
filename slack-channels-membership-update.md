# Slack Channels Page — Membership UI Conversion (Join/Leave + Members Column + Real-Time Sync)

## SCOPE GUARDRAILS — DO NOT EXCEED

Only modify what is explicitly listed below.

Allowed:
- Header filter chips
- New “Members” column
- Replace watch/star with Join / Leave
- Keep Mute
- Keep Admin-only Delete
- Real-time updates using Firestore onSnapshot

Not allowed:
- No refactors
- No architecture changes
- No visual redesign beyond what is described
- No backend rewrites
- No renaming routes
- No unrelated style changes

The goal is a **surgical UI update.**

---

## GOAL

Convert this page from a “Watched Channels” model to a **Membership model**, where users:

- Join a channel
- Leave a channel
- See who else is a member
- See updates instantly
- Still mute channels
- Admins still can delete channels

---

## HEADER — NEW FILTER BUTTONS

Replace existing filters with ONLY:

My Channels | All Channels                       [Search Field] [Sync button]

Rules:

- Default selection = My Channels
- My Channels = channels where current user is a member
- All Channels = everything
- Search and Sync continue working the same
- Only their position in the UI changes

---

## TABLE — ADD NEW “MEMBERS” COLUMN (2ND POSITION)

NEW COLUMN ORDER:

1. Channel
2. Members  ← NEW
3. Latest Activity
4. Linked To
5. Actions

### MEMBERS CELL RENDERING RULES

- Show up to **3 overlapping avatars**
- If more than 3 members exist, show `+N` after the avatars
- Existing avatar component must be used
- If there are zero members, show: `—`

Examples:

[AB][CD][EF] +4

or

[AB][CD]

or

—

Do not redesign the avatars — only reuse what already exists.

---

## ACTIONS COLUMN — NEW LOGIC

### REMOVE
- Watch
- Star

### ADD

When user is NOT a member:
Button text = Join

When user IS a member:
Button text = Leave

Button must disable while the action is processing.

### KEEP
Mute button — unchanged  

### ADMIN-ONLY DELETE BUTTON

Delete remains **but only visible if:**

currentUser.securityLevel >= 7

Everyone else should NOT see delete.

---

## REAL-TIME MEMBERSHIP UPDATES (REQUIRED)

The page **must update in real-time via Firestore onSnapshot.**

This includes:

- Member avatars
- Join/Leave button state
- My Channels list membership
- Member counts

Maintain state like:

membersByChannel[channelId] = MemberPreview[]
isMemberByChannel[channelId] = boolean

Unsubscribe on unmount.

---

## DATA MODEL — ASSUMED

Do NOT modify backend unless absolutely necessary.

Membership exists in:

slackChannelMembers

Fields assumed:

channelId  
userId  
joinedAt  

If backend provides:

memberCount  
memberPreview  

then UI can use it.

If not, compute it client-side only.

---

## PAGE STATE CONTRACT (HIGH LEVEL)

The Slack Channels page should maintain:

- list of channels
- list of memberships
- member preview lists

Then pass that into the table.

---

## JOIN / LEAVE BEHAVIOR REQUIREMENTS

### JOIN
- Create membership doc
- Disable button while pending
- Update UI when complete

### LEAVE
- Delete membership doc
- Disable button while pending
- Update UI when complete

### ERROR HANDLING
- Show toast or existing UI error
- Re-enable button
- Do NOT silently fail

---

## MOBILE VIEW REQUIREMENT

Mobile list view must:

- Also show avatars and +count
- Preserve CSS layout
- NOT be redesigned beyond fitting avatars logically

---

## EDGE CASES

Handle safely:

- Channels with zero members → show `—`
- Leaving channel removes it from “My Channels” immediately
- Joining adds it immediately
- Admin permissions update hides delete button dynamically
- Snapshots should never duplicate members

---

## PERFORMANCE RULES

- Snapshot listeners MUST unsubscribe on unmount
- Avoid loops triggering infinite snapshot updates
- Memoize filtered lists
- Avatar calculations should be lightweight

---

## TESTING CHECKLIST (DO NOT SKIP)

Cursor must ensure ALL of the following pass:

### FILTERING
[ ] My Channels shows only channels user belongs to  
[ ] All Channels shows all channels  
[ ] Search works normally  
[ ] Sync still works  

### JOIN / LEAVE
[ ] Join adds avatar instantly  
[ ] Leave removes avatar instantly  
[ ] My Channels updates instantly  
[ ] Buttons disable during action  

### ACTIONS
[ ] Mute still works  
[ ] Delete visible ONLY for securityLevel >= 7  

### REAL-TIME
[ ] Membership updates without refresh  
[ ] UI never freezes  
[ ] No stale data remains  
[ ] Button state correct if membership changes externally  

### MOBILE
[ ] Avatars render correctly  
[ ] No overlapping / broken layout  

---

## DO NOT CHANGE THESE

These must remain untouched unless absolutely required:

- Routing
- API method names
- Sync logic
- Theme engine
- General CSS layout system
- Firebase project config
- Authentication flows
- Slack integration logic

We only want UI and state behavior changes needed for membership.

---

## DELIVERABLE SUMMARY

Cursor should deliver:

- Join/Leave membership system
- My Channels filter behavior
- Members table column with avatars
- Real-time updates
- Admin delete permissions
- Zero side-effects outside this page

This change set must be:

- Minimal
- Localized
- Reversible
- Well-structured
- Real-time driven

---

END OF FILE
