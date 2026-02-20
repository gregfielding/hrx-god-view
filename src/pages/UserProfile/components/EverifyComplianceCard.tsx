import React, { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Chip,
  Button,
  Tooltip,
  CircularProgress,
  Stack,
  Alert,
} from '@mui/material';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';

interface EverifyComplianceCardProps {
  tenantId: string;
  userId: string;
  assignmentId?: string;
  userEmploymentId?: string;
}

export const EverifyComplianceCard: React.FC<EverifyComplianceCardProps> = ({
  tenantId,
  userId,
  assignmentId,
  userEmploymentId,
}) => {
  const { activeTenant, isHRX, claimsRoles } = useAuth();
  const effectiveTenantId = tenantId || activeTenant?.id;
  const [i9Status, setI9Status] = useState<string>('');
  const [everifyStatus, setEverifyStatus] = useState<string>('');
  const [everifyCaseId, setEverifyCaseId] = useState<string | null>(null);
  const [blockingReasons, setBlockingReasons] = useState<string[]>([]);
  const [checkLoading, setCheckLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  const isAdmin = isHRX || claimsRoles?.[effectiveTenantId || '']?.role === 'Admin';

  const [resolvedAssignmentId, setResolvedAssignmentId] = useState<string | undefined>(undefined);
  const [resolvedUserEmploymentId, setResolvedUserEmploymentId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!effectiveTenantId || !userId) return;

    const load = async () => {
      try {
        const [empSnap, casesSnap, assignSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, 'tenants', effectiveTenantId, 'user_employments'),
              where('userId', '==', userId)
            )
          ),
          getDocs(
            query(
              collection(db, 'tenants', effectiveTenantId, 'everify_cases_public'),
              where('userId', '==', userId)
            )
          ),
          getDocs(
            query(
              collection(db, 'tenants', effectiveTenantId, 'assignments'),
              where('candidateId', '==', userId)
            )
          ),
        ]);

        if (!assignSnap.empty) {
          const a = assignSnap.docs[0];
          setResolvedAssignmentId(a.id);
        } else {
          const byUser = await getDocs(
            query(
              collection(db, 'tenants', effectiveTenantId, 'assignments'),
              where('userId', '==', userId)
            )
          );
          if (!byUser.empty) setResolvedAssignmentId(byUser.docs[0].id);
          else setResolvedAssignmentId(undefined);
        }

        if (!empSnap.empty) {
          setResolvedUserEmploymentId(empSnap.docs[0].id);
        } else {
          setResolvedUserEmploymentId(undefined);
        }

        if (!empSnap.empty) {
          const emp = empSnap.docs[0].data();
          setI9Status(String(emp.i9Status || '—'));
        } else {
          setI9Status('—');
        }

        if (!casesSnap.empty) {
          const latest = casesSnap.docs.reduce((a, b) => {
            const aAt = (a.data().updatedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
            const bAt = (b.data().updatedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
            return bAt > aAt ? b : a;
          });
          const data = latest.data();
          const statusDisplay = data.public?.status ?? data.status;
          setEverifyStatus(String(statusDisplay || '—'));
          setEverifyCaseId(latest.id);
        } else {
          setEverifyStatus('—');
          setEverifyCaseId(null);
        }
      } catch {
        setI9Status('—');
        setEverifyStatus('—');
      }
    };

    load();
  }, [effectiveTenantId, userId, createLoading]);


  const handleClickCreate = async () => {
    const aid = assignmentId || resolvedAssignmentId;
    const eid = userEmploymentId || resolvedUserEmploymentId;
    if (!effectiveTenantId || (!aid && !eid)) return;
    setBlockingReasons([]);
    setCheckLoading(true);
    try {
      const check = httpsCallable(functions, 'everifyCheckEligibility');
      const res = (await check({
        tenantId: effectiveTenantId,
        assignmentId: aid || undefined,
        userEmploymentId: eid || undefined,
      })) as { data: { eligible: boolean; blockingReasons?: string[] } };
      if (res.data.eligible) {
        setCheckLoading(false);
        setCreateLoading(true);
        try {
          const create = httpsCallable(functions, 'everifyCreateCase');
          await create({
            tenantId: effectiveTenantId,
            assignmentId: aid || undefined,
            userEmploymentId: eid || undefined,
          });
        } catch (err: unknown) {
          const e = err as { details?: { blockingReasons?: string[] }; message?: string };
          setBlockingReasons(e.details?.blockingReasons || [e.message || 'Failed to create case']);
        } finally {
          setCreateLoading(false);
        }
      } else {
        setBlockingReasons(res.data.blockingReasons || []);
      }
    } catch (err: unknown) {
      const e = err as { details?: { blockingReasons?: string[] }; message?: string };
      setBlockingReasons(e.details?.blockingReasons || [e.message || 'Unable to check']);
    } finally {
      setCheckLoading(false);
    }
  };

  const canCreate = assignmentId || userEmploymentId || resolvedAssignmentId || resolvedUserEmploymentId;
  const actionRequired =
    everifyStatus === 'tnc' || everifyStatus === 'further_action_required';
  const tooltipText =
    blockingReasons.length > 0
      ? blockingReasons.join('. ')
      : !canCreate
        ? 'Select an assignment or employment to create case'
        : 'Create E-Verify case';

  return (
    <Card variant="outlined" sx={{ maxWidth: 360 }}>
      <CardContent sx={{ p: 2 }}>
        {actionRequired && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            E-Verify follow-up required. Resolve in Admin Ops or Compliance settings.
          </Alert>
        )}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Compliance
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
          <Tooltip title="I-9 status from user employment">
            <Chip
              size="small"
              icon={<VerifiedUserIcon sx={{ fontSize: 16 }} />}
              label={`I-9: ${i9Status || '—'}`}
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
          </Tooltip>
          <Tooltip title={everifyCaseId ? `Case ${everifyCaseId}` : 'E-Verify status'}>
            <Chip
              size="small"
              label={`E-Verify: ${everifyStatus || '—'}`}
              variant="outlined"
              color={everifyStatus === 'employment_authorized' ? 'success' : 'default'}
              sx={{ fontWeight: 600 }}
            />
          </Tooltip>
        </Stack>
        {isAdmin && (
          <Tooltip title={tooltipText}>
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={!canCreate || createLoading || checkLoading || everifyStatus === 'employment_authorized'}
                onClick={handleClickCreate}
              >
                {createLoading || checkLoading ? (
                  <CircularProgress size={16} />
                ) : (
                  'Create E-Verify Case'
                )}
              </Button>
            </span>
          </Tooltip>
        )}
      </CardContent>
    </Card>
  );
};
