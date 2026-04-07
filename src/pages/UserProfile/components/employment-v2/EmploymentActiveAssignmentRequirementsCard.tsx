import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type {
  AssignmentRequirementItemVm,
  EmploymentEntityKey,
  EmploymentEntityOverview,
} from './employmentV2Types';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import { EmploymentOnboardingPathRowAction } from './EmploymentOnboardingPathRowAction';
import ManualScreeningOrderSelect from './ManualScreeningOrderSelect';
import { assignmentReadinessStateDisplay } from '../../../../utils/assignmentReadinessUi';
import { blockingAssignmentRequirementLines } from '../../../../utils/assignmentRequirementsViewModel';

function Subsection({
  title,
  items,
  emptyHint,
  entityKey,
  actionContext,
  onActionComplete,
  demoteBlockingChips = false,
}: {
  title: string;
  items: AssignmentRequirementItemVm[];
  emptyHint: string;
  entityKey: EmploymentEntityKey;
  actionContext: EmploymentV2ActionResolutionContext | null;
  onActionComplete?: () => void;
  demoteBlockingChips?: boolean;
}) {
  if (!items.length) {
    return (
      <Box sx={{ mb: 1.5 }}>
        {title ? (
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
            {title}
          </Typography>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {emptyHint}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      {title ? (
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          {title}
        </Typography>
      ) : null}
      <Stack spacing={1.25} divider={<Divider flexItem />}>
        {items.map((item) => (
          <Stack
            key={item.id}
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ xs: 'stretch', sm: 'flex-start' }}
            justifyContent="space-between"
            spacing={1}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600}>
                {item.title}
              </Typography>
              {item.pathRow?.narrative?.summary ? (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25, lineHeight: 1.45 }}>
                  {item.pathRow.narrative.summary}
                </Typography>
              ) : item.inlineExplainer ? (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25, lineHeight: 1.45 }}>
                  {item.inlineExplainer}
                </Typography>
              ) : null}
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
              <Chip
                size="small"
                label={item.statusLabel}
                color={demoteBlockingChips || !item.blocking ? 'default' : 'warning'}
                variant={item.blocking && !demoteBlockingChips ? 'filled' : 'outlined'}
              />
              {item.pathRow && actionContext ? (
                <EmploymentOnboardingPathRowAction
                  row={item.pathRow}
                  entityKey={entityKey}
                  ctx={actionContext}
                  onComplete={onActionComplete}
                  primaryCta={false}
                />
              ) : null}
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

export interface EmploymentActiveAssignmentRequirementsCardProps {
  overview: EmploymentEntityOverview;
  entityKey: EmploymentEntityKey;
  actionContext: EmploymentV2ActionResolutionContext | null;
  onActionComplete?: () => void;
}

const EmploymentActiveAssignmentRequirementsCard: React.FC<EmploymentActiveAssignmentRequirementsCardProps> = ({
  overview,
  entityKey,
  actionContext,
  onActionComplete,
}) => {
  const navigate = useNavigate();
  const vm = overview.assignmentRequirementsViewModel;
  const primaryId = vm.primaryAssignmentId;
  const hasDemand = overview.hasOpenOnboardingDemand;
  const demoteChips = !hasDemand;
  const isRecruiter = actionContext?.viewer === 'recruiter';
  const [legacyJobOpen, setLegacyJobOpen] = useState(false);
  const [fullDetailsOpen, setFullDetailsOpen] = useState(false);

  if (!overview.assignments.length) {
    return null;
  }

  const backgroundItems: AssignmentRequirementItemVm[] = [
    ...vm.entityScreeningMilestones,
    ...vm.backgroundOrdersLinked,
    ...vm.requiredChecks,
  ];

  const otherItems: AssignmentRequirementItemVm[] = [
    ...vm.requiredUploads,
    ...vm.assignmentDocuments,
    ...vm.adminSteps,
  ];

  const showCard =
    vm.hasPrimaryAssignment ||
    backgroundItems.length > 0 ||
    vm.requiredCertifications.length > 0 ||
    otherItems.length > 0 ||
    isRecruiter;

  if (!showCard) return null;

  const readiness = vm.primaryAssignmentReadinessV1;
  const headline =
    vm.primaryCanonicalReadinessHeadline ||
    (readiness ? assignmentReadinessStateDisplay(readiness.assignmentReadinessState) : null);
  const summaryText = readiness?.readinessSummary?.trim() || '';
  const showSummaryUnderHeadline =
    summaryText &&
    headline &&
    summaryText.toLowerCase() !== String(headline).trim().toLowerCase();

  const canonicalBlockingIds = readiness?.blockingRequirementIds?.length
    ? readiness.blockingRequirementIds
    : null;
  const showPathOpenFooter =
    hasDemand &&
    vm.openBlockerCount > 0 &&
    (!canonicalBlockingIds || canonicalBlockingIds.length === 0);

  const blockingLines = blockingAssignmentRequirementLines(vm);
  const blockingCount =
    blockingLines.length > 0 ? blockingLines.length : hasDemand ? vm.openBlockerCount : 0;
  const decisionTitle =
    hasDemand && blockingCount > 0
      ? 'Not ready for this job'
      : headline || (vm.hasPrimaryAssignment ? 'Assignment readiness' : 'Job requirements');
  const decisionSeverity: 'warning' | 'info' | 'success' =
    hasDemand && blockingCount > 0 ? 'warning' : readiness?.assignmentReadinessState === 'ready' ? 'success' : 'info';

  return (
    <Card sx={{ mb: 2 }} variant="outlined">
      <CardContent sx={{ pt: 2 }}>
        {vm.hasPrimaryAssignment ? (
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            <Box component="span" sx={{ fontWeight: 700 }}>
              Current job:{' '}
            </Box>
            {vm.primaryJobTitle || vm.primaryJobOrderId || '—'}
          </Typography>
        ) : null}

        <Alert severity={decisionSeverity} variant="outlined" sx={{ mb: 2, '& .MuiAlert-message': { width: '100%' } }}>
          <Typography variant="subtitle1" fontWeight={800} component="div">
            {decisionTitle}
          </Typography>
          {hasDemand && blockingCount > 0 ? (
            <Typography variant="body2" fontWeight={600} sx={{ mt: 0.75 }}>
              {blockingCount} item{blockingCount === 1 ? '' : 's'} blocking start
            </Typography>
          ) : null}
          {showSummaryUnderHeadline ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.45 }}>
              {summaryText}
            </Typography>
          ) : null}
          {canonicalBlockingIds ? (
            <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 1, lineHeight: 1.45 }}>
              Blocking requirement ids: {canonicalBlockingIds.join(', ')}
            </Typography>
          ) : null}
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1.5 }}>
            <Button size="small" variant="outlined" onClick={() => setFullDetailsOpen((o) => !o)}>
              {fullDetailsOpen ? 'Hide' : 'View'} full requirements
            </Button>
            {primaryId ? (
              <Button size="small" variant="contained" onClick={() => navigate(`/assignments/${primaryId}`)}>
                Open assignment
              </Button>
            ) : null}
          </Stack>
        </Alert>

        {isRecruiter && hasDemand ? (
          <Box sx={{ mb: 2 }}>
            <ManualScreeningOrderSelect />
          </Box>
        ) : null}

        {blockingLines.length > 0 ? (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight={700} sx={{ mb: 0.75 }}>
              Key issues
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {blockingLines.map((row, i) => (
                <Typography key={`${i}:${row.title}`} component="li" variant="body2" sx={{ lineHeight: 1.45 }}>
                  {row.title} → {row.statusLabel}
                </Typography>
              ))}
            </Box>
          </Box>
        ) : hasDemand ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.5 }}>
            No blocking rows detected on the assignment package path. Expand full requirements if you need the
            checklist or to add a screening.
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.5 }}>
            Nothing active for a live job on this tab. Recruiters can still open full requirements to add a screening
            or review history.
          </Typography>
        )}

        {vm.onboardingPercentComplete != null && vm.hasPrimaryAssignment ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
            Progress: {vm.onboardingPercentComplete}% complete (instance)
          </Typography>
        ) : null}

        <Collapse in={fullDetailsOpen}>
          {vm.hasPrimaryAssignment && readiness ? (
            <Box sx={{ mb: 2 }}>
              <Button
                size="small"
                onClick={() => setLegacyJobOpen((o) => !o)}
                sx={{ textTransform: 'none', px: 0, minWidth: 0, mb: legacyJobOpen ? 0.5 : 0 }}
                aria-expanded={legacyJobOpen}
              >
                {legacyJobOpen ? 'Hide' : 'Show'} Firestore record details (assignment &amp; instance)
              </Button>
              <Collapse in={legacyJobOpen}>
                <Stack spacing={0.5} sx={{ borderLeft: 1, borderColor: 'divider', pl: 1.5, mb: 1 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Raw assignment status: {vm.primaryAssignmentStatus || '—'}
                    {vm.onboardingPercentComplete != null ? ` · Instance ${vm.onboardingPercentComplete}%` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Instance package status: {vm.onboardingPackageStatus || '—'}
                  </Typography>
                </Stack>
              </Collapse>
            </Box>
          ) : vm.hasPrimaryAssignment ? (
            <Stack spacing={0.5} sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Assignment status: {vm.primaryAssignmentStatus || '—'}
                {vm.onboardingPercentComplete != null ? ` · Instance ${vm.onboardingPercentComplete}%` : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Instance package: {vm.onboardingPackageStatus || '—'}
              </Typography>
            </Stack>
          ) : null}

          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            Background Checks and Screenings
          </Typography>
          <Subsection
            title=""
            items={backgroundItems}
            emptyHint="No screening requirements or orders in view for this tab yet."
            entityKey={entityKey}
            actionContext={actionContext}
            onActionComplete={onActionComplete}
            demoteBlockingChips={demoteChips}
          />

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            Required Certifications
          </Typography>
          <Subsection
            title=""
            items={vm.requiredCertifications}
            emptyHint="No certification-style requirements detected for this assignment (naming heuristic)."
            entityKey={entityKey}
            actionContext={actionContext}
            onActionComplete={onActionComplete}
            demoteBlockingChips={demoteChips}
          />

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            Other Requirements
          </Typography>
          <Subsection
            title=""
            items={otherItems}
            emptyHint="No uploads, e-sign documents, or admin steps in the assignment package."
            entityKey={entityKey}
            actionContext={actionContext}
            onActionComplete={onActionComplete}
            demoteBlockingChips={demoteChips}
          />

          {showPathOpenFooter ? (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              {vm.openBlockerCount} path row{vm.openBlockerCount === 1 ? '' : 's'} marked blocking in the onboarding
              checklist (open the checklist above for row actions).
            </Typography>
          ) : null}
        </Collapse>
      </CardContent>
    </Card>
  );
};

export default EmploymentActiveAssignmentRequirementsCard;
