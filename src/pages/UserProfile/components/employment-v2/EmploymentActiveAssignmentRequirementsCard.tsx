import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Collapse,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useNavigate } from 'react-router-dom';
import type {
  AssignmentRequirementItemVm,
  EmploymentEntityKey,
  EmploymentEntityOverview,
} from './employmentV2Types';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import { EmploymentOnboardingPathRowAction } from './EmploymentOnboardingPathRowAction';

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
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {emptyHint}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        {title}
      </Typography>
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
  const [historyOpen, setHistoryOpen] = useState(false);

  const hasAnyJobContent =
    vm.hasPrimaryAssignment ||
    vm.entityScreeningMilestones.length > 0 ||
    vm.backgroundOrdersLinked.length > 0;

  const historyOnlySections =
    !hasDemand && (vm.entityScreeningMilestones.length > 0 || vm.backgroundOrdersLinked.length > 0);
  const demoteChips = !hasDemand;

  return (
    <Card sx={{ mb: 2 }}>
      <CardHeader
        title={hasDemand ? 'Active assignment requirements' : 'Assignment & screening record'}
        subheader={
          hasDemand
            ? 'Job-specific package, screening orders, and entity screening policy — separate from the employment relationship path above.'
            : 'No active assignment onboarding for this entity. Expand history to review prior milestones and screening orders — not current required work by default.'
        }
        titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
      />
      <CardContent sx={{ pt: 0 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.5 }}>
          {hasDemand
            ? 'Entity Settings still control which screening milestones apply to this hiring relationship; detail and fulfillment for orders and assignment tasks are grouped here so the main path stays focused on I-9, forms, payroll, and internal readiness.'
            : 'When you have a live assignment, job package and screening activity will appear here as current work. What follows is retained for reference.'}
        </Typography>

        {!hasAnyJobContent ? (
          <Typography variant="body2" color="text.secondary">
            No primary assignment, screening milestones, or linked screening orders for this entity yet.
          </Typography>
        ) : null}

        {historyOnlySections ? (
          <>
            <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                History: policy milestones &amp; screening orders
              </Typography>
              <IconButton aria-label={historyOpen ? 'Collapse history' : 'Expand history'} onClick={() => setHistoryOpen((v) => !v)} size="small">
                {historyOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Stack>
            <Collapse in={historyOpen}>
              {vm.entityScreeningMilestones.length > 0 ? (
                <Subsection
                  title="Entity screening (policy milestones)"
                  items={vm.entityScreeningMilestones}
                  emptyHint=""
                  entityKey={entityKey}
                  actionContext={actionContext}
                  onActionComplete={onActionComplete}
                  demoteBlockingChips={demoteChips}
                />
              ) : null}
              {vm.backgroundOrdersLinked.length > 0 ? (
                <>
                  {vm.entityScreeningMilestones.length > 0 ? <Divider sx={{ my: 2 }} /> : null}
                  <Subsection
                    title="Screening orders (linked job orders)"
                    items={vm.backgroundOrdersLinked}
                    emptyHint=""
                    entityKey={entityKey}
                    actionContext={actionContext}
                    onActionComplete={onActionComplete}
                    demoteBlockingChips={demoteChips}
                  />
                </>
              ) : null}
            </Collapse>
          </>
        ) : (
          <>
            {vm.entityScreeningMilestones.length > 0 ? (
              <Subsection
                title="Entity screening (policy milestones)"
                items={vm.entityScreeningMilestones}
                emptyHint=""
                entityKey={entityKey}
                actionContext={actionContext}
                onActionComplete={onActionComplete}
                demoteBlockingChips={demoteChips}
              />
            ) : null}
          </>
        )}

        {vm.hasPrimaryAssignment ? (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              Primary assignment
            </Typography>
            <Stack spacing={0.5} sx={{ mb: 2 }}>
              <Typography variant="body2">
                <Box component="span" sx={{ fontWeight: 600 }}>
                  Role / job:{' '}
                </Box>
                {vm.primaryJobTitle || vm.primaryJobOrderId || '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Assignment status: {vm.primaryAssignmentStatus || '—'}
                {vm.onboardingPercentComplete != null ? ` · Package ${vm.onboardingPercentComplete}%` : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Onboarding instance: {vm.onboardingPackageStatus || '—'}
              </Typography>
              {primaryId ? (
                <Button size="small" variant="outlined" sx={{ alignSelf: 'flex-start', mt: 0.5 }} onClick={() => navigate(`/assignments/${primaryId}`)}>
                  Open assignment
                </Button>
              ) : null}
            </Stack>

            <Subsection
              title="Required checks"
              items={vm.requiredChecks}
              emptyHint="No package checks in this assignment’s onboarding instance."
              entityKey={entityKey}
              actionContext={actionContext}
              onActionComplete={onActionComplete}
              demoteBlockingChips={demoteChips}
            />
            <Subsection
              title="Required certifications"
              items={vm.requiredCertifications}
              emptyHint="No certification-style checks detected (naming heuristic)."
              entityKey={entityKey}
              actionContext={actionContext}
              onActionComplete={onActionComplete}
              demoteBlockingChips={demoteChips}
            />
            <Subsection
              title="Required uploads / verifications"
              items={vm.requiredUploads}
              emptyHint="No non–e-sign document requirements in the package."
              entityKey={entityKey}
              actionContext={actionContext}
              onActionComplete={onActionComplete}
              demoteBlockingChips={demoteChips}
            />
            <Subsection
              title="Assignment documents (e-sign)"
              items={vm.assignmentDocuments}
              emptyHint="No e-sign documents required for this assignment."
              entityKey={entityKey}
              actionContext={actionContext}
              onActionComplete={onActionComplete}
              demoteBlockingChips={demoteChips}
            />
            <Subsection
              title="Assignment admin steps"
              items={vm.adminSteps}
              emptyHint="No recruiter/admin steps in the package."
              entityKey={entityKey}
              actionContext={actionContext}
              onActionComplete={onActionComplete}
              demoteBlockingChips={demoteChips}
            />
          </>
        ) : null}

        {hasDemand && vm.backgroundOrdersLinked.length > 0 ? (
          <>
            <Divider sx={{ my: 2 }} />
            <Subsection
              title="Screening orders (linked job orders)"
              items={vm.backgroundOrdersLinked}
              emptyHint=""
              entityKey={entityKey}
              actionContext={actionContext}
              onActionComplete={onActionComplete}
              demoteBlockingChips={demoteChips}
            />
          </>
        ) : null}

        {hasDemand && vm.openBlockerCount > 0 ? (
          <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 1 }}>
            {vm.openBlockerCount} blocking item{vm.openBlockerCount === 1 ? '' : 's'} in this job / screening area (not counted in
            the relationship path above).
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default EmploymentActiveAssignmentRequirementsCard;
