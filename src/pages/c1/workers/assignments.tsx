/**
 * My Assignments — /c1/workers/assignments
 * Worker-facing upcoming and past shifts. Loads from tenants/{tenantId}/assignments.
 * Detail route: /c1/workers/assignments/:assignmentId
 * List-only UI (no card-deck toggle).
 */

import React, { useState, useEffect } from 'react';
import { Box, Stack, Typography, CircularProgress } from '@mui/material';
import { collection, doc, query, where, getDocs, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import { getCalendarDayLocal } from '../../../utils/dateUtils';
import WorkerAssignmentsTabs from '../../../components/worker/assignments/WorkerAssignmentsTabs';
import SmsWarningBanner from '../../../components/worker/SmsWarningBanner';
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
  const dateStr = getCalendarDayLocal(startDate);
  if (!dateStr) return 0;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = startTime.slice(0, 5).split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime();
}

function toEndAt(data: Record<string, any>): number | undefined {
  const endDate = data.endDate || data.startDate;
  const endTime = data.endTime || data.startTime || '23:59';
  if (!endDate) return undefined;
  const dateStr = getCalendarDayLocal(endDate);
  if (!dateStr) return undefined;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = endTime.slice(0, 5).split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime();
}

/** Location doc shape for address enrichment */
type LocationInfo = {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  nickname?: string;
  title?: string;
  name?: string;
  locationName?: string;
};

