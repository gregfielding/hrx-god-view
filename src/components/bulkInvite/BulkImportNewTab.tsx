/**
 * BulkImportNewTab — `/users/bulk-import/new` (BI.1.P1).
 *
 * The recruiter-facing "start an import" sub-tab. Phase 1 wires the
 * UI scaffolding only:
 *   1. Select hiring entity (reuses `<EntityPicker />` from TS.1).
 *   2. Download CSV template (placeholder link — P2 ships the
 *      template generator).
 *   3. Drop / browse a CSV file (computes sha256, holds File in
 *      memory).
 *   4. Confirm (disabled in P1 — the parse callable lands in P2).
 *
 * No Firestore writes, no callable invocations. The selected entity
 * + file are held in component-local state so P2 can plug
 * `parseAndPreviewBulkInvite` in without restructuring the layout.
 *
 * Note: the parent `<BulkImportPage />` has already enforced sec-7
 * via the route gate. This component assumes an authorized user.
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Typography,
} from '@mui/material';

import { useAuth } from '../../contexts/AuthContext';
import { EntityPicker } from '../timesheets/EntityPicker';
import type { HiringEntity } from '../../types/recruiter/hiringEntity';
import BulkImportFileDropzone, {
  type SelectedBulkImportFile,
} from './BulkImportFileDropzone';

const BulkImportNewTab: React.FC = () => {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? '';
  const [entity, setEntity] = useState<HiringEntity | null>(null);
  const [file, setFile] = useState<SelectedBulkImportFile | null>(null);

  const canConfirm = useMemo(
    () => Boolean(tenantId) && Boolean(entity) && Boolean(file),
    [tenantId, entity, file],
  );

  if (!tenantId) {
    return (
      <Alert severity="warning" sx={{ mt: 1 }}>
        No active tenant selected. Switch tenants to start a bulk import.
      </Alert>
    );
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 720 }}>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                1. Select hiring entity
              </Typography>
              <Typography variant="caption" color="text.secondary">
                One file per entity. The entity drives pay-period policy and
                worker type for the imported workers.
              </Typography>
            </Box>
            <EntityPicker
              tenantId={tenantId}
              value={entity}
              onChange={setEntity}
              showRequiredHelper={false}
            />
            {entity && (
              <Typography variant="caption" color="text.secondary">
                Worker type:{' '}
                <strong>{entity.workerType ?? 'mixed'}</strong>
                {entity.payPeriodPolicy?.policyType ? (
                  <>
                    {' · '}Pay period:{' '}
                    <strong>
                      {entity.payPeriodPolicy.policyType === 'per_event'
                        ? 'Per event / per day'
                        : 'Weekly'}
                    </strong>
                  </>
                ) : null}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                2. Download the CSV template
              </Typography>
              <Typography variant="caption" color="text.secondary">
                The template matches the Tempworks export columns (last name,
                first name, employee ID, email, phones). Required columns are
                marked.
              </Typography>
            </Box>
            <Button
              variant="outlined"
              size="small"
              disabled
              sx={{ alignSelf: 'flex-start' }}
            >
              Download CSV template (coming in P2)
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                3. Upload the file
              </Typography>
              <Typography variant="caption" color="text.secondary">
                We&apos;ll parse, dedup, and match against existing HRX users
                before any messages go out. You&apos;ll see a preview before
                confirming.
              </Typography>
            </Box>
            <BulkImportFileDropzone
              disabled={!entity}
              onSelected={setFile}
            />
          </Stack>
        </CardContent>
      </Card>

      <Stack direction="row" spacing={1.5} justifyContent="flex-end">
        <Button variant="text" disabled={!file} onClick={() => setFile(null)}>
          Reset
        </Button>
        <Button variant="contained" disabled={!canConfirm}>
          Preview import (coming in P2)
        </Button>
      </Stack>
    </Stack>
  );
};

export default BulkImportNewTab;
