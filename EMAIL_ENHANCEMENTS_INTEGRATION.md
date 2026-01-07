# Email Enhancements Integration Guide

This document outlines how to integrate all the new email enhancements into the existing codebase.

## Components Created

### Hooks
1. **`src/hooks/useEmailRealtime.ts`** - Real-time Firestore listeners for threads and messages
2. **`src/hooks/useEmailShortcuts.ts`** - Keyboard shortcuts (j/k navigation, r reply, etc.)

### Components
3. **`src/components/EmailPreviewPane.tsx`** - Split-view preview pane for desktop

### Utilities
4. **`src/utils/emailOptimisticUpdates.ts`** - Optimistic UI updates for actions
5. **`src/utils/emailToast.ts`** - Toast notifications with undo support
6. **`src/utils/emailAttachments.ts`** - Attachment utilities (thumbnails, PDF viewer)
7. **`src/utils/emailDrafts.ts`** - Draft auto-save functionality
8. **`src/utils/emailSearch.ts`** - Firestore-based search with debouncing
9. **`src/utils/emailSwipeActions.ts`** - Mobile swipe gesture handlers

## Integration Steps

### 1. Real-Time Updates in UserInboxPage

Replace the `loadEmailThreads` function with real-time listener:

```typescript
import { useEmailRealtime } from '../hooks/useEmailRealtime';
import { useAuth } from '../contexts/AuthContext';

// In UserInboxPage component:
const { user, activeTenant } = useAuth();
const { threads: realtimeThreads, loading: realtimeLoading, unreadCount } = useEmailRealtime({
  tenantId: effectiveTenantId,
  userId: user?.uid || '',
  userEmail: user?.email,
  status: activeFilter === 'archived' ? 'archived' : activeFilter === 'trash' ? 'deleted' : 'active',
  unreadOnly: activeFilter === 'unread',
  category: ['primary', 'social', 'promotions', 'updates', 'forums', 'spam'].includes(activeFilter) ? activeFilter : undefined,
  enabled: true,
});

// Use realtimeThreads instead of emailThreads state
```

### 2. Add Keyboard Shortcuts

```typescript
import { useEmailShortcuts } from '../hooks/useEmailShortcuts';

// In UserInboxPage component:
useEmailShortcuts({
  enabled: !emailThreadViewOpen, // Disable when thread view is open
  handlers: {
    onNavigateNext: () => {
      // Navigate to next thread
      const currentIndex = emailThreads.findIndex(t => t.id === selectedEmailThread?.id);
      if (currentIndex < emailThreads.length - 1) {
        handleEmailThreadClick(emailThreads[currentIndex + 1]);
      }
    },
    onNavigatePrevious: () => {
      // Navigate to previous thread
      const currentIndex = emailThreads.findIndex(t => t.id === selectedEmailThread?.id);
      if (currentIndex > 0) {
        handleEmailThreadClick(emailThreads[currentIndex - 1]);
      }
    },
    onReply: () => {
      if (selectedEmailThread) {
        setAutoOpenReply(true);
        setEmailThreadViewOpen(true);
      }
    },
    onArchive: () => {
      if (selectedEmailThread) {
        handleArchiveThread(selectedEmailThread.id, {} as any);
      }
    },
    onStar: () => {
      if (selectedEmailThread) {
        handleStarThread(selectedEmailThread.id, !selectedEmailThread.starred, {} as any);
      }
    },
    onFocusSearch: () => {
      // Focus search input
      searchInputRef.current?.focus();
    },
    onGoToInbox: () => setActiveFilter('all'),
    onGoToStarred: () => setActiveFilter('starred'),
    onGoToSent: () => setActiveFilter('sent'),
    onGoToArchived: () => setActiveFilter('archived'),
    onCompose: () => setMessageDrawerOpen(true),
  },
});
```

### 3. Add Preview Pane (Desktop Split View)

