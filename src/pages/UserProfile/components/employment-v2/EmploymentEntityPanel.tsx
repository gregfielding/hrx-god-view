import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Card, CardContent, CardHeader, Stack } from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../../firebase';
import type { WorkAuthorizedStatus } from '../../../../utils/workAuthorizedDisplay';
import type { EmploymentEntityKey, EmploymentEntityOverview } from './employmentV2Types';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import EmploymentMinimalOnboardingChecklist from './EmploymentMinimalOnboardingChecklist';
import EmploymentEmptyStateCard from './EmploymentEmptyStateCard';
import EmploymentWorkerEmploymentHub from './EmploymentWorkerEmploymentHub';
import EvereeAdminSyncCard from '../../../../components/everee/EvereeAdminSyncCard';
import EmployeePayrollSection from './EmployeePayrollSection';
import { EMPLOYMENT_V2_ANCHOR_ONBOARDING } from '../../../../utils/workerReadinessBannerModel';
import { workerEmploymentShouldShowScreeningPointerAlert } from '../../../../utils/workerEmploymentBackgroundsCrossLink';

export type EmploymentEntityPanelViewerKind = 'worker' | 'recruiter';

export interface EmploymentEntityPanelProps {
  entityKey: EmploymentEntityKey;
  overview: EmploymentEntityOverview;
  profileUserId: string;
  tenantId: string;
  tenantSlug?: string;
  /** Profile subject vs hiring team — drives payroll-system CTAs and post-onboarding hub. */
  viewerKind?: EmploymentEntityPanelViewerKind;
  /** When set, worker can jump to Backgrounds from Employment (screening pointer). */
  onNavigateToProfileTab?: (tabLabel: string) => void;
  onRefresh?: () => void;
  workerDisplayName?: string | null;
  workAuthorizedStatus: WorkAuthorizedStatus;
  workAuthorizationAttestedAt?: unknown | null;
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

const EmploymentEntityPanel: React.FC<EmploymentEntityPanelProps> = ({
  entityKey,
  overview,
  profileUserId,
  tenantId,
  tenantSlug,
  viewerKind = 'recruiter',
  onNavigateToProfileTab,
  onRefresh,
  workerDisplayName,
  workAuthorizedStatus,
  workAuthorizationAttestedAt,
  employmentI9SectionFlash = false,
  onOpenWorkerNotificationComposer,
  onSendWorkerNotificationDirect,
}) => {
  const showEmptyExplainer = !overview.entityEmployment && !overview.workerOnboarding;
  const onCallPoolActive = overview.entityEmployment?.employmentEntryMode === 'on_call_pool';

  const actionContext: EmploymentV2ActionResolutionContext = useMemo(() => {
    const entityDisplayName =
      overview.headerEntityName?.trim() ||
      overview.entityEmployment?.entityName?.trim() ||
      null;
    return {
      userId: profileUserId,
      tenantId,
      tenantSlug,
      viewer: viewerKind,
      workerDisplayName: workerDisplayName?.trim() || null,
      entityDisplayName,
      entityEmploymentFirestoreId: overview.entityEmployment?.id ?? null,
      payrollPortalUrl:
        overview.systems.payroll?.entityOnboardingUrl ||
        overview.systems.payroll?.entityPortalUrl ||
        overview.systems.payroll?.portalUrl ||
        null,
      everifyOnCallLaborPool: onCallPoolActive,
    };
  }, [profileUserId, tenantId, tenantSlug, overview, workerDisplayName, onCallPoolActive, viewerKind]);

  const showChecklist = overview.employmentHeaderState !== 'not_started';
  const showWorkerPostOnboardingHub =
    viewerKind === 'worker' && showChecklist && overview.onboardingComplete === true;
  const showScreeningToBackgroundsPointer =
    viewerKind === 'worker' &&
    Boolean(onNavigateToProfileTab) &&
    overview.hasOpenOnboardingDemand &&
    workerEmploymentShouldShowScreeningPointerAlert(overview);

  // **Migration-period UX (temporary).** While we migrate workers to
  // Everee, the legacy `EmploymentMinimalOnboardingChecklist` is the
  // only surface that exposes HRX-side onboarding state for workers
  // who haven't been mirrored to Everee yet (or whose entity record
  // hasn't been linked — see "Not linked" state on `EvereeAdminSyncCard`).
  //
  // Pre-migration intent was to hide the checklist on Everee-enabled
  // entities to avoid duplication with the "Everee data" card, but that
  // left CSAs blind to per-worker onboarding details for unmigrated
  // workers. So we now render both:
  //   - Legacy checklist (HRX onboarding signals)
  //   - `EvereeAdminSyncCard` (link / resync controls)
  //   - `EmployeePayrollSection` (Everee data, only when worker IS linked)
  //
  // Once every worker is on Everee and the legacy fields are deprecated,
  // this can be re-gated to hide the checklist on Everee-enabled entities.
  // Track migration status via the count of unmigrated workers per tenant
  // before flipping that gate back on.

  // Recruiter-only Everee sync surface. Server-side `requireEvereeEnabledEntity`
  // enforces the same gates; we mirror the visibility check here so the card
  // never appears for entities Everee isn't wired to.
  const showEvereeAdminSync =
    viewerKind === 'recruiter' &&
    Boolean(overview.entityEmployment?.entityId) &&
    overview.systems.payroll?.provider === 'everee' &&
    overview.systems.payroll?.evereeEnabled === true;

  // Live `evereeWorkerId` for *this entity's* Everee tenant. Subscribing to
  // the user doc means a recruiter triggering `EvereeAdminSyncCard` causes
  // the payroll section to appear without a manual reload, and a fresh
  // provisioning event flips the panel from "still provisioning" → "ready".
  // We deliberately read the user's `evereeWorkerIds` map here instead of
  // plumbing it through the overview — the payload is tiny and the live
  // subscription is the right model for sync-driven reveals.
  const evereeTenantId = overview.systems.payroll?.evereeTenantId ?? null;
  const isEvereeEntity =
    overview.systems.payroll?.provider === 'everee' &&
    overview.systems.payroll?.evereeEnabled === true;
  const [evereeWorkerId, setEvereeWorkerId] = useState<string | null>(null);
  useEffect(() => {
    if (!isEvereeEntity || !evereeTenantId || !profileUserId) {
      setEvereeWorkerId(null);
      return;
    }
    const unsub = onSnapshot(doc(db, `users/${profileUserId}`), (snap) => {
      const map = (snap.data()?.evereeWorkerIds ?? {}) as Record<string, unknown>;
      const raw = map?.[evereeTenantId];
      const id = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      setEvereeWorkerId(id);
    });
    return () => unsub();
  }, [isEvereeEntity, evereeTenantId, profileUserId]);

  const showEmployeePayrollSection =
    isEvereeEntity &&
    Boolean(evereeTenantId) &&
    Boolean(evereeWorkerId) &&
    Boolean(overview.entityEmployment?.entityId);

  // Stable identity for the EvereeAdminSyncCard `onSynced` callback so its
  // internal `performSync` `useCallback` doesn't churn on every parent
  // render. Without this, the auto-run effect's deps see a new
  // `performSync` each render, which is harmless on its own (the
  // `autoSyncedKeyRef` gate stops re-fires) but is also unnecessary
  // overhead and made the original "screen flashing" bug harder to
  // trace. May 2026 — see EvereeAdminSyncCard fix notes.
  const handleEvereeSynced = useCallback(() => {
    onRefresh?.();
  }, [onRefresh]);

  return (
    <Stack spacing={0}>
      <Box id={EMPLOYMENT_V2_ANCHOR_ONBOARDING} sx={{ scrollMarginTop: 96 }}>
        {showChecklist ? (
          showWorkerPostOnboardingHub ? (
            <Box sx={{ mb: 2 }}>
              <EmploymentWorkerEmploymentHub
                entityKey={entityKey}
                overview={overview}
                tenantId={tenantId}
                profileUserId={profileUserId}
                onNavigateToProfileTab={onNavigateToProfileTab}
                onRefresh={onRefresh}
                onOpenWorkerNotificationComposer={onOpenWorkerNotificationComposer}
                onSendWorkerNotificationDirect={onSendWorkerNotificationDirect}
              />
            </Box>
          ) : (
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardHeader
                title="Onboarding checklist"
                titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
                sx={{ pb: 1 }}
              />
              <CardContent sx={{ pt: 0, '&:last-child': { pb: 2 } }}>
                <EmploymentMinimalOnboardingChecklist
                  entityKey={entityKey}
                  overview={overview}
                  tenantId={tenantId}
                  profileUserId={profileUserId}
                  actionContext={actionContext}
                  onRefresh={onRefresh}
                  workAuthorizedStatus={workAuthorizedStatus}
                  workAuthorizationAttestedAt={workAuthorizationAttestedAt}
                  employmentI9SectionFlash={employmentI9SectionFlash}
                  onOpenWorkerNotificationComposer={onOpenWorkerNotificationComposer}
                  onSendWorkerNotificationDirect={onSendWorkerNotificationDirect}
                  showScreeningToBackgroundsPointer={showScreeningToBackgroundsPointer}
                  onNavigateToProfileTab={onNavigateToProfileTab}
                />
              </CardContent>
            </Card>
          )
        ) : null}

        {/*
        <EmploymentSystemsSummaryCard
          overview={overview}
          tenantId={tenantId}
          profileUserId={profileUserId}
          onPayrollResendComplete={() => onRefresh?.()}
          defaultExpanded={false}
        />
        */}

        {showEvereeAdminSync ? (
          <EvereeAdminSyncCard
            tenantId={tenantId}
            entityId={overview.entityEmployment?.entityId ?? null}
            userId={profileUserId}
            workerType={overview.workerType === '1099' ? 'contractor' : 'employee'}
            onSynced={handleEvereeSynced}
          />
        ) : null}

        {showEmployeePayrollSection ? (
          <EmployeePayrollSection
            tenantId={tenantId}
            entityId={overview.entityEmployment!.entityId!}
            userId={profileUserId}
            evereeTenantId={evereeTenantId!}
            evereeWorkerId={evereeWorkerId!}
            viewerKind={viewerKind}
          />
        ) : null}
      </Box>
      {showEmptyExplainer && <EmploymentEmptyStateCard entityKey={entityKey} />}
    </Stack>
  );
};

export default EmploymentEntityPanel;
