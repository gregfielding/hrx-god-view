import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  CircularProgress,
  Alert,
  Stack,
  Paper,
  Grid,
  Link,
} from '@mui/material';
import {
  LocationOn as LocationIcon,
  Work as WorkIcon,
  AttachMoney as MoneyIcon,
  Schedule as ScheduleIcon,
  Business as BusinessIcon,
  ArrowBack as ArrowBackIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Pending as PendingIcon,
  Map as MapIcon,
  OpenInNew as OpenInNewIcon,
  Checkroom as CheckroomIcon,
  Engineering as EngineeringIcon,
} from '@mui/icons-material';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useWorkerPreferredLanguage } from '../hooks/useWorkerPreferredLanguage';
import { useT } from '../i18n';
import { getShiftDisplayText } from '../utils/shiftI18n';
import { parseCalendarDateLocal } from '../utils/dateUtils';
import { getDateScheduleEntriesWithHours } from '../utils/dateSchedule';
import { format } from 'date-fns';

interface AssignmentDetails {
  id: string;
  tenantId: string;
  jobOrderId?: string;
  /** Company (e.g. CRM company) id for easy data access */
  companyId?: string;
  /** Worksite / company location id for easy data access */
  worksiteId?: string;
  /** Shift id for hours, days, and other shift details */
  shiftId?: string;
  jobTitle?: string;
  companyName?: string;
  location?: string;
  worksiteName?: string;
  worksiteAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  payRate?: number;
  startDate?: Date;
  endDate?: Date;
  /** HH:mm - from assignment or shift */
  startTime?: string;
  endTime?: string;
  /** gig = fixed end date possible; career = often ongoing */
  jobOrderType?: 'gig' | 'career';
  status: string;
  hoursWorked?: number;
  totalEarnings?: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
  // Staff instructions from job order
  staffInstructions?: {
    uniform?: { text?: string; files?: any[] };
    checkIn?: { text?: string; files?: any[] };
    firstDay?: { text?: string; files?: any[] };
    parking?: { text?: string; files?: any[] };
    [key: string]: { text?: string; files?: any[] } | undefined;
  };
  /** Bilingual staff instruction text (worker-facing): section -> { en, es }. Fallback to staffInstructions.*.text */
  staffInstructions_i18n?: Record<string, { en?: string; es?: string }>;
  checkInInstructions?: string;
  /** Job order "Uniform Requirements" (pack selection e.g. Business Casual); string or array joined for display */
  uniformRequirements?: string;
  /** Job order "Custom Uniform Requirements" (free text); used on Assignment Info card only */
  customUniformRequirements?: string;
  /** Required PPE (from job order); string or array joined */
  ppeRequirements?: string;
  /** Physical requirements (from job order); shown in Job preparation section */
  physicalRequirements?: string;
}