function formatAddress(loc: LocationInfo | null | undefined): string | undefined {
  if (!loc) return undefined;
  const parts = [
    loc.street,
    [loc.city, loc.state].filter(Boolean).join(', '),
    loc.zip,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function formatLocationShort(loc: LocationInfo | null | undefined): string | undefined {
  if (!loc) return undefined;
  const cityState = [loc.city, loc.state].filter(Boolean).join(', ');
  return cityState || undefined;
}

/** True if string looks like a Firestore doc ID (e.g. nFVWtAknhsCxihFfER8Y) — don't show as display name */
function looksLikeDocId(s: unknown): boolean {
  if (typeof s !== 'string' || !s) return false;
  const t = s.trim();
  return t.length >= 15 && t.length <= 30 && /^[a-zA-Z0-9_-]+$/.test(t);
}

function locationDisplayName(loc: LocationInfo | null | undefined): string | undefined {
  if (!loc) return undefined;
  const name =
    loc.nickname || loc.title || loc.name || loc.locationName;
  if (!name || looksLikeDocId(name)) return undefined;
  return name;
}

function docToItem(
  docId: string,
  data: Record<string, any>,
  _tenantId: string,
  locationMap?: Record<string, LocationInfo>,
): WorkerAssignmentItem {
  const startAt = toStartAt(data);
  const endAt = toEndAt(data);
  const status = mapAssignmentStatus(data.status);
  const locationId = data.locationId || '';
  const location = locationId && locationMap ? locationMap[locationId] : undefined;
  const address = formatAddress(location) ?? (data.worksiteAddress?.city && data.worksiteAddress?.state
    ? `${data.worksiteAddress.city}, ${data.worksiteAddress.state}`
    : undefined);
  const fromLocation = locationDisplayName(location);
  const rawWorksite = data.worksiteName ?? data.locationNickname;
  const siteName = fromLocation || (rawWorksite && !looksLikeDocId(rawWorksite) ? rawWorksite : undefined);
  const rawLocationShort = formatLocationShort(location) ?? (rawWorksite && !looksLikeDocId(rawWorksite) ? rawWorksite : undefined);
  const locationShort = rawLocationShort || (fromLocation && !address ? fromLocation : undefined);
  const rawCompany = data.companyName;
  const clientName = rawCompany && !looksLikeDocId(rawCompany) ? rawCompany : undefined;
  // Calendar bucket: confirmed assignments are blue + open the
  // assignment-details page; pending/proposed ("accepted" — recruiter
  // offered, worker hasn't confirmed yet) are green + open the
  // jobs-board posting so the worker can Confirm/Decline.
  const rawStatus = String(data.status || '').toLowerCase();
  const calendarKind: WorkerAssignmentItem['calendarKind'] =
    rawStatus === 'confirmed' || rawStatus === 'active' || rawStatus === 'in_progress'
      ? 'confirmed'
      : rawStatus === 'pending' || rawStatus === 'proposed' || rawStatus === 'scheduled'
        ? 'accepted'
        : undefined;
  return {
    assignmentId: docId,
    jobTitle: data.jobTitle || 'Assignment',
    siteName,
    clientName,
    startAt,
    endAt,
    locationShort: (locationShort || (address ? undefined : formatLocationShort(location))) ?? undefined,
    address,
    payRate: typeof data.payRate === 'number' ? data.payRate : undefined,
    status,
    jobPostId: (data.jobPostId as string | undefined) || undefined,
    calendarKind,
  };
}

const WorkerAssignments: React.FC = () => {
  const t = useT();
  const { user, activeTenant } = useAuth();
  const [tabIndex, setTabIndex] = useState(0);
  const [upcoming, setUpcoming] = useState<WorkerAssignmentItem[]>([]);
  const [past, setPast] = useState<WorkerAssignmentItem[]>([]);
  // Combined calendar feed: confirmed/accepted assignments + submitted
  // applications (per-shift). Separate from upcoming/past which are
  // assignment-only card lists.
  const [calendarItems, setCalendarItems] = useState<WorkerAssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);

  const tenantId = activeTenant?.id ?? C1_TENANT_ID;
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCancelShift = React.useCallback(
    async (assignment: WorkerAssignmentItem) => {
      if (!tenantId || !assignment.assignmentId) return;
      const confirmed = window.confirm(
        t('assignments.cancelShiftConfirm') || 'Are you sure you want to cancel this shift?'
      );
      if (!confirmed) return;
      try {
        const ref = doc(db, 'tenants', tenantId, 'assignments', assignment.assignmentId);
        await updateDoc(ref, {
          status: 'cancelled',
          updatedAt: serverTimestamp(),
        });
        setRefreshKey((k) => k + 1);
      } catch (err) {
        console.error('Failed to cancel shift:', err);
        window.alert(t('assignments.cancelShiftError') || 'Failed to cancel shift. Please try again.');
      }
    },
    [tenantId, t]
  );

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

        const locationIds = new Set<string>();
        snap.docs.forEach((d) => {
          const lid = d.data().locationId;
          if (typeof lid === 'string' && lid) locationIds.add(lid);
        });

        const locationMap: Record<string, LocationInfo> = {};
        await Promise.all(
          Array.from(locationIds).map(async (lid) => {
            const locSnap = await getDoc(doc(db, 'tenants', tenantId, 'locations', lid));
            if (locSnap.exists() && locSnap.data()) {
              const loc = locSnap.data() as Record<string, unknown>;
              locationMap[lid] = {
                street: loc.street as string | undefined,
                city: loc.city as string | undefined,
                state: loc.state as string | undefined,
                zip: loc.zip as string | undefined,
                nickname: (loc.nickname || loc.title || loc.name || loc.locationName) as string | undefined,
                title: loc.title as string | undefined,
                name: loc.name as string | undefined,
                locationName: loc.locationName as string | undefined,
              };
            }
          }),
        );
        if (cancelled) return;

        const today = new Date();
        const todayStr = getCalendarDayLocal(today);

        const up: WorkerAssignmentItem[] = [];
        const pa: WorkerAssignmentItem[] = [];

        snap.docs.forEach((d) => {
          const data = d.data();
          const item = docToItem(d.id, data, tenantId, locationMap);
          const status = (data.status || '').toLowerCase();
          const isPastStatus = ['cancelled', 'canceled', 'declined', 'completed'].includes(status);
          // Show as upcoming until the day after the assignment ends (e.g. assignment 13th–14th stays upcoming through 15th).
          const endDayStr = getCalendarDayLocal(data.endDate || data.startDate);
          let isPastDate = true;
          if (endDayStr && todayStr) {
            const [ey, em, ed] = endDayStr.split('-').map(Number);
            const dayAfterEnd = new Date(ey, em - 1, ed + 1);
            const cutoffStr = getCalendarDayLocal(dayAfterEnd);
            isPastDate = todayStr > cutoffStr;
          } else {
            const startMs = typeof item.startAt === 'number' ? item.startAt : new Date(item.startAt).getTime();
            const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
            isPastDate = startMs < todayMs;
          }

          if (isPastStatus || isPastDate) {
            pa.push(item);
          } else {
            up.push(item);
          }
        });

        // Debug: log raw assignment doc + location so you can see readily available fields for the card
        if (snap.docs.length > 0 && typeof console !== 'undefined' && console.log) {
          const first = snap.docs[0];
          const rawData = first.data();
          const lid = rawData.locationId;
          const loc = lid && locationMap[lid] ? locationMap[lid] : null;
          console.log('[My Assignments] raw assignment doc (first)', {
            docId: first.id,
            ...rawData,
            _locationEnriched: loc,
          });
        }

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

        // ── Calendar feed ────────────────────────────────────────────
        // The calendar shows MORE than assignments: it also surfaces
        // SUBMITTED applications (applied, not yet accepted) as goldenrod
        // entries so a worker sees everything they're tracking in one
        // month view. Per-shift, mirroring the jobs-board logic:
        //   - a shift WITH an assignment is driven by the assignment
        //     (confirmed=blue, accepted=green) — already in up/pa
        //   - a shift on an application but with NO assignment is
        //     'submitted' (goldenrod) and routes to the jobs-board posting
        const assignmentCalItems = [...up, ...pa].filter(
          (i) => i.calendarKind === 'confirmed' || i.calendarKind === 'accepted',
        );
        const assignedShiftIds = new Set<string>();
        snap.docs.forEach((d) => {
          const sid = d.data().shiftId;
          if (sid) assignedShiftIds.add(String(sid));
        });

        const submittedItems: WorkerAssignmentItem[] = [];
        try {
          const appsRef = collection(db, 'tenants', tenantId, 'applications');
          const appsSnap = await getDocs(query(appsRef, where('userId', '==', user.uid)));
          // (jobOrderId, shiftId) → jobPostId; dedup shift-doc reads.
          const shiftReads = new Map<string, { joId: string; shiftId: string; jobPostId: string }>();
          appsSnap.docs.forEach((ad) => {
            const a = ad.data();
            const status = String(a.status || '').toLowerCase();
            if (['withdrawn', 'cancelled', 'canceled', 'deleted', 'rejected'].includes(status)) return;
            const joId = String(a.jobOrderId || '');
            if (!joId) return;
            const jobPostId = String(a.jobId || a.postId || '');
            const sids: string[] = Array.isArray(a.shiftIds)
              ? a.shiftIds
              : a.shiftId
                ? [a.shiftId]
                : [];
            for (const sid of sids) {
              const s = String(sid || '');
              if (!s || assignedShiftIds.has(s)) continue; // assignment drives this shift
              shiftReads.set(`${joId}__${s}`, { joId, shiftId: s, jobPostId });
            }
          });
          await Promise.all(
            Array.from(shiftReads.values()).map(async ({ joId, shiftId, jobPostId }) => {
              try {
                const sDoc = await getDoc(
                  doc(db, 'tenants', tenantId, 'job_orders', joId, 'shifts', shiftId),
                );
                if (!sDoc.exists()) return;
                const sd = sDoc.data() as Record<string, any>;
                const startAt = toStartAt({
                  startDate: sd.shiftDate || sd.startDate,
                  startTime: sd.startTime || sd.defaultStartTime,
                });
                if (!startAt) return;
                const endAt = toEndAt({
                  startDate: sd.shiftDate || sd.startDate,
                  endDate: sd.endDate || sd.shiftDate || sd.startDate,
                  startTime: sd.startTime || sd.defaultStartTime,
                  endTime: sd.endTime || sd.defaultEndTime,
                });
                submittedItems.push({
                  // Prefix so a submitted key never collides with a real
                  // assignment id in the calendar's by-day grouping.
                  assignmentId: `app_${shiftId}`,
                  jobTitle: sd.shiftTitle || sd.defaultJobTitle || 'Shift',
                  startAt,
                  endAt,
                  status: 'scheduled',
                  jobPostId: jobPostId || undefined,
                  calendarKind: 'submitted',
                });
              } catch {
                /* skip unreadable shift */
              }
            }),
          );
        } catch (appErr) {
          console.warn('calendar: submitted-applications load failed', appErr);
        }

        if (!cancelled) setCalendarItems([...assignmentCalItems, ...submittedItems]);
      } catch (err) {
        console.error('Failed to load assignments:', err);
        if (!cancelled) {
          setUpcoming([]);
          setPast([]);
          setCalendarItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [user?.uid, tenantId, refreshKey]);

  return (
    <Box sx={{ maxWidth: 'lg', mx: 'auto' }}>
      <Stack spacing={4} sx={{ py: 2 }}>
        <SmsWarningBanner />
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
            {t('assignments.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('assignments.subtitle')}
          </Typography>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <WorkerAssignmentsTabs
            upcoming={upcoming}
            past={past}
            calendarItems={calendarItems}
            tabIndex={tabIndex}
            onTabChange={setTabIndex}
            onCancelShift={handleCancelShift}
          />
        )}
      </Stack>
    </Box>
  );
};

export default WorkerAssignments;
