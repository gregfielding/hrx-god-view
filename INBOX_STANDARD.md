## Inbox Standard (Canonical UI Pattern)

This document defines the canonical "Inbox Standard" used across HRX ONE list/table pages.

### Header
- **Title + subtitle** (left)
- **Filter/sub-nav pills** under title (left)
- **Search + primary action button** on the right

### Tables

#### Table Container & Layout
- **Horizontal Padding**: Table wrapper should have `px: 2` (16px) on left and right sides
- **Full-width**: Tables should span full width of container (minus padding)
- **Container Structure**:
  ```tsx
  <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', px: 2 }}>
    <TableContainer 
      component={Paper}
      sx={{
        borderRadius: 2,
        position: 'relative',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'auto',
        width: '100%',
        // ... scrollbar styling (see below)
      }}
    >
  ```

#### Table Header (Sticky & White)
- **Sticky positioning**: Table header must remain sticky and fixed to the page header when scrolling
- **White background**: All header cells must have white background (`#FFFFFF`)
- **Bold text**: Header labels use `fontWeight: 700`
- **Implementation**:
  ```tsx
  <Table size="small" stickyHeader sx={{ width: '100%' }}>
    <TableHead sx={{
      position: 'sticky',
      top: 0,
      zIndex: 10,
      backgroundColor: 'background.paper',
    }}>
      <TableRow sx={{ backgroundColor: 'background.paper' }}>
        <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>
          {/* Header content */}
        </TableCell>
      </TableRow>
    </TableHead>
  </Table>
  ```

#### Scrollbar Styling
- **Width**: 8px (thin)
- **Track color**: Light gray (`rgba(0, 0, 0, 0.02)`)
- **Thumb color**: Lighter gray (`rgba(0, 0, 0, 0.15)`) with hover effect (`rgba(0, 0, 0, 0.25)`)
- **Implementation**:
  ```tsx
  sx={{
    // WebKit scrollbar styling
    '&::-webkit-scrollbar': {
      width: '8px',
      height: '8px',
    },
    '&::-webkit-scrollbar-track': {
      background: 'rgba(0, 0, 0, 0.02)',
      borderRadius: '4px',
    },
    '&::-webkit-scrollbar-thumb': {
      background: 'rgba(0, 0, 0, 0.15)',
      borderRadius: '4px',
      '&:hover': {
        background: 'rgba(0, 0, 0, 0.25)',
      },
    },
    // Firefox scrollbar styling
    scrollbarWidth: 'thin',
    scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
  }}
  ```

#### Pagination Footer
- **Required**: All tables must include pagination footer
- **Component**: Use `StandardTablePagination` from `src/components/StandardTablePagination.tsx`
- **Default rows per page**: 20 (options: 10, 20, 50, 100)
- **Reset on search**: Page should reset to 0 when search query changes
- **Implementation**:
  ```tsx
  <StandardTablePagination
    count={sortedItems.length}
    page={page}
    onPageChange={(_, newPage) => setPage(newPage)}
    rowsPerPage={rowsPerPage}
    onRowsPerPageChange={(e) => {
      setRowsPerPage(parseInt(e.target.value, 10));
      setPage(0);
    }}
  />
  ```

#### Header Label Guidelines
- **Keep labels concise**: Use short labels that fit on one line
  - ✅ "First" and "Last" (instead of "First Name" and "Last Name")
  - ✅ "Email" (not "Email Address")
  - ✅ "Role" (not "User Role")

#### Search Integration
- **Location**: Search bar should be in `PageHeader`'s `rightActions` prop (not inside table container)
- **Component**: Use `InboxSearchBar` from `src/components/InboxSearchBar.tsx`
- **Reset pagination**: When search changes, reset page to 0
- **Implementation**:
  ```tsx
  <PageHeader
    // ... other props
    rightActions={
      <InboxSearchBar
        value={search}
        onChange={setSearch}
        onSearch={setSearch}
        placeholder="Search..."
      />
    }
  />
  ```

#### React Hooks Order
- **Important**: All React hooks (`useState`, `useEffect`, `useMemo`) must be called **before** any conditional returns
- **Incorrect**:
  ```tsx
  if (loading) return <Loading />;
  const paginatedData = useMemo(...); // ❌ Hook after conditional return
  ```
- **Correct**:
  ```tsx
  const paginatedData = useMemo(...); // ✅ Hook before conditional return
  if (loading) return <Loading />;
  ```

### Example Implementation
See `src/componentBlocks/WorkersTable.tsx` and `src/pages/TenantViews/PendingInvites.tsx` for complete reference implementations.