const AssignmentDetails: React.FC = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const preferredLanguage = useWorkerPreferredLanguage();
  const t = useT();
  const [assignment, setAssignment] = useState<AssignmentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recruiters, setRecruiters] = useState<Array<{ id: string; displayName: string; email?: string; phone?: string }>>([]);
  const [scheduleShift, setScheduleShift] = useState<{
    shiftMode?: 'single' | 'multi';
    shiftDate?: string;
    endDate?: string;
    weeklySchedule?: Record<string, { enabled: boolean; startTime: string; endTime: string }>;
    dateSchedule?: Record<string, { startTime: string; endTime: string }>;
    defaultStartTime?: string;
    defaultEndTime?: string;
    shiftDescription?: string;
    emailIntro?: string;
    shiftDescription_i18n?: { en?: string; es?: string };
    emailIntro_i18n?: { en?: string; es?: string };
  } | null>(null);

  /** Looked-up company name, worksite name, and worksite address when assignment has IDs */
  const [resolvedCompanyName, setResolvedCompanyName] = useState<string | null>(null);
  const [resolvedWorksiteName, setResolvedWorksiteName] = useState<string | null>(null);
  const [resolvedWorksiteAddress, setResolvedWorksiteAddress] = useState<string | null>(null);

  /** Full worksite address string for display and map (resolved or from assignment) */
  const worksiteAddressStr = useMemo(() => {
    const wa = assignment?.worksiteAddress as { street?: string; address?: string; city?: string; state?: string; zipCode?: string } | undefined;
    const fromAssignment = wa ? [(wa.street || wa.address), wa.city, wa.state, wa.zipCode].filter(Boolean).join(', ') : '';
    return resolvedWorksiteAddress || fromAssignment || '';
  }, [assignment?.worksiteAddress, resolvedWorksiteAddress]);

  useEffect(() => {
    console.debug('[AssignmentDetails] init', {
      route: '/c1/workers/assignments/:assignmentId',
      params: { assignmentId: assignmentId ?? null },
      uid: user?.uid ?? null,
    });
    if (!assignmentId) {
      setLoading(false);
      setError('Missing assignmentId route parameter');
      return;
    }
    if (!user?.uid) {
      setLoading(false);
      setError('You must be signed in to view assignment details');
      return;
    }
    loadAssignment();
  }, [assignmentId, user?.uid]);

  useEffect(() => {
    if (!assignment?.tenantId || !assignment?.jobOrderId || !assignment?.shiftId) {
      setScheduleShift(null);
      return;
    }
    let cancelled = false;
    const loadShift = async () => {
      try {
        const shiftRef = doc(db, 'tenants', assignment.tenantId, 'job_orders', assignment.jobOrderId, 'shifts', assignment.shiftId);
        const shiftSnap = await getDoc(shiftRef);
        if (cancelled) return;
        if (shiftSnap.exists()) {
          const d = shiftSnap.data() as Record<string, unknown>;
          setScheduleShift({
            shiftMode: d.shiftMode as 'single' | 'multi' | undefined,
            shiftDate: typeof d.shiftDate === 'string' ? d.shiftDate : undefined,
            endDate: typeof d.endDate === 'string' ? d.endDate : undefined,
            weeklySchedule: d.weeklySchedule as Record<string, { enabled: boolean; startTime: string; endTime: string }> | undefined,
            dateSchedule: d.dateSchedule as Record<string, { startTime: string; endTime: string }> | undefined,
            defaultStartTime: typeof d.defaultStartTime === 'string' ? d.defaultStartTime : undefined,
            defaultEndTime: typeof d.defaultEndTime === 'string' ? d.defaultEndTime : undefined,
            shiftDescription: typeof d.shiftDescription === 'string' ? d.shiftDescription : undefined,
            emailIntro: typeof d.emailIntro === 'string' ? d.emailIntro : undefined,
            shiftDescription_i18n: d.shiftDescription_i18n as { en?: string; es?: string } | undefined,
            emailIntro_i18n: d.emailIntro_i18n as { en?: string; es?: string } | undefined,
          });
        } else {
          setScheduleShift(null);
        }
      } catch (_) {
        if (!cancelled) setScheduleShift(null);
      }
    };
    loadShift();
    return () => { cancelled = true; };
  }, [assignment?.tenantId, assignment?.jobOrderId, assignment?.shiftId]);

  useEffect(() => {
    if (!assignment?.tenantId || !assignment?.jobOrderId) {
      setRecruiters([]);
      return;
    }
    let cancelled = false;
    const loadRecruiters = async () => {
      try {
        const jobOrderRef = doc(db, 'tenants', assignment.tenantId, 'job_orders', assignment.jobOrderId);
        const jobOrderSnap = await getDoc(jobOrderRef);
        if (cancelled) return;
        const ids: string[] = [];
        if (jobOrderSnap.exists()) {
          const data = jobOrderSnap.data() as Record<string, unknown>;
          const assigned = data.assignedRecruiters as string[] | undefined;
          const legacyId = data.recruiterId as string | undefined;
          if (Array.isArray(assigned) && assigned.length > 0) {
            ids.push(...assigned);
          } else if (legacyId) {
            ids.push(legacyId);
          }
        }
        const uniq = Array.from(new Set(ids));
        const list: Array<{ id: string; displayName: string; email?: string; phone?: string }> = [];
        for (const uid of uniq) {
          try {
            const userSnap = await getDoc(doc(db, 'users', uid));
            if (cancelled) return;
            if (userSnap.exists()) {
              const d = userSnap.data() as Record<string, unknown>;
              const firstName = (d.firstName as string) || '';
              const lastName = (d.lastName as string) || '';
              const displayName = `${firstName} ${lastName}`.trim() || (d.displayName as string) || (d.email as string) || 'Recruiter';
              const phone = (d.phone as string) || (d.phoneNumber as string) || (d.phoneE164 as string) || undefined;
              list.push({
                id: uid,
                displayName,
                email: d.email as string | undefined,
                phone: phone && String(phone).trim() ? String(phone).trim() : undefined,
              });
            } else {
              list.push({ id: uid, displayName: 'Recruiter' });
            }
          } catch (_) {
            list.push({ id: uid, displayName: 'Your recruiter' });
          }
        }
        if (!cancelled) setRecruiters(list);
      } catch (_) {
        if (!cancelled) setRecruiters([]);
      }
    };
    loadRecruiters();
    return () => { cancelled = true; };
  }, [assignment?.tenantId, assignment?.jobOrderId]);

  useEffect(() => {
    if (!assignment?.tenantId) {
      setResolvedCompanyName(null);
      setResolvedWorksiteName(null);
      setResolvedWorksiteAddress(null);
      return;
    }
    let cancelled = false;
    const tid = assignment.tenantId;
    const companyId = assignment.companyId;
    const worksiteId = assignment.worksiteId;

    const looksLikeDocId = (s: unknown): boolean => {
      if (typeof s !== 'string' || !s) return false;
      const t = s.trim();
      return t.length >= 15 && t.length <= 30 && /^[a-zA-Z0-9_-]+$/.test(t);
    };

    const load = async () => {
      try {
        if (!companyId) setResolvedCompanyName(null);
        if (!worksiteId) {
          setResolvedWorksiteName(null);
          setResolvedWorksiteAddress(null);
        }
        if (companyId && (!assignment.companyName || looksLikeDocId(assignment.companyName))) {
          const companyRef = doc(db, 'tenants', tid, 'crm_companies', companyId);
          const companySnap = await getDoc(companyRef);
          if (cancelled) return;
          if (companySnap.exists()) {
            const d = companySnap.data() as Record<string, unknown>;
            const name = (d.name || d.companyName) as string | undefined;
            if (name && !looksLikeDocId(name)) setResolvedCompanyName(name);
          }
        } else {
          setResolvedCompanyName(null);
        }

        if (worksiteId) {
          const needLookup = !assignment.worksiteName && !assignment.location ||
            looksLikeDocId(assignment.worksiteName) || looksLikeDocId(assignment.location);
          const needAddress = !assignment.worksiteAddress || (
            !assignment.worksiteAddress.street && !assignment.worksiteAddress.city &&
            !assignment.worksiteAddress.state && !assignment.worksiteAddress.zipCode
          );
          if (needLookup || needAddress) {
            let locSnap = null;
            if (companyId) {
              locSnap = await getDoc(doc(db, 'tenants', tid, 'crm_companies', companyId, 'locations', worksiteId));
            }
            if (!locSnap?.exists()) {
              locSnap = await getDoc(doc(db, 'tenants', tid, 'locations', worksiteId));
            }
            if (cancelled) return;
            if (locSnap?.exists()) {
              const loc = locSnap.data() as Record<string, unknown>;
              if (needLookup) {
                const name = (loc.nickname || loc.title || loc.name || loc.locationName) as string | undefined;
                if (name && !looksLikeDocId(name)) setResolvedWorksiteName(name);
              }
              if (needAddress) {
                const street = (loc.address || loc.street) as string | undefined;
                const zip = (loc.zipCode ?? loc.zipcode) as string | undefined;
                const parts = [street, loc.city, loc.state, zip].filter(Boolean) as string[];
                if (parts.length) setResolvedWorksiteAddress(parts.join(', '));
              }
            } else {
              if (needLookup) setResolvedWorksiteName(null);
              if (needAddress) setResolvedWorksiteAddress(null);
            }
          } else {
            setResolvedWorksiteName(null);
            setResolvedWorksiteAddress(null);
          }
        } else {
          setResolvedWorksiteName(null);
          setResolvedWorksiteAddress(null);
        }
      } catch (_) {
        if (!cancelled) {
          setResolvedCompanyName(null);
          setResolvedWorksiteName(null);
          setResolvedWorksiteAddress(null);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [assignment?.tenantId, assignment?.companyId, assignment?.worksiteId, assignment?.companyName, assignment?.worksiteName, assignment?.location, assignment?.worksiteAddress]);

  useEffect(() => {
    if (assignment && typeof console !== 'undefined' && console.log) {
      console.log('[Assignment Details] assignment (resolved for UI)', assignment);
    }
  }, [assignment]);

  const loadAssignment = async () => {
    if (!assignmentId || !user?.uid) return;

    try {
      setLoading(true);
      setError('');
      console.debug('[AssignmentDetails] fetch start', {
        assignmentId,
        uid: user.uid,
      });

      // Check if this is a confirmed application (prefixed with "app_")
      if (assignmentId.startsWith('app_')) {
        // Load from confirmed application
        const applicationId = assignmentId.replace('app_', '');
        
        // Get tenant IDs from user
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        const tenantIds: string[] = [];
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          if (userData.tenantIds && typeof userData.tenantIds === 'object') {
            tenantIds.push(...Object.keys(userData.tenantIds));
          }
          if (!tenantIds.includes('c1')) {
            tenantIds.push('c1');
          }
        }
        
        // Find the application across tenants
        let applicationData: any = null;
        let foundTenantId = '';
        
        for (const tenantId of tenantIds) {
          try {
            const applicationRef = doc(db, 'tenants', tenantId, 'applications', applicationId);
            const applicationSnap = await getDoc(applicationRef);
            
            if (applicationSnap.exists() && applicationSnap.data().userId === user.uid) {
              applicationData = applicationSnap.data();
              foundTenantId = tenantId;
              break;
            }
          } catch (err) {
            // Continue to next tenant
          }
        }
        
        if (!applicationData || !applicationData.jobOrderId) {
          setError('Assignment not found');
          setLoading(false);
          return;
        }
        
        // Load job order details
        await loadFromJobOrder(foundTenantId, applicationData.jobOrderId, applicationData);
        return;
      }

      const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

      // Try legacy structure first (root assignments collection)
      const assignmentRef = doc(db, 'assignments', assignmentId);
      let assignmentSnap = await getDoc(assignmentRef);

      // If not in legacy collection, try tenant-scoped. Try C1 first so worker "View details" only needs assignment rule to allow read.
      if (!assignmentSnap.exists()) {
        const tenantIdsToTry: string[] = [C1_TENANT_ID];
        try {
          const userRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const userData = userSnap.data();
            if (userData?.tenantIds && typeof userData.tenantIds === 'object') {
              const keys = Object.keys(userData.tenantIds);
              const rest = keys.filter((k) => k !== C1_TENANT_ID);
              tenantIdsToTry.push(...rest);
            }
          }
        } catch (_) {
          // Proceed with C1 only if user doc read fails (e.g. permissions)
        }
        for (const tid of tenantIdsToTry) {
          const tenantAssignmentRef = doc(db, 'tenants', tid, 'assignments', assignmentId);
          const snap = await getDoc(tenantAssignmentRef);
          if (snap.exists()) {
            const d = snap.data();
            if ((d?.userId || d?.candidateId) === user.uid) {
              assignmentSnap = snap;
              break;
            }
          }
        }
      }

      if (!assignmentSnap.exists()) {
        console.warn('[AssignmentDetails] fetch missing', { assignmentId });
        setError('Assignment not found');
        setLoading(false);
        return;
      }

      const data = assignmentSnap.data();
      const resolvedTenantId = data.tenantId || (assignmentSnap.ref.parent?.parent?.id);

      if (typeof console !== 'undefined' && console.log) {
        console.log('[Assignment Details] assignment by id (raw doc)', {
          assignmentId: assignmentSnap.id,
          tenantId: resolvedTenantId,
          ...data,
        });
      }

      // Verify this assignment belongs to the current user
      if ((data.userId || data.candidateId) !== user.uid) {
        console.warn('[AssignmentDetails] fetch forbidden', {
          assignmentId: assignmentSnap.id,
          assignmentUserId: data.userId || data.candidateId || null,
          uid: user.uid,
        });
        setError('You do not have permission to view this assignment');
        setLoading(false);
        return;
      }

      // Parse dates (support both Firestore Timestamp and string, and startTime/endTime)
      let startDate: Date | undefined;
      let endDate: Date | undefined;
      let createdAt: Date | undefined;
      let updatedAt: Date | undefined;

      if (data.startDate) {
        startDate = parseCalendarDateLocal(data.startDate);
      }
      if (data.endDate) {
        endDate = parseCalendarDateLocal(data.endDate);
      } else if (data.startDate && (data.startTime || data.endTime)) {
        const dayStr = typeof data.startDate === 'string' ? data.startDate.split('T')[0] : data.startDate?.toDate?.()?.toISOString?.()?.slice(0, 10);
        if (dayStr && data.endTime) {
          const [y, m, d] = dayStr.split('-').map(Number);
          const [hh, mm] = String(data.endTime).slice(0, 5).split(':').map(Number);
          endDate = new Date(y, m - 1, d, hh || 0, mm || 0);
        }
      }
      if (data.createdAt) {
        createdAt = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
      }
      if (data.updatedAt) {
        updatedAt = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);
      }

      const jobTitle = data.jobTitle || '';
      const companyName = data.companyName || '';
      const location = data.location || data.worksiteName || data.locationNickname || '';
      const worksiteName = data.worksiteName || data.locationNickname || '';
      const worksiteAddress = data.worksiteAddress || data.address;

      // Load job order details if available
      if (data.jobOrderId && resolvedTenantId) {
        await loadFromJobOrder(resolvedTenantId, data.jobOrderId, data, assignmentSnap.id);
        return;
      }

      // If no job order, set assignment with basic data
      setAssignment({
        id: assignmentSnap.id,
        tenantId: resolvedTenantId || '',
        jobOrderId: data.jobOrderId,
        companyId: data.companyId,
        worksiteId: data.locationId,
        shiftId: data.shiftId,
        jobTitle,
        companyName,
        location,
        worksiteName,
        worksiteAddress,
        payRate: data.payRate,
        startDate,
        endDate,
        startTime: data.startTime,
        endTime: data.endTime,
        jobOrderType: data.jobOrderType === 'career' || data.jobOrderType === 'gig' ? data.jobOrderType : undefined,
        status: (data.status || 'pending').toLowerCase(),
        hoursWorked: data.hoursWorked,
        totalEarnings: data.totalEarnings,
        notes: data.notes,
        createdAt,
        updatedAt,
        staffInstructions: data.staffInstructions,
        uniformRequirements: typeof data.uniformRequirements === 'string' ? data.uniformRequirements : (Array.isArray(data.uniformRequirements) ? data.uniformRequirements.filter(Boolean).join(', ') : undefined),
        customUniformRequirements: data.customUniformRequirements,
        ppeRequirements: Array.isArray(data.ppeRequirements)
          ? data.ppeRequirements.filter(Boolean).join(', ')
          : typeof data.ppeRequirements === 'string'
            ? data.ppeRequirements
            : undefined,
        physicalRequirements: Array.isArray(data.physicalRequirements)
          ? data.physicalRequirements.filter(Boolean).join(', ')
          : typeof data.physicalRequirements === 'string'
            ? data.physicalRequirements
            : undefined,
      });
      console.debug('[AssignmentDetails] fetch success', {
        assignmentId: assignmentSnap.id,
        tenantId: resolvedTenantId || null,
        hasJobOrderId: Boolean(data.jobOrderId),
      });
    } catch (err: any) {
      console.error('Error loading assignment:', err);
      console.error('[AssignmentDetails] fetch failure', {
        assignmentId,
        code: err?.code,
        message: err?.message,
      });
      setError(err.message || 'Failed to load assignment');
    } finally {
      setLoading(false);
    }
  };

  const loadFromJobOrder = async (
    tenantId: string,
    jobOrderId: string,
    sourceData: any,
    assignmentId?: string
  ) => {
    try {
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      const jobOrderSnap = await getDoc(jobOrderRef);

      if (!jobOrderSnap.exists()) {
        setError('Job order not found');
        setLoading(false);
        return;
      }

      const jobOrderData = jobOrderSnap.data();
      
      // Parse dates: prefer assignment (shift) start/end when present
      let startDate: Date | undefined;
      let endDate: Date | undefined;
      let createdAt: Date | undefined;
      let updatedAt: Date | undefined;

      if (sourceData.startDate) {
        startDate = parseCalendarDateLocal(sourceData.startDate);
      }
      if (!startDate && jobOrderData.startDate) {
        startDate = parseCalendarDateLocal(jobOrderData.startDate);
      }
      if (sourceData.endDate) {
        endDate = parseCalendarDateLocal(sourceData.endDate);
      }
      if (!endDate && jobOrderData.endDate) {
        endDate = parseCalendarDateLocal(jobOrderData.endDate);
      }
      if (sourceData.createdAt) {
        createdAt = sourceData.createdAt.toDate ? sourceData.createdAt.toDate() : new Date(sourceData.createdAt);
      }
      if (sourceData.updatedAt) {
        updatedAt = sourceData.updatedAt.toDate ? sourceData.updatedAt.toDate() : new Date(sourceData.updatedAt);
      }

      // Get location from worksite: prefer assignment denormalized, else job order
      const worksiteAddress = sourceData.worksiteAddress || sourceData.address || jobOrderData.worksiteAddress;
      let location = sourceData.location || sourceData.worksiteName || sourceData.locationNickname || '';
      let worksiteName = sourceData.worksiteName || sourceData.locationNickname || '';
      if (!worksiteName && jobOrderData.worksiteName) {
        worksiteName = jobOrderData.worksiteName;
        if (!location) location = jobOrderData.worksiteName;
      }
      if (!location && jobOrderData.worksiteAddress) {
        const addr = jobOrderData.worksiteAddress;
        if (addr.city && addr.state) location = `${addr.city}, ${addr.state}`;
      }

      setAssignment({
        id: assignmentId || `jobOrder_${jobOrderId}`,
        tenantId: tenantId,
        jobOrderId: jobOrderId,
        companyId: sourceData.companyId ?? jobOrderData.companyId,
        worksiteId: sourceData.locationId ?? jobOrderData.worksiteId ?? jobOrderData.locationId,
        shiftId: sourceData.shiftId,
        jobTitle: sourceData.jobTitle || jobOrderData.jobOrderName || jobOrderData.jobTitle || '',
        companyName: sourceData.companyName || jobOrderData.companyName || '',
        location,
        worksiteName,
        worksiteAddress,
        payRate: sourceData.payRate ?? jobOrderData.payRate,
        startDate,
        endDate,
        startTime: sourceData.startTime,
        endTime: sourceData.endTime,
        jobOrderType: sourceData.jobOrderType === 'career' || sourceData.jobOrderType === 'gig' ? sourceData.jobOrderType : (jobOrderData.jobType === 'career' || jobOrderData.jobType === 'gig' ? jobOrderData.jobType : undefined),
        status: sourceData.status || 'confirmed',
        hoursWorked: sourceData.hoursWorked,
        totalEarnings: sourceData.totalEarnings,
        notes: sourceData.notes || jobOrderData.jobOrderDescription,
        createdAt,
        updatedAt,
        // Load staff instructions (legacy + i18n for worker portal language)
        staffInstructions: jobOrderData.staffInstructions || {},
        staffInstructions_i18n: jobOrderData.staffInstructions_i18n || undefined,
        checkInInstructions: jobOrderData.checkInInstructions,
        uniformRequirements: Array.isArray(jobOrderData.uniformRequirements) ? jobOrderData.uniformRequirements.filter(Boolean).join(', ') : (typeof jobOrderData.uniformRequirements === 'string' ? jobOrderData.uniformRequirements : undefined),
        customUniformRequirements: typeof jobOrderData.customUniformRequirements === 'string' ? jobOrderData.customUniformRequirements : undefined,
        ppeRequirements: Array.isArray(jobOrderData.ppeRequirements)
          ? jobOrderData.ppeRequirements.filter(Boolean).join(', ')
          : typeof jobOrderData.ppeRequirements === 'string'
            ? jobOrderData.ppeRequirements
            : undefined,
        physicalRequirements: Array.isArray(jobOrderData.physicalRequirements)
          ? jobOrderData.physicalRequirements.filter(Boolean).join(', ')
          : typeof jobOrderData.physicalRequirements === 'string'
            ? jobOrderData.physicalRequirements
            : undefined,
      });
    } catch (err: any) {
      console.error('Error loading job order:', err);
      setError(err.message || 'Failed to load job order details');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'success';
      case 'completed':
        return 'default';
      case 'pending':
      case 'proposed':
      case 'confirmed':
        return 'warning';
      case 'cancelled':
      case 'terminated':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return <CheckCircleIcon />;
      case 'completed':
        return <CheckCircleIcon />;
      case 'cancelled':
      case 'terminated':
        return <CancelIcon />;
      default:
        return <PendingIcon />;
    }
  };

  const formatDate = (date: Date): string => {
    return format(date, 'MMMM dd, yyyy');
  };

  const formatDateTime = (date: Date): string => {
    return format(date, 'MMMM dd, yyyy, h:mm a');
  };

  /** Format HH:mm to "9:00 AM" */
  const formatTime = (t: string | undefined): string => {
    if (!t || typeof t !== 'string') return '';
    const [h, m] = t.trim().split(':');
    const hh = Math.max(0, Math.min(23, parseInt(h, 10) || 0));
    const mm = Math.max(0, Math.min(59, parseInt(m, 10) || 0));
    const d = new Date(2000, 0, 1, hh, mm);
    return format(d, 'h:mm a');
  };

  /** Day-of-week order for display: Mon .. Sun (1..6, 0). Labels translated. */
  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const DOW_LABELS: Record<number, string> = {
    0: t('assignment.sunday'),
    1: t('assignment.monday'),
    2: t('assignment.tuesday'),
    3: t('assignment.wednesday'),
    4: t('assignment.thursday'),
    5: t('assignment.friday'),
    6: t('assignment.saturday'),
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(-1)}
          sx={{ mt: 2 }}
        >
          Go Back
        </Button>
      </Box>
    );
  }

  if (!assignment) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Assignment not found</Alert>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(-1)}
          sx={{ mt: 2 }}
        >
          Go Back
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ flexGrow: 1, fontWeight: 700 }}>
          Assignment Details
        </Typography>
        <Chip
          icon={getStatusIcon(assignment.status)}
          label={assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1)}
          color={getStatusColor(assignment.status)}
          size="medium"
        />
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(-1)}
          variant="outlined"
        >
          Back
        </Button>
      </Stack>

      {/* Main Content: two columns with gap */}
      <Grid container spacing={3}>
        {/* Left column: assignment cards */}
        <Grid item xs={12} md={9}>
          <Stack spacing={3}>
        {/* Assignment Info (combined): two columns, company/worksite/address looked up when needed */}
        <Card elevation={0} sx={{ borderRadius: 0 }}>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              {t('assignment.assignmentInfo')}
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <WorkIcon color="action" sx={{ flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" color="text.secondary">{t('assignment.jobTitle')}</Typography>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>
                        {assignment.jobTitle || '—'}
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <ScheduleIcon color="action" sx={{ flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" color="text.secondary">{t('common.startDate')}</Typography>
                      <Typography variant="body1">
                        {assignment.startDate ? formatDate(assignment.startDate) : '—'}
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <MoneyIcon color="action" sx={{ flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" color="text.secondary">{t('jobs.payRate')}</Typography>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>
                        {assignment.payRate != null ? `$${assignment.payRate}/hr` : '—'}
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <BusinessIcon color="action" sx={{ flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" color="text.secondary">{t('assignment.companyName')}</Typography>
                      <Typography variant="body1">
                        {resolvedCompanyName ?? assignment.companyName ?? '—'}
                      </Typography>
                    </Box>
                  </Stack>
                </Stack>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <LocationIcon color="action" sx={{ flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" color="text.secondary">{t('assignment.worksiteName')}</Typography>
                      <Typography variant="body1">
                        {resolvedWorksiteName ?? assignment.worksiteName ?? assignment.location ?? '—'}
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <MapIcon color="action" sx={{ flexShrink: 0 }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" color="text.secondary">{t('assignment.worksiteAddress')}</Typography>
                      {worksiteAddressStr ? (
                          <Button
                            size="small"
                            startIcon={<OpenInNewIcon />}
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(worksiteAddressStr)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ textTransform: 'none', p: 0, minHeight: 'auto' }}
                          >
                            {worksiteAddressStr}
                          </Button>
                        ) : (
                          <Typography variant="body1">—</Typography>
                        )}
                    </Box>
                  </Stack>
                  {/* Job preparation — uniform, PPE, physical (moved from job post to assignment) */}
                  <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 600, mt: 0.5 }}>
                    {t('jobs.jobPreparation')}
                  </Typography>
                  <Stack direction="row" spacing={2} alignItems="flex-start">
                    <CheckroomIcon color="action" sx={{ flexShrink: 0, mt: 0.5 }} />
                    <Box>
                      <Typography variant="body2" color="text.secondary">{t('assignment.requiredUniform')}</Typography>
                      <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                        {(assignment.uniformRequirements || assignment.customUniformRequirements)
                          ? [assignment.uniformRequirements, assignment.customUniformRequirements].filter(Boolean).join('\n\n')
                          : '—'}
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={2} alignItems="flex-start">
                    <EngineeringIcon color="action" sx={{ flexShrink: 0, mt: 0.5 }} />
                    <Box>
                      <Typography variant="body2" color="text.secondary">{t('assignment.requiredPpe')}</Typography>
                      <Typography variant="body1">
                        {assignment.ppeRequirements || '—'}
                      </Typography>
                    </Box>
                  </Stack>
                  {assignment.physicalRequirements && (
                    <Stack direction="row" spacing={2} alignItems="flex-start">
                      <WorkIcon color="action" sx={{ flexShrink: 0, mt: 0.5 }} />
                      <Box>
                        <Typography variant="body2" color="text.secondary">Physical requirements</Typography>
                        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                          {assignment.physicalRequirements}
                        </Typography>
                      </Box>
                    </Stack>
                  )}
                </Stack>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Schedule */}
        <Card elevation={0} sx={{ borderRadius: 0 }}>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              {t('assignment.mySchedule')}
            </Typography>
            <Stack spacing={2}>
              {scheduleShift?.shiftMode === 'multi' && scheduleShift?.dateSchedule && scheduleShift?.shiftDate && (() => {
                const entries = getDateScheduleEntriesWithHours(scheduleShift.dateSchedule, scheduleShift.shiftDate, scheduleShift.endDate);
                return entries.length > 0;
              })() ? (
                <>
                  <Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('assignment.weeklySchedule')}</Typography>
                    <Stack spacing={0.5} component="ul" sx={{ pl: 2.5, m: 0 }}>
                      {getDateScheduleEntriesWithHours(scheduleShift!.dateSchedule!, scheduleShift!.shiftDate!, scheduleShift!.endDate).map((e) => (
                        <Typography key={e.date} component="li" variant="body2">
                          {e.dayLabel}: {formatTime(e.startTime)} – {formatTime(e.endTime)}
                        </Typography>
                      ))}
                    </Stack>
                  </Box>
                  {assignment.startDate && (
                    <Box>
                      <Typography variant="body2" color="text.secondary">{t('common.startDate')}</Typography>
                      <Typography variant="body1">{formatDate(assignment.startDate)}</Typography>
                    </Box>
                  )}
                  {assignment.jobOrderType === 'gig' && (assignment.endDate || scheduleShift.endDate) && (
                    <Box>
                      <Typography variant="body2" color="text.secondary">{t('assignment.endDate')}</Typography>
                      <Typography variant="body1">
                        {assignment.endDate ? formatDate(assignment.endDate) : (scheduleShift.endDate ? new Date(scheduleShift.endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—')}
                      </Typography>
                    </Box>
                  )}
                </>
              ) : scheduleShift?.shiftMode === 'multi' && scheduleShift?.weeklySchedule && Object.keys(scheduleShift.weeklySchedule).length > 0 ? (
                <>
                  <Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('assignment.weeklySchedule')}</Typography>
                    <Stack spacing={0.5} component="ul" sx={{ pl: 2.5, m: 0 }}>
                      {DOW_ORDER.map((dow) => {
                        const entry = scheduleShift.weeklySchedule![String(dow)];
                        if (!entry?.enabled) return null;
                        const start = formatTime(entry.startTime);
                        const end = formatTime(entry.endTime);
                        return (
                          <Typography key={dow} component="li" variant="body2">
                            {DOW_LABELS[dow]}: {start} – {end}
                          </Typography>
                        );
                      })}
                    </Stack>
                  </Box>
                  {assignment.startDate && (
                    <Box>
                      <Typography variant="body2" color="text.secondary">{t('common.startDate')}</Typography>
                      <Typography variant="body1">{formatDate(assignment.startDate)}</Typography>
                    </Box>
                  )}
                  {assignment.jobOrderType === 'gig' && (assignment.endDate || scheduleShift.endDate) && (
                    <Box>
                      <Typography variant="body2" color="text.secondary">{t('assignment.endDate')}</Typography>
                      <Typography variant="body1">
                        {assignment.endDate ? formatDate(assignment.endDate) : (scheduleShift.endDate ? new Date(scheduleShift.endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—')}
                      </Typography>
                    </Box>
                  )}
                  {assignment.jobOrderType === 'career' && !assignment.endDate && !scheduleShift.endDate && (
                    <Box>
                      <Typography variant="body2" color="text.secondary">Duration</Typography>
                      <Typography variant="body1">Ongoing</Typography>
                    </Box>
                  )}
                </>
              ) : (
                <>
                  {assignment.startDate && (
                    <Box>
                      <Typography variant="body2" color="text.secondary">Date</Typography>
                      <Typography variant="body1">{formatDate(assignment.startDate)}</Typography>
                    </Box>
                  )}
                  {(assignment.startTime || assignment.endTime || scheduleShift?.defaultStartTime || scheduleShift?.defaultEndTime) && (
                    <Box>
                      <Typography variant="body2" color="text.secondary">Time</Typography>
                      <Typography variant="body1">
                        {[
                          formatTime(assignment.startTime || scheduleShift?.defaultStartTime),
                          formatTime(assignment.endTime || scheduleShift?.defaultEndTime),
                        ]
                          .filter(Boolean)
                          .join(' – ')}
                      </Typography>
                    </Box>
                  )}
                  {assignment.endDate && (
                    <Box>
                      <Typography variant="body2" color="text.secondary">End date</Typography>
                      <Typography variant="body1">{formatDate(assignment.endDate)}</Typography>
                    </Box>
                  )}
                  {!assignment.startDate && !assignment.startTime && !assignment.endTime && !scheduleShift?.defaultStartTime && (
                    <Typography variant="body2" color="text.secondary">No schedule details available.</Typography>
                  )}
                </>
              )}

              {getShiftDisplayText(scheduleShift ?? undefined, 'shiftDescription', preferredLanguage).trim() && (
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Shift-Specific Details or Job Description</Typography>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{getShiftDisplayText(scheduleShift ?? undefined, 'shiftDescription', preferredLanguage)}</Typography>
                </Box>
              )}

              {getShiftDisplayText(scheduleShift ?? undefined, 'emailIntro', preferredLanguage).trim() && (
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Shift Info to Email Staff</Typography>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{getShiftDisplayText(scheduleShift ?? undefined, 'emailIntro', preferredLanguage)}</Typography>
                </Box>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* Staff Instructions: one card per section; show i18n text by preferred language, fallback to legacy .text */}
        {(() => {
          const legacyToStr = (val: unknown): string => {
            if (val == null) return '';
            if (typeof val === 'string') return val;
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
              const o = val as Record<string, unknown>;
              const en = o.en;
              const es = o.es;
              if (preferredLanguage === 'es' && typeof es === 'string') return es;
              if (typeof en === 'string') return en;
              if (typeof es === 'string') return es;
              return '';
            }
            return '';
          };
          const getStaffText = (sectionKey: string): string => {
            const i18n = assignment.staffInstructions_i18n?.[sectionKey];
            const legacy = assignment.staffInstructions?.[sectionKey]?.text;
            const fromI18n = i18n?.[preferredLanguage];
            const fromLegacy = legacyToStr(legacy);
            const fallback = sectionKey === 'checkIn' ? (assignment.checkInInstructions ?? '') : '';
            const text = (fromI18n ?? fromLegacy ?? fallback).trim();
            return typeof text === 'string' ? text : '';
          };
          const sections: Array<{ key: string; title: string; getText: () => string; getFiles: () => any[] }> = [
            {
              key: 'firstDay',
              title: t('assignment.firstDayInstructions'),
              getText: () => getStaffText('firstDay'),
              getFiles: () => assignment.staffInstructions?.firstDay?.files ?? [],
            },
            {
              key: 'parking',
              title: t('assignment.parkingInstructions'),
              getText: () => getStaffText('parking'),
              getFiles: () => assignment.staffInstructions?.parking?.files ?? [],
            },
            {
              key: 'checkIn',
              title: t('assignment.checkInInstructions'),
              getText: () => getStaffText('checkIn'),
              getFiles: () => assignment.staffInstructions?.checkIn?.files ?? [],
            },
            {
              key: 'uniform',
              title: t('assignment.uniformInstructions'),
              getText: () => getStaffText('uniform'),
              getFiles: () => assignment.staffInstructions?.uniform?.files ?? [],
            },
            {
              key: 'credentials',
              title: t('assignment.credentialInstructions'),
              getText: () => getStaffText('credentials'),
              getFiles: () => assignment.staffInstructions?.credentials?.files ?? [],
            },
            {
              key: 'other',
              title: t('assignment.otherInstructions'),
              getText: () => getStaffText('other'),
              getFiles: () => assignment.staffInstructions?.other?.files ?? [],
            },
            {
              key: 'attachments',
              title: t('assignment.otherAttachments'),
              getText: () => '',
              getFiles: () => assignment.staffInstructions?.attachments?.files ?? [],
            },
          ];
          return sections
            .filter((s) => {
              const text = s.getText();
              const files = s.getFiles();
              return (typeof text === 'string' && text.trim() !== '') || (Array.isArray(files) && files.length > 0);
            })
            .map((s) => {
              const text = s.getText();
              const files = s.getFiles();
              return (
                <Card key={s.key} elevation={0} sx={{ borderRadius: 0 }}>
                  <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                      {s.title}
                    </Typography>
                    <Stack spacing={1.5}>
                      {text.trim() !== '' && (
                        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                          {text}
                        </Typography>
                      )}
                      {Array.isArray(files) && files.length > 0 && (
                        <Stack spacing={1} direction="row" flexWrap="wrap" useFlexGap>
                          {files.map((file: any, index: number) => (
                            <Button
                              key={index}
                              variant="outlined"
                              size="small"
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {file.label || file.name || t('common.viewFile')}
                            </Button>
                          ))}
                        </Stack>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              );
            });
        })()}

        {/* Notes */}
        {assignment.notes && (
          <Card elevation={0} sx={{ borderRadius: 0 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                Additional Notes
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                {assignment.notes}
              </Typography>
            </CardContent>
          </Card>
        )}

        {/* Metadata */}
        {(assignment.createdAt || assignment.updatedAt) && (
          <Paper elevation={0} sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 0 }}>
            <Stack spacing={1}>
              {assignment.createdAt && (
                <Typography variant="caption" color="text.secondary">
                  Created: {formatDateTime(assignment.createdAt)}
                </Typography>
              )}
              {assignment.updatedAt && (
                <Typography variant="caption" color="text.secondary">
                  Last Updated: {formatDateTime(assignment.updatedAt)}
                </Typography>
              )}
            </Stack>
          </Paper>
        )}

        {/* Location map card — only when we have a worksite address */}
        {worksiteAddressStr && (
          <Card elevation={0} sx={{ borderRadius: 0 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                {t('assignment.locationMap')}
              </Typography>
              <Box
                sx={{
                  width: '100%',
                  height: 320,
                  borderRadius: 1,
                  overflow: 'hidden',
                  bgcolor: 'grey.100',
                }}
              >
                <iframe
                  title={t('assignment.locationMap')}
                  src={`https://www.google.com/maps?output=embed&q=${encodeURIComponent(worksiteAddressStr)}`}
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </Box>
              <Button
                size="small"
                startIcon={<OpenInNewIcon />}
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(worksiteAddressStr)}`}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ mt: 1.5, textTransform: 'none' }}
              >
                {t('assignment.openInGoogleMaps')}
              </Button>
            </CardContent>
          </Card>
        )}
          </Stack>
        </Grid>

        {/* Right column: cards */}
        <Grid item xs={12} md={3}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Card>
              <CardHeader
                title="My Recruiter"
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              />
              <CardContent sx={{ pt: 0 }}>
                {recruiters.length > 0 ? (
                  <Stack spacing={2}>
                    {recruiters.map((r) => (
                      <Stack key={r.id} spacing={0.75} component="div">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {r.displayName}
                        </Typography>
                        {r.phone && (
                          <Typography variant="body2">
                            <Link
                              component="a"
                              href={`sms:${r.phone.replace(/[^\d+]/g, '')}`}
                              sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                            >
                              {r.phone}
                            </Link>
                          </Typography>
                        )}
                        {r.email && (
                          <Typography variant="body2">
                            <Link
                              component="a"
                              href={`mailto:${r.email}`}
                              sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                            >
                              {r.email}
                            </Link>
                          </Typography>
                        )}
                      </Stack>
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('assignment.noRecruiterAssigned')}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};

export default AssignmentDetails;


