/**
 * BulkImportPage — `/users/bulk-import` (BI.1.P1).
 *
 * Page-level container for the two sub-tabs:
 *   - `/users/bulk-import/new`     — entity picker → file dropzone → preview → confirm
 *   - `/users/bulk-import/imports` — operator dashboard (job list, live progress)
 *
 * Phase 1 ships UI scaffolding only. Parsing, callables, processor,
 * dashboard wiring, and message dispatch all arrive in P2 / P3 / P4.
 * The page renders the same shell either way — when callables ship,
 * the children fill in.
 *
 * Route gating (sec >= 7) lives at the parent `<ProtectedRoute>` in
 * App.tsx + the visibility filter for the tab pill in
 * `usersLayoutPersistence.ts`. This component assumes its children
 * are only mounted by authorized users.
 */

import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

type BulkImportSubTab = 'new' | 'imports';

const SUB_TABS: { id: BulkImportSubTab; label: string; path: string }[] = [
  { id: 'new', label: 'New import', path: '/users/bulk-import/new' },
  { id: 'imports', label: 'Imports', path: '/users/bulk-import/imports' },
];

function getActiveSubTab(pathname: string): BulkImportSubTab {
  if (pathname.includes('/users/bulk-import/imports')) return 'imports';
  return 'new';
}

const BulkImportPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeSubTab = getActiveSubTab(pathname);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Bulk Import
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Migrate workers from an external source (e.g. Tempworks) into HRX in
          bulk. Recruiter picks a hiring entity, drags in a CSV, and confirms.
          The system handles match + dedup, Everee onboarding, and
          migration-specific outreach. One file per entity, up to ~5,000 rows.
        </Typography>
      </Box>

      {/* Sub-tab pill row — same visual language as UsersLayout. */}
      <Stack direction="row" spacing={0.5} alignItems="center">
        {SUB_TABS.map(({ id, label, path }) => {
          const isActive = activeSubTab === id;
          return (
            <Button
              key={id}
              onClick={() => navigate(path)}
              variant="text"
              sx={{
                textTransform: 'none',
                borderRadius: '999px',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                px: 1.5,
                py: 0.5,
                minHeight: 30,
                minWidth: 'auto',
                whiteSpace: 'nowrap',
                '&:hover': {
                  bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                },
              }}
            >
              {label}
            </Button>
          );
        })}
      </Stack>

      <Outlet />
    </Box>
  );
};

export default BulkImportPage;
