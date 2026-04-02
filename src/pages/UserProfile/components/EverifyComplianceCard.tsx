import React, { useEffect, useMemo, useState } from 'react';
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
import { collection, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { resolveC1SelectEntityId } from '../../../utils/c1EntityWorkAuthorizationUi';
import { canManageEverifyFromClaims } from './backgroundsComplianceModel';

interface EverifyComplianceCardProps {
  tenantId: string;
  userId: string;
  assignmentId?: string;
  userEmploymentId?: string;
}

/**
 * **C1 Select** work authorization (I-9 + E-Verify) quick card — not shown on Profile Overview
 * (use Employment / Backgrounds). Kept for reuse or embedded views. Hidden when the tenant has no resolved C1 Select entity.
 */
export const EverifyComplianceCard: React.FC<EverifyComplianceCardProps> = ({
  tenantId,
  userId,
  assignmentId,
  userEmploymentId,
}) => {
  const { activeTenant, isHRX, claimsRoles } = useAuth();
  const effectiveTenantId = tenantId || activeTenant?.id;
  const [cardState, setCardState] = useState<'loading' | 'hidden' | 'ready'>('loading');
  const [i9Status, setI9Status] = useState<string>('');
  const [everifyStatus, setEverifyStatus] = useState<string>('');
  const [everifyCaseId, setEverifyCaseId] = useState<string | null>(null);
  const [blockingReasons, setBlockingReasons] = useState<string[]>([]);
  const [checkLoading, setCheckLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  const canManageEverify = useMemo(
    () => canManageEverifyFromClaims(isHRX, effectiveTenantId || null, claimsRoles),
    [isHRX, effectiveTenantId, claimsRoles]
  );

  const [resolvedAssignmentId, setResolvedAssignmentId] = useState<string | undefined>(undefined);
  const [resolvedSelectUserEmploymentId, setResolvedSelectUserEmploymentId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!effectiveTenantId || !userId) {
      setCardState('hidden');
      return;
    }

    const load = async () => {
      setCardState('loading');
      try {
        const [entSnap, empSnap, casesSnap, assignSnap] = await Promise.all([
          getDocs(collection(db, 'tenants', effectiveTenantId, 'entities')),
          getDocs(
            query(collection(db, 'tenants', effectiveTenantId, 'user_employments'), where('userId', '==', userId))
          ),
          getDocs(
            query(collection(db, 'tenants', effectiveTenantId, 'everify_cases_public'), where('userId', '==', userId))
          ),
          getDocs(
            query(collection(db, 'tenants', effectiveTenantId, 'assignments'), where('candidateId', '==', userId))
          ),
        ]);

        const brief = entSnap.docs.map((d) => {
          const data = d.data() as { name?: string; entityCode?: string };
          return {
            id: d.id,
            name: String(data.name || d.id),
            entityCode: String(data.entityCode || ''),
          };
        });
        const selId = resolveC1SelectEntityId(brief);
        if (!selId) {
          setCardState('hidden');
          return;
        }

        let assignId: string | undefined;
        if (!assignSnap.empty) {
          assignId = assignSnap.docs[0].id;
        } else {
          const byUser = await getDocs(
            query(collection(db, 'tenants', effectiveTenantId, 'assignments'), where('userId', '==', userId))
          );
          if (!byUser.empty) assignId = byUser.docs[0].id;
        }
        setResolvedAssignmentId(assignId);

        const selectEmp = empSnap.docs.find((d) => {
          const raw = d.data() as { entityId?: string };
          return String(raw.entityId || '') === selId;
        });
        if (selectEmp) {
          setResolvedSelectUserEmploymentId(selectEmp.id);
          const emp = selectEmp.data() as { i9Status?: string };
          setI9Status(String(emp.i9Status || '—'));
        } else {
          setResolvedSelectUserEmploymentId(undefined);
          setI9Status('—');
        }

        const selectCases = casesSnap.docs.filter((d) => {
          const raw = d.data() as { entityId?: string };
          return String(raw.entityId || '') === selId;
        });
        if (selectCases.length > 0) {
          const latest = selectCases.reduce((a, b) => {
            const aAt = (a.data().updatedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
            const bAt = (b.data().updatedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
            return bAt > aAt ? b : a;
          });
          const data = latest.data() as { public?: { status?: string }; status?: string };
          const statusDisplay = data.public?.status ?? data.status;
          setEverifyStatus(String(statusDisplay || '—'));
          setEverifyCaseId(latest.id);
        } else {
          setEverifyStatus('—');
          setEverifyCaseId(null);
        }

        setCardState('ready');
      } catch {
        setCardState('hidden');
        setI9Status('—');
        setEverifyStatus('—');
      }
    };

    load();
  }, [effectiveTenantId, userId, createLoading]);

  const handleClickCreate = async () => {
    const aid = assignmentId || resolvedAssignmentId;
    const eid = userEmploymentId || resolvedSelectUserEmploymentId;
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

  const canCreate = assignmentId || userEmploymentId || resolvedAssignmentId || resolvedSelectUserEmploymentId;
  const actionRequired =
    everifyStatus === 'tnc' || everifyStatus === 'further_action_required';
  const tooltipText =
    blockingReasons.length > 0
      ? blockingReasons.join('. ')
      : !canCreate
        ? 'Link a C1 Select user_employment or assignment to create a case'
        : 'Create E-Verify case (C1 Select)';

  if (cardState === 'hidden') return null;

  if (cardState === 'loading') {
    return (
      <Card variant="outlined" sx={{ maxWidth: 360 }}>
        <CardContent sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={22} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined" sx={{ maxWidth: 360 }}>
      <CardContent sx={{ p: 2 }}>
        {actionRequired && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            Select E-Verify follow-up required. Resolve in Admin Ops or the profile Backgrounds tab.
          </Alert>
        )}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
          Work authorization (C1 Select)
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          I-9 and E-Verify apply only to C1 Select LLC hiring. Use the Backgrounds tab for full detail.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
          <Tooltip title="I-9 status on the C1 Select user_employment record (if present)">
            <Chip
              size="small"
              icon={<VerifiedUserIcon sx={{ fontSize: 16 }} />}
              label={`I-9 (Select): ${i9Status || '—'}`}
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
          </Tooltip>
          <Tooltip title={everifyCaseId ? `Case ${everifyCaseId}` : 'E-Verify status (Select cases only)'}>
            <Chip
              size="small"
              label={`E-Verify (Select): ${everifyStatus || '—'}`}
              variant="outlined"
              color={everifyStatus === 'employment_authorized' ? 'success' : 'default'}
              sx={{ fontWeight: 600 }}
            />
          </Tooltip>
        </Stack>
        {canManageEverify && (
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
                  'Create E-Verify (Select)'
                )}
              </Button>
            </span>
          </Tooltip>
        )}
      </CardContent>
    </Card>
  );
};