```typescript
import EmailPreviewPane from '../components/EmailPreviewPane';
import { useThreadMessagesRealtime } from '../hooks/useEmailRealtime';

// In UserInboxPage, add state for preview mode:
const [previewMode, setPreviewMode] = useState(false);
const { messages: previewMessages } = useThreadMessagesRealtime(
  effectiveTenantId,
  selectedEmailThread?.id || '',
  previewMode && !!selectedEmailThread
);

// Replace thread view drawer with split view on desktop:
{isDesktop && previewMode ? (
  <Box sx={{ display: 'flex', height: '100%', gap: 1 }}>
    {/* Thread List */}
    <Box sx={{ width: '40%', overflow: 'auto' }}>
      {/* Existing thread list */}
    </Box>
    {/* Preview Pane */}
    <Box sx={{ flex: 1 }}>
      <EmailPreviewPane
        thread={selectedEmailThread}
        messages={previewMessages}
        onClose={() => setSelectedEmailThread(null)}
        onReply={() => {
          setAutoOpenReply(true);
          setEmailThreadViewOpen(true);
        }}
        onForward={() => {/* ... */}}
        onArchive={() => handleArchiveThread(selectedEmailThread.id, {} as any)}
        onStar={() => handleStarThread(selectedEmailThread.id, !selectedEmailThread.starred, {} as any)}
        onMarkRead={() => {/* ... */}}
        onDelete={() => {/* ... */}}
        autoMarkAsRead={true}
        onAutoMarkAsRead={(threadId) => {
          // Mark thread as read
        }}
      />
    </Box>
  </Box>
) : (
  // Existing drawer view for mobile
)}
```

### 4. Add Optimistic Updates

```typescript
import { executeOptimisticUpdate, createArchiveUpdate, createStarUpdate } from '../utils/emailOptimisticUpdates';

// Update handleArchiveThread:
const handleArchiveThread = async (threadId: string, event: React.MouseEvent) => {
  const update = createArchiveUpdate(threadId);
  const { updated, error } = await executeOptimisticUpdate(
    emailThreads,
    update,
    async () => {
      const response = await fetch(`${API_BASE_URL}/archiveEmailThreadApi/${threadId}`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to archive');
    }
  );
  
  setEmailThreads(updated);
  if (error) {
    showErrorToast('Failed to archive thread');
  } else {
    showUndoToast('Thread archived', () => {
      // Undo archive
    });
  }
};
```

### 5. Add Toast Notifications

```typescript
import { subscribeToToasts, showSuccessToast, showErrorToast, showUndoToast } from '../utils/emailToast';
import { Snackbar, Alert } from '@mui/material';

// In UserInboxPage:
const [toast, setToast] = useState<any>(null);

useEffect(() => {
  const unsubscribe = subscribeToToasts((toast) => {
    setToast(toast);
  });
  return unsubscribe;
}, []);

// Add Snackbar component:
<Snackbar
  open={!!toast}
  autoHideDuration={toast?.duration || 5000}
  onClose={() => setToast(null)}
  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
>
  <Alert
    severity={toast?.type || 'info'}
    onClose={() => setToast(null)}
    action={toast?.action && (
      <Button color="inherit" size="small" onClick={toast.action.onClick}>
        {toast.action.label}
      </Button>
    )}
  >
    {toast?.message}
  </Alert>
</Snackbar>
```

### 6. Add Thread Navigation to EmailThreadView

```typescript
// Add Previous/Next buttons in EmailThreadView header:
<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
  <IconButton
    size="small"
    onClick={() => {
      // Navigate to previous thread
      const currentIndex = allThreads.findIndex(t => t.id === threadId);
      if (currentIndex > 0) {
        onThreadSelected?.(allThreads[currentIndex - 1].id);
      }
    }}
    disabled={currentIndex === 0}
  >
    <ChevronLeftIcon />
  </IconButton>
  <Typography variant="caption" color="text.secondary">
    {currentIndex + 1} of {allThreads.length}
  </Typography>
  <IconButton
    size="small"
    onClick={() => {
      // Navigate to next thread
      const currentIndex = allThreads.findIndex(t => t.id === threadId);
      if (currentIndex < allThreads.length - 1) {
        onThreadSelected?.(allThreads[currentIndex + 1].id);
      }
    }}
    disabled={currentIndex === allThreads.length - 1}
  >
    <ChevronRightIcon />
  </IconButton>
</Box>
```

