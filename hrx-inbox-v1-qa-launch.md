# HRX Inbox v1 - QA Launch Checklist

## Overview
This document outlines the comprehensive QA testing checklist for HRX Inbox v1 launch. The inbox includes email threading, contact linking, search functionality, and Gmail integration.

**Last Updated**: 2025-01-XX  
**Version**: 1.0  
**Status**: Ready for QA

---

## 1. Core Email Functionality

### 1.1 Email Thread Loading
- [ ] **Inbox loads email threads successfully**
  - [ ] Threads appear in the inbox table
  - [ ] Loading spinner shows during fetch
  - [ ] Error handling works if API fails
  - [ ] Empty state displays when no emails exist

- [ ] **Thread pagination works**
  - [ ] "Rows per page" dropdown functions
  - [ ] Page navigation arrows work
  - [ ] Page numbers update correctly
  - [ ] Total count displays accurately

- [ ] **Thread sorting**
  - [ ] Threads sorted by most recent first (lastMessageAt descending)
  - [ ] Sorting persists across page refreshes

### 1.2 Email Thread Display
- [ ] **Thread row displays correctly**
  - [ ] Avatar shows with correct initials
  - [ ] Sender name displays (contact name or formatted email)
  - [ ] Company name displays below sender (if available)
  - [ ] Subject line displays with thread count `(3)` for multi-message threads
  - [ ] Preview snippet displays (sanitized, truncated)
  - [ ] Date displays in correct format (Today, Yesterday, or date)
  - [ ] Unread indicator (blue dot) shows for unread threads
  - [ ] Star icon shows for starred threads

