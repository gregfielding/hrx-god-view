## Inbox Standard (Canonical UI Pattern)

This document defines the canonical “Inbox Standard” used across HRX ONE list/table pages.

### Header
- **Title + subtitle** (left)
- **Filter/sub-nav pills** under title (left)
- **Search + primary action button** on the right

### Tables
- **Sticky table header**: table headers must remain sticky and visually “attached” under the page header.
- **Standard pagination footer**: all paginated tables must use the Inbox-standard footer.
  - Implemented by `src/components/StandardTablePagination.tsx`
  - Use it instead of raw MUI `TablePagination` to keep typography/spacing/icons consistent.