### 7. Add Mobile Swipe Actions

```typescript
import { createSwipeHandler } from '../utils/emailSwipeActions';

// In thread list item:
const swipeHandler = createSwipeHandler(
  {
    left: 'archive',
    right: 'delete',
    threshold: 100,
  },
  (action) => {
    if (action === 'archive') {
      handleArchiveThread(thread.id, {} as any);
    } else if (action === 'delete') {
      // Handle delete
    }
  }
);

<ListItemButton
  {...swipeHandler}
  sx={{
    // Add swipe transform styles
    ...getSwipeTransform(swipeHandler.getSwipeState()),
  }}
>
  {/* Thread content */}
</ListItemButton>
```

### 8. Add Debounced Search

```typescript
import { createDebouncedSearch, searchEmailThreads } from '../utils/emailSearch';

// In UserInboxPage:
const debouncedSearch = useMemo(
  () =>
    createDebouncedSearch(async (query: string) => {
      return await searchEmailThreads({
        tenantId: effectiveTenantId,
        userId: user?.uid || '',
        userEmail: user?.email,
        query,
        limit: 50,
      });
    }, 300),
  [effectiveTenantId, user?.uid, user?.email]
);

// Use in search handler:
const handleSearch = async (query: string) => {
  if (query.trim()) {
    const results = await debouncedSearch(query);
    setSearchResults(results);
    setIsBackendSearch(true);
  } else {
    setIsBackendSearch(false);
  }
};
```

### 9. Add Draft Auto-Save to MessageDrawer

```typescript
import { createAutoSave } from '../utils/emailDrafts';

// In MessageDrawer component:
const autoSave = useMemo(
  () => createAutoSave(user?.uid || '', tenantId, draftId),
  [user?.uid, tenantId, draftId]
);

// Call on body/subject changes:
useEffect(() => {
  if (bodyHtml || subject) {
    autoSave({
      to: recipients.map(r => r.email),
      subject,
      bodyHtml,
      bodyPlain: bodyHtml.replace(/<[^>]*>/g, ''),
    });
  }
}, [bodyHtml, subject, recipients]);
```

### 10. Add Attachment Enhancements

```typescript
import { getThumbnailUrl, isImageAttachment, downloadAllAttachments } from '../utils/emailAttachments';

// In attachment display:
{isImageAttachment(attachment) && (
  <img
    src={await getThumbnailUrl(attachment)}
    alt={attachment.name}
    style={{ maxWidth: '200px', maxHeight: '200px' }}
  />
)}

// Download all button:
<Button onClick={() => downloadAllAttachments(message.attachments)}>
  Download All
</Button>
```

## Next Steps

1. **Virtual Scrolling**: Consider using `react-window` or `react-virtualized` for large inboxes
2. **PDF Viewer**: Integrate `react-pdf` or similar for inline PDF viewing
3. **Rich Text Editor**: Enhance MessageDrawer with a full rich text editor (TinyMCE, Quill, etc.)
4. **Send Later**: Add scheduling functionality using Cloud Functions
5. **Templates**: Create email template system
6. **Pull to Refresh**: Add pull-to-refresh for mobile using `react-pull-to-refresh`

## Testing Checklist

- [ ] Real-time updates work correctly
- [ ] Keyboard shortcuts don't interfere with typing
- [ ] Preview pane shows/hides correctly
- [ ] Optimistic updates revert on error
- [ ] Toast notifications appear and dismiss
- [ ] Swipe actions work on mobile
- [ ] Search is debounced and performs well
- [ ] Drafts auto-save correctly
- [ ] Attachments display thumbnails
- [ ] Thread navigation works

