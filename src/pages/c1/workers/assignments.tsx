/**
 * My Assignments — /c1/workers/assignments
 * Worker-facing upcoming and past shifts. Loads from tenants/{tenantId}/assignments.
 * Detail route: /c1/workers/assignments/:assignmentId
 */

import React, { useState, useEffect } from 'react';
import { Box, Stack, Typography, Button, CircularProgress } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import WorkerAssignmentsTabs from '../../../components/worker/assignments/WorkerAssignmentsTabs';
import type { WorkerAssignmentItem } from '../../../components/worker/assignments/WorkerAssignmentCard';
import type { AssignmentStatus } from '../../../components/worker/assignments/WorkerAssignmentCard';

const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

function mapAssignmentStatus(status: string): AssignmentStatus {
  const s = (status || '').toLowerCase();
  if (s === 'confirmed' || s === 'active') return 'confirmed';
  if (s === 'cancelled' || s === 'canceled' || s === 'declined') return 'cancelled';
  if (s === 'completed') return 'completed';
  if (s === 'no-show') return 'no-show';
  return 'scheduled'; // proposed or unknown
}

function toStartAt(data: Record<string, any>): number {
  const startDate = data.startDate;
  const startTime = data.startTime || '00:00';
  if (!startDate) return 0;
  const dateStr = typeof startDate === 'string' ? startDate : startDate.toDate?.()?.toISOString?.()?.slice(0, 10) ?? '';
  if (!dateStr) return 0;
  const iso = `${dateStr}T${startTime.slice(0, 5)}:00`;
  return new Date(iso).getTime();
}

function toEndAt(data: Record<string, any>): number | undefined {
  const startDate = data.startDate;
  const endTime = data.endTime || data.startTime || '23:59';
  if (!startDate) return undefined;
  const dateStr = typeof startDate === 'string' ? startDate : startDate.toDate?.()?.toISOString?.()?.slice(0, 10) ?? '';
  if (!dateStr) return undefined;
  const iso = `${dateStr}T${endTime.slice(0, 5)}:00`;
  return new Date(iso).getTime();
}

function docToItem(docId: string, data: Record<string, any>, tenantId: string): WorkerAssignmentItem {
  const startAt = toStartAt(data);
  const endAt = toEndAt(data);
  const status = mapAssignmentStatus(data.status);
  return {
    assignmentId: docId,
    jobTitle: data.jobTitle || 'Assignment',
    siteName: data.locationNickname || data.worksiteName,
    clientName: data.companyName,
    startAt,
    endAt,
    locationShort: data.worksiteName || data.locationNickname,
    address: data.worksiteAddress?.city && data.worksiteAddress?.state
      ? `${data.worksiteAddress.city}, ${data.worksiteAddress.state}`
      : undefined,
    status,
  };
}

const WorkerAssignments: React.FC = () => {
  const navigate = useNavigate();
  const { user, activeTenant } = useAuth();
  const [tabIndex, setTabIndex] = useState(0);
  const [upcoming, setUpcoming] = useState<WorkerAssignmentItem[]>([]);
  const [past, setPast] = useState<WorkerAssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);

  const tenantId = activeTenant?.id ?? C1_TENANT_ID;

  useEffect(() => {
    if (!user?.uid || !tenantId) {
      setLoading(false);
      setUpcoming([]);
      setPast([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
        const q = query(
          assignmentsRef,
          where('userId', '==', user.uid)
        );
        const snap = await getDocs(q);
        if (cancelled) return;

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();

        const up: WorkerAssignmentItem[] = [];
        const pa: WorkerAssignmentItem[] = [];

        snap.docs.forEach((d) => {
          const data = d.data();
          const item = docToItem(d.id, data, tenantId);
          const status = (data.status || '').toLowerCase();
          const isPastStatus = ['cancelled', 'canceled', 'declined', 'completed'].includes(status);
          const startMs = typeof item.startAt === 'number' ? item.startAt : new Date(item.startAt).getTime();
          const isPastDate = startMs < todayMs;

          if (isPastStatus || isPastDate) {
            pa.push(item);
          } else {
            up.push(item);
          }
        });

        up.sort((a, b) => {
          const at = typeof a.startAt === 'number' ? a.startAt : new Date(a.startAt).getTime();
          const bt = typeof b.startAt === 'number' ? b.startAt : new Date(b.startAt).getTime();
          return at - bt;
        });
        pa.sort((a, b) => {
          const at = typeof a.startAt === 'number' ? a.startAt : new Date(a.startAt).getTime();
          const bt = typeof b.startAt === 'number' ? b.startAt : new Date(b.startAt).getTime();
          return bt - at;
        });

        setUpcoming(up);
        setPast(pa);
      } catch (err) {
        console.error('Failed to load assignments:', err);
        if (!cancelled) {
          setUpcoming([]);
          setPast([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [user?.uid, tenantId]);

  return (
    <Box sx={{ maxWidth: 'lg', mx: 'auto' }}>
      <Stack spacing={4} sx={{ py: 2 }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={2}
        >
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 600 }}>
              My Assignments
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Your upcoming and past shifts.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="contained" onClick={() => navigate('/c1/jobs-board')}>
              Find Work
            </Button>
            <Button variant="outlined" onClick={() => navigate('/c1/workers/applications')}>
              View Applications
            </Button>
          </Stack>
        </Stack>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <WorkerAssignmentsTabs
            upcoming={upcoming}
            past={past}
            tabIndex={tabIndex}
            onTabChange={setTabIndex}
          />
        )}
      </Stack>
    </Box>
  );
};

export default WorkerAssignments;
