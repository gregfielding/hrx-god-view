/**
 * ShiftPlacementsDrawer — right-side drawer that opens when a row is clicked
 * in the /shifts/active table. It shows the parent JO's existing
 * `PlacementsTab` so recruiters can manage assignments without leaving the
 * cross-job-order Shifts dashboard.
 *
 * The drawer owns the JO doc fetch (PlacementsTab requires a hydrated
 * `JobOrder`). On close we drop the loaded JO so re-opening a different
 * shift always shows fresh data.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { Close as CloseIcon, OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import { doc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';
import PlacementsTab from '../recruiter/PlacementsTab';
import type { JobOrder } from '../../types/recruiter/jobOrder';

interface ShiftSummary {
  id: string;
  shiftTitle?: string;
  dateLabel: string;
  timeLabel: string;
}

interface ShiftPlacementsDrawerProps {
  open: boolean;
  tenantId: string | null;
  jobOrderId: string | null;
  shift: ShiftSummary | null;
  onClose: () => void;
}

const ShiftPlacementsDrawer: React.FC<ShiftPlacementsDrawerProps> = ({
  open,
  tenantId,
  jobOrderId,
  shift,
  onClose,
}) => {
  const navigate = useNavigate();
  const [jobOrder, setJobOrder] = useState<JobOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the JO doc whenever a new (tenant, jobOrderId) pair opens.
  // PlacementsTab wants a fully populated JobOrder, not an empty shell —
  // empty would crash several `jobOrder.requiredCertifications` etc. lookups.
  useEffect(() => {
    if (!open || !tenantId || !jobOrderId) {
      setJobOrder(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const snap = await getDoc(doc(db, p.jobOrder(tenantId, jobOrderId)));
        if (cancelled) return;
        if (!snap.exists()) {
          setError('Job order no longer exists.');
          setJobOrder(null);
        } else {
          // Cast — the Firestore doc shape is broader than the TS interface,
          // but PlacementsTab tolerates extra fields and the few fields it
          // strictly needs are all present on real JO docs.
          setJobOrder({ id: snap.id, ...(snap.data() as object) } as JobOrder);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load job order for shift drawer:', err);
        setError(err instanceof Error ? err.message : 'Failed to load job order');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tenantId, jobOrderId]);

  const handleOpenJobOrder = () => {
    if (!jobOrderId) return;
    onClose();
    navigate(`/jobs/job-orders/${jobOrderId}`);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: '100%', md: '60vw', lg: '70vw' },
          minWidth: { md: '600px', lg: '800px' },
          maxWidth: { md: '60vw', lg: '70vw' },
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Box
        sx={{
          px: 2.5,
          py: 1.75,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.1 }}>
            Placements
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 600 }} noWrap>
            {shift?.shiftTitle?.trim() || 'Shift'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {shift ? `${shift.dateLabel} · ${shift.timeLabel}` : ''}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.5}>
          {jobOrderId && (
            <IconButton
              onClick={handleOpenJobOrder}
              size="small"
              title="Open full job order"
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          )}
          <IconButton onClick={onClose} size="small" title="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      <Divider />

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}
        {!loading && error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}
        {!loading && !error && jobOrder && tenantId && jobOrderId && (
          <Box sx={{ px: 1.5, pb: 2 }}>
            <PlacementsTab
              tenantId={tenantId}
              jobOrderId={jobOrderId}
              jobOrder={jobOrder}
              connectedJobPostIds={[]}
              hiringEntityName={null}
              placementHiringEntityId={null}
            />
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

export default ShiftPlacementsDrawer;