- [ ] **Unread styling**
  - [ ] Unread threads have soft background tint (#F6F8FB)
  - [ ] Unread threads have left border accent (blue)
  - [ ] Unread subject text is semibold
  - [ ] Hover state darkens background slightly (#E8EDF5)

- [ ] **Row interactions**
  - [ ] Clicking row opens thread drawer
  - [ ] Hover shows quick-action icons (Star, Archive, Reply, Delete)
  - [ ] Quick-action icons only appear on hover
  - [ ] Row hover elevation effect works smoothly

### 1.3 Thread Drawer
- [ ] **Drawer opens and closes correctly**
  - [ ] Drawer slides in from right
  - [ ] Backdrop overlay appears (dark, 50% opacity)
  - [ ] Drawer maintains consistent width (40% on desktop)
  - [ ] No glitching/flashing during loading state
  - [ ] Escape key closes drawer
  - [ ] Clicking backdrop closes drawer
  - [ ] Close button (X) works

- [ ] **Drawer content loads**
  - [ ] Loading spinner shows while fetching thread
  - [ ] Thread subject displays in header
  - [ ] Participants display correctly
  - [ ] Contact pills show for linked contacts
  - [ ] Messages display in chronological order
  - [ ] Message direction (inbound/outbound) displays correctly
  - [ ] Message timestamps display correctly
  - [ ] Message body renders HTML correctly

- [ ] **Drawer interactions**
  - [ ] Reply button opens reply drawer
  - [ ] Star button toggles star status
  - [ ] Archive button archives thread
  - [ ] Contact pills show hover cards
  - [ ] Clicking contact pill opens profile
  - [ ] Keyboard shortcuts work (r = reply, e = archive, Escape = close)

- [ ] **Mark as read behavior**
  - [ ] Thread marked as read when drawer opens (if unread)
  - [ ] Unread count updates in inbox list
  - [ ] No page reload when marking as read
  - [ ] Thread disappears from unread filter after marking read

---

## 2. Contact Linking & Display

### 2.1 Contact Enrichment
- [ ] **Backend contact lookup**
  - [ ] Threads enriched with contact data in `listEmailThreadsApi`
  - [ ] Contact names resolve from CRM contacts
  - [ ] User names resolve from system users
  - [ ] Company names resolve from CRM companies
  - [ ] Enrichment works for multiple participants

- [ ] **Contact display in inbox table**
  - [ ] Contact name displays instead of email (when available)
  - [ ] Company name displays below contact name (when available)
  - [ ] Email address displays if no contact name found
  - [ ] Avatar initials based on contact name (not email)
  - [ ] Contact badges display (User/CRM/User+CRM)
  - [ ] Badges are subtle and don't overpower row

### 2.2 Contact Hover Cards
- [ ] **Hover card triggers**
  - [ ] Hovering avatar shows contact card
  - [ ] Hovering sender name shows contact card
  - [ ] 200ms delay before card appears
  - [ ] Card positions correctly (doesn't cover row text)
  - [ ] Card closes when mouse leaves

- [ ] **Hover card content**
  - [ ] Contact name displays
  - [ ] Email address displays
  - [ ] Company name displays (if available)
  - [ ] Entity type badge shows (User/CRM Contact)
  - [ ] "View Contact" link works (if CRM contact)
  - [ ] "View User" link works (if system user)
  - [ ] "View Company" link works (if company linked)

- [ ] **Hover card in drawer**
  - [ ] Contact pills in drawer header show hover cards
  - [ ] Hover card content matches inbox table cards
  - [ ] Links navigate correctly

---

## 3. Search Functionality

### 3.1 Basic Search
- [ ] **Search bar**
  - [ ] Search bar visible in header
  - [ ] Search icon displays
  - [ ] Placeholder text shows "Search emails..."
  - [ ] Clear button (X) appears when text entered
  - [ ] Keyboard shortcut (Cmd/Ctrl + K) focuses search

- [ ] **Search execution**
  - [ ] Pressing Enter triggers backend search
  - [ ] Search queries all threads (not just loaded ones)
  - [ ] Search results display correctly
  - [ ] Result count displays ("Found X threads")
  - [ ] Loading state shows during search
  - [ ] Empty state shows when no results

- [ ] **Search matching**
  - [ ] Searches in subject line
  - [ ] Searches in sender email addresses
  - [ ] Searches in sender names (contact names)
  - [ ] Searches in preview snippets
  - [ ] Searches in company names
  - [ ] Case-insensitive matching works
  - [ ] Partial matches work (e.g., "Donna" matches "Donna Persson")

- [ ] **Search highlighting**
  - [ ] Matching text highlighted in results
  - [ ] Highlight color is soft blue (not harsh yellow)
  - [ ] Highlight works in subject, sender, and snippet

### 3.2 Advanced Search Filters
- [ ] **Filter syntax parsing**
  - [ ] `from:email@example.com` filter works
  - [ ] `to:email@example.com` filter works
  - [ ] `subject:keyword` filter works
  - [ ] `is:unread` filter works
  - [ ] `is:starred` filter works
  - [ ] Multiple filters can be combined
  - [ ] Free text search works alongside filters

- [ ] **Filter chips UI**
  - [ ] Active filters display as chips below search bar
  - [ ] Chip shows filter type and value
  - [ ] Clicking X on chip removes filter
  - [ ] Removing filter updates search query
  - [ ] Search re-executes when filter removed

- [ ] **Filter behavior**
  - [ ] Filters persist in search query string
  - [ ] "Clear Search" removes all filters
  - [ ] Filter chips only show when filters active

---

## 4. Filtering & Categories

### 4.1 System Filters
- [ ] **Inbox/Unread filter**
  - [ ] "Inbox" icon shows unread count badge
  - [ ] Clicking "Inbox" filters to unread threads (when unread exists)
  - [ ] Unread filter shows only threads with unreadCount > 0
  - [ ] Unread count calculates correctly (sum of all unreadCounts)

- [ ] **Starred filter**
  - [ ] Starred filter shows only starred threads
  - [ ] Star icon displays for starred threads
  - [ ] Toggling star updates filter results

- [ ] **Sent filter**
  - [ ] Sent filter shows only threads where user sent messages
  - [ ] Filter checks for outbound messages with fromUserId match
  - [ ] Doesn't show threads where user is just a participant

- [ ] **Archived filter**
  - [ ] Archived filter shows only archived threads
  - [ ] Archive action moves thread to archived status

- [ ] **Trash filter**
  - [ ] Trash filter shows only deleted threads
  - [ ] Delete action moves thread to deleted status

### 4.2 Gmail Category Filters
- [ ] **Category filters**
  - [ ] Primary filter shows primary category emails
  - [ ] Social filter shows social category emails
  - [ ] Promotions filter shows promotions category emails
  - [ ] Updates filter shows updates category emails
  - [ ] Forums filter shows forums category emails
  - [ ] Spam filter shows spam category emails

- [ ] **Category assignment**
  - [ ] Emails default to "primary" if no category found
  - [ ] Categories extracted from Gmail labelIds
  - [ ] Existing threads get categories on sync
  - [ ] Empty state suggests syncing Gmail for categories

### 4.3 Unread Toggle
- [ ] **Unread toggle button**
  - [ ] Toggle button visible in header
  - [ ] Toggle filters to unread-only when active
  - [ ] Toggle shows "Show Unread Only" when active
  - [ ] "Mark All Read" button appears when toggle active
  - [ ] Mark All Read marks all visible threads as read

---

## 5. Gmail Integration

### 5.1 Gmail Sync
- [ ] **Sync Gmail button**
  - [ ] Button visible in header
  - [ ] Button shows "Syncing..." during sync
  - [ ] Button disabled during sync
  - [ ] Success message displays after sync
  - [ ] Error message displays if sync fails

- [ ] **Sync functionality**
  - [ ] Sync fetches up to 1000 emails (not 200)
  - [ ] Sync prioritizes unread emails first
  - [ ] Sync fetches recent emails if unread < limit
  - [ ] Sync creates new threads for new conversations
  - [ ] Sync adds messages to existing threads
  - [ ] Sync updates thread metadata (lastMessageAt, unreadCount)
  - [ ] Sync extracts Gmail categories (labels)
  - [ ] Sync enriches threads with contact data

- [ ] **Thread matching**
  - [ ] Threads matched by gmailThreadId (primary)
  - [ ] Threads matched by subject + FROM + recipients (fallback)
  - [ ] Subject matching preserves identifiers (e.g., job IDs in brackets)
  - [ ] No duplicate threads created

### 5.2 Gmail Categories
- [ ] **Category extraction**
  - [ ] CATEGORY_PERSONAL maps to "primary"
  - [ ] CATEGORY_SOCIAL maps to "social"
  - [ ] CATEGORY_PROMOTIONS maps to "promotions"
  - [ ] CATEGORY_UPDATES maps to "updates"
  - [ ] CATEGORY_FORUMS maps to "forums"
  - [ ] SPAM maps to "spam"
  - [ ] Uncategorized emails default to "primary"

---

## 6. Selection & Bulk Actions

### 6.1 Thread Selection
- [ ] **Checkbox selection**
  - [ ] Individual checkboxes work
  - [ ] "Select All" checkbox works
  - [ ] Selected rows highlight correctly
  - [ ] Selection persists during pagination

- [ ] **Selection action bar**
  - [ ] Action bar appears when threads selected
  - [ ] Action bar shows selected count
  - [ ] Archive button works
  - [ ] Delete button works
  - [ ] Mark Read button works
  - [ ] Star button works
  - [ ] Action bar dismisses when selection cleared

---

## 7. Performance & UX

### 7.1 Performance
- [ ] **Loading performance**
  - [ ] Inbox loads in < 2 seconds
  - [ ] Search executes in < 1 second
  - [ ] Drawer opens smoothly (no jank)
  - [ ] No memory leaks during extended use

- [ ] **Pagination**
  - [ ] Large inboxes paginate correctly
  - [ ] No performance degradation with many threads
  - [ ] Backend search handles large result sets

### 7.2 User Experience
- [ ] **Visual polish**
  - [ ] Consistent spacing and typography
  - [ ] Smooth transitions and animations
  - [ ] No layout shifts during interactions
  - [ ] Responsive design works on different screen sizes

- [ ] **Error handling**
  - [ ] Network errors display user-friendly messages
  - [ ] API errors don't crash the app
  - [ ] Retry mechanisms work where applicable

- [ ] **Accessibility**
  - [ ] Keyboard navigation works
  - [ ] Screen reader friendly (where applicable)
  - [ ] Focus states visible
  - [ ] Color contrast meets WCAG standards

---

## 8. Edge Cases

### 8.1 Data Edge Cases
- [ ] **Missing data**
  - [ ] Threads without participants handle gracefully
  - [ ] Threads without subjects display "No subject"
  - [ ] Threads without snippets display empty preview
  - [ ] Missing contact data falls back to email display

- [ ] **Special characters**
  - [ ] Email addresses with special characters work
  - [ ] Subject lines with special characters display correctly
  - [ ] HTML entities decode correctly in previews

- [ ] **Long content**
  - [ ] Long subject lines truncate with ellipsis
  - [ ] Long preview snippets truncate correctly
  - [ ] Long email addresses handle gracefully

### 8.2 Thread Edge Cases
- [ ] **Empty threads**
  - [ ] Threads with no messages handle correctly
  - [ ] Fallback to email_logs works when messages subcollection empty
  - [ ] Empty thread drawer shows appropriate message

- [ ] **Thread matching**
  - [ ] Automated emails with similar subjects don't group incorrectly
  - [ ] Threads with same gmailThreadId group correctly
  - [ ] Threads with different participants don't group incorrectly

---

## 9. Integration Points

### 9.1 CRM Integration
- [ ] **Contact linking**
  - [ ] Email addresses match CRM contacts by email field
  - [ ] Contact names display from CRM
  - [ ] Company names display from CRM
  - [ ] Contact hover cards link to CRM contact profiles

### 9.2 User System Integration
- [ ] **User linking**
  - [ ] Email addresses match system users by email field
  - [ ] User names display from user profile
  - [ ] User hover cards link to user profiles

### 9.3 Message Sending
- [ ] **Reply functionality**
  - [ ] Reply drawer opens from thread drawer
  - [ ] Reply pre-fills recipient(s)
  - [ ] Reply sends successfully
  - [ ] Reply updates thread in inbox

---

## 10. Browser & Device Testing

### 10.1 Browser Compatibility
- [ ] **Chrome** (latest)
- [ ] **Firefox** (latest)
- [ ] **Safari** (latest)
- [ ] **Edge** (latest)

### 10.2 Screen Sizes
- [ ] **Desktop** (1920x1080, 1440x900)
- [ ] **Tablet** (768x1024)
- [ ] **Mobile** (375x667, 414x896)

---

## 11. Security & Permissions

### 11.1 Access Control
- [ ] **Tenant isolation**
  - [ ] Users only see threads from their tenant
  - [ ] Search only searches user's tenant threads
  - [ ] Contact lookup respects tenant boundaries

- [ ] **User permissions**
  - [ ] Users only see threads they're participants in
  - [ ] Users can't access other users' private threads

### 11.2 Data Privacy
- [ ] **Email content**
  - [ ] Email bodies only visible to participants
  - [ ] No email content exposed in API responses to unauthorized users

---

## 12. Known Issues & Limitations

### 12.1 Current Limitations
- [ ] Full-text search of message bodies not yet implemented (Phase 3)
- [ ] Manual contact linking not yet implemented (Phase 4)
- [ ] Deal association display not yet implemented (Phase 4)
- [ ] Thread count badges in subject line (future enhancement)

### 12.2 Workarounds
- [ ] If search doesn't find results, try using email address instead of name
- [ ] If categories missing, sync Gmail to update categories
- [ ] If contact names missing, ensure contacts exist in CRM with matching emails

---

## 13. Launch Readiness

### 13.1 Pre-Launch Checklist
- [ ] All critical bugs fixed
- [ ] Performance benchmarks met
- [ ] Security review completed
- [ ] Documentation updated
- [ ] User training materials prepared
- [ ] Support team briefed

### 13.2 Post-Launch Monitoring
- [ ] Monitor error rates
- [ ] Monitor API response times
- [ ] Monitor user feedback
- [ ] Monitor Gmail sync success rates
- [ ] Monitor search usage patterns

---

## Testing Notes

### Test Accounts
- **Primary Test User**: g.fielding@c1staffing.com
- **Test Tenant**: BCiP2bQ9CgVOCTfV6MhD

### Test Data
- Ensure test account has:
  - Gmail connected
  - At least 100+ emails synced
  - Mix of read/unread emails
  - Mix of starred/unstarred emails
  - Emails from contacts in CRM
  - Emails from system users
  - Emails in different Gmail categories

### Test Scenarios
1. **New User Onboarding**
   - New user connects Gmail
   - Syncs emails for first time
   - Verifies all emails appear

2. **Daily Usage**
   - User opens inbox
   - Searches for specific contact
   - Opens thread and replies
   - Archives old threads

3. **Power User**
   - Uses advanced search filters
   - Bulk selects and archives
   - Uses keyboard shortcuts
   - Hovers contacts for quick info

---

## Sign-Off

**QA Lead**: _________________ Date: _________

**Product Owner**: _________________ Date: _________

**Engineering Lead**: _________________ Date: _________

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-XX




