# Worker Routes (C1 Web App)

Canonical worker-facing route map, preserving current URL structure while the platform is rebuilt in phases.

## Primary Worker Shell

- `/c1`
- `/c1/workers`

## Worker Experience

- `/c1/workers/dashboard` - Worker dashboard home
- `/c1/workers/assignments` - Worker assignments list
- `/c1/workers/assignments/:assignmentId` - Assignment detail
- `/c1/workers/applications` - Worker applications
- `/c1/workers/profile` - Worker profile
- `/c1/workers/job-readiness` - Job readiness feed
- `/c1/workers/documents` - Worker documents
- `/c1/workers/support` - Help and support
- `/c1/workers/settings` - Worker settings/privacy
- `/c1/workers/notifications` - Notification center
- `/c1/workers/inbox` - Worker inbox
- `/c1/workers/inbox/:conversationId` - Worker inbox thread

## Find Work + Job Detail

- `/c1/jobs-board` - Find Work
- `/c1/jobs-board/:postId` - Job detail
- `/c1/jobs/:postId` - Job detail alias route

## Legacy Redirects To Worker Routes

- `/applications` -> `/c1/workers/applications`
- `/assignments` -> `/c1/workers/assignments`
- `/jobs-board` -> `/c1/jobs-board`

## Notes

- Keep these routes stable through Phase 0-Phase 3.
- Prefer feature-level refactors behind existing paths instead of URL changes.
