import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useAuth } from '../../../../contexts/AuthContext';
import { useEntityEmploymentOverview } from '../../../../hooks/useEntityEmploymentOverview';
import { useWorkerReadinessV1 } from '../../../../hooks/useWorkerReadinessV1';
import {
  buildWorkerReadinessBannerModel,
  isEmploymentEntityRelevantForWorkerReadinessBanner,
  scrollToEmploymentV2Anchor,
} from '../../../../utils/workerReadinessBannerModel';
import type { WorkAuthorizedStatus } from '../../../../utils/workAuthorizedDisplay';
import type { EmploymentEntityKey } from './employmentV2Types';
import EmploymentEntityTabs from './EmploymentEntityTabs';
import EmploymentEntityPanel from './EmploymentEntityPanel';
import StartOnCallEmploymentDialog from './StartOnCallEmploymentDialog';
import WorkerReadinessBanner from './WorkerReadinessBanner';

export interface EmploymentV2TabProps {
  uid: string;
  tenantId: string | null;
  /** Switch profile tabs without a full navigation (worker cross-links). */
  onNavigateToProfileTab?: (tabLabel: string) => void;
  /** Admin profile: worker name for third-person “who is handling this” labels. */
  workerDisplayName?: string | null;
  /** Security level ≥ 4 / recruiter tooling — enables on-call labor pool hire. */
  allowStartOnCallEmployment?: boolean;
  /** From `users.{uid}.workEligibilityAttestation` — onboarding checklist Tax & identity. */
  workAuthorizedStatus: WorkAuthorizedStatus;
  workAuthorizationAttestedAt?: unknown | null;
  /** Brief highlight on Tax & identity / I-9 (Readiness deep-link). */
  employmentI9SectionFlash?: boolean;
  onOpenWorkerNotificationComposer?: (args: {
    channel: 'sms' | 'email';
    body: string;
    subject?: string;
  }) => void;
  onSendWorkerNotificationDirect?: (args: {
    channel: 'sms' | 'email';
    body: string;
    subject?: string;
  }) => void | Promise<void>;
}

function EmploymentV2Tab({
  uid,
  tenantId,
  onNavigateToProfileTab,
  allowStartOnCallEmployment,
  workerDisplayName,
  workAuthorizedStatus,
  workAuthorizationAttestedAt,
  employmentI9SectionFlash = false,
  onOpenWorkerNotificationComposer,
  onSendWorkerNotificationDirect,
}: EmploymentV2TabProps) {
  const [entityKey, setEntityKey] = useState<EmploymentEntityKey>('select');
  const [onCallOpen, setOnCallOpen] = useState(false);
  const [scrollAfterEntityTab, setScrollAfterEntityTab] = useState<{
    targetEntity: EmploymentEntityKey;
    elementId: string;
  } | null>(null);
  const { activeTenant, user } = useAuth();
  const viewerKind = user?.uid === uid ? ('worker' as const) : ('recruiter' as const);
  const tenantSlug =
    activeTenant && typeof activeTenant.slug === 'string' && activeTenant.slug.trim() !== ''
      ? activeTenant.slug.trim()
      : undefined;
  const { byEntityKey, loading, error, refetch } = useEntityEmploymentOverview({ userId: uid, tenantId });
  const { snapshot: workerReadinessSnap } = useWorkerReadinessV1(uid);
  const activeOverview = byEntityKey[entityKey];
  const onCallPoolActive = activeOverview.entityEmployment?.employmentEntryMode === 'on_call_pool';
  const showStartOnCallButton = Boolean(allowStartOnCallEmployment && !onCallPoolActive);
  /** No employment relationship / onboarding begun for this entity tab — hide checklist, systems card, advanced tools. */
  const hideEmploymentContentBelowTabs = activeOverview.employmentHeaderState === 'not_started';
  const entityReadinessBannerRelevant = isEmploymentEntityRelevantForWorkerReadinessBanner(activeOverview);
  const readinessBannerModel = useMemo(() => {
    if (!entityReadinessBannerRelevant) return null;
    return buildWorkerReadinessBannerModel({ wr: workerReadinessSnap, byEntityKey, scopeEntityKey: entityKey });
  }, [entityReadinessBannerRelevant, workerReadinessSnap, byEntityKey, entityKey]);

  useEffect(() => {
    if (!scrollAfterEntityTab) return;
    if (entityKey !== scrollAfterEntityTab.targetEntity) return;
    const { elementId } = scrollAfterEntityTab;
    setScrollAfterEntityTab(null);
    const t = window.setTimeout(() => scrollToEmploymentV2Anchor(elementId), 120);
    return () => window.clearTimeout(t);
  }, [entityKey, scrollAfterEntityTab]);

  const handleBannerNavigateToFix = (args: {
    entityKey: EmploymentEntityKey | null;
    scrollElementId: string;
  }) => {
    if (args.entityKey != null && args.entityKey !== entityKey) {
      setScrollAfterEntityTab({ targetEntity: args.entityKey, elementId: args.scrollElementId });
      setEntityKey(args.entityKey);
      return;
    }
    scrollToEmploymentV2Anchor(args.scrollElementId);
  };

  if (!tenantId) {
    return (
      <Box sx={{ p: 2, pb: '32px' }}>
        <Alert severity="info">Select a tenant to view employment.</Alert>
      </Box>
    );
  }

  if (loading && !error) {
    return (
      <Box sx={{ py: 4, pb: '32px', display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1, sm: 2 }, pb: '32px' }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Worker readiness banner ("Not ready to work" / blocking list) — hidden while Employment onboarding UI is simplified
      {readinessBannerModel ? (
        <WorkerReadinessBanner model={readinessBannerModel} onNavigateToFix={handleBannerNavigateToFix} />
      ) : null}
      */}

      <EmploymentEntityTabs
        value={entityKey}
        onChange={setEntityKey}
        trailingAction={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" justifyContent="flex-end">
            {showStartOnCallButton ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<PersonAddAlt1OutlinedIcon />}
                onClick={() => setOnCallOpen(true)}
              >
                Start on-call employment
              </Button>
            ) : null}
            <Button size="small" startIcon={<RefreshIcon />} onClick={() => void refetch()}>
              Refresh
            </Button>
          </Stack>
        }
      />
      {showStartOnCallButton ? (
        <StartOnCallEmploymentDialog
          open={onCallOpen}
          onClose={() => setOnCallOpen(false)}
          tenantId={tenantId}
          profileUserId={uid}
          entityKey={entityKey}
          onSuccess={() => void refetch()}
        />
      ) : null}
      {!hideEmploymentContentBelowTabs ? (
        <>
          <EmploymentEntityPanel
            entityKey={entityKey}
            overview={byEntityKey[entityKey]}
            profileUserId={uid}
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            viewerKind={viewerKind}
            onNavigateToProfileTab={onNavigateToProfileTab}
            onRefresh={refetch}
            workerDisplayName={workerDisplayName}
            workAuthorizedStatus={workAuthorizedStatus}
            workAuthorizationAttestedAt={workAuthorizationAttestedAt}
            employmentI9SectionFlash={employmentI9SectionFlash}
            onOpenWorkerNotificationComposer={onOpenWorkerNotificationComposer}
            onSendWorkerNotificationDirect={onSendWorkerNotificationDirect}
          />

          {/*
          <Accordion sx={{ mt: 3 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography fontWeight={600}>Advanced tools</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <EmploymentTab uid={uid} tenantId={tenantId} />
            </AccordionDetails>
          </Accordion>
          */}
        </>
      ) : null}
    </Box>
  );
}

export default EmploymentV2Tab;
