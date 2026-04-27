import React from 'react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import type { ChipProps } from '@mui/material/Chip';
import {
  HIRING_LIFECYCLE_WORKFLOW_OVERVIEW_CHIPS,
  HIRING_NEXT_ACTION_UI_EXAMPLES,
} from '../../../constants/hiringLifecycle';

/** Shortened for scanability; nuances (overrides, manual steps) called out in-line. */
const HOW_IT_WORKS_STEPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Apply',
    body: 'Applications record lifecycle when supported so recruiters can see stage and blockers.',
  },
  {
    title: 'Profile',
    body: 'Tenant eligibility gates (resume/skill, phone, location, work auth) can block until complete.',
  },
  {
    title: 'Interview',
    body: 'If prescreen is required (tenant default or job override), workers complete AI prescreen before advancing.',
  },
  {
    title: 'Qualification',
    body: 'Interview score, optional job-fit, and no-show risk gate who moves forward; failures may route to review or hold per your rules.',
  },
  {
    title: 'Automation',
    body: 'Auto-advance only runs when enabled and may still defer to review, waitlist, or manual steps depending on scores, caps, and job/group overrides.',
  },
  {
    title: 'Capacity',
    body: 'Targets and caps can limit advances; overflow often means waitlist or recruiter triage—not purely automatic.',
  },
  {
    title: 'After hire',
    body: 'Onboarding and compliance are configured outside this page (e.g. Onboarding Library); timing varies by assignment.',
  },
];

function chipPropsForKind(kind: 'linear' | 'branch'): Partial<ChipProps> {
  if (kind === 'branch') {
    return {
      variant: 'outlined',
      size: 'small',
      sx: { borderStyle: 'dashed' },
    };
  }
  return {
    variant: 'filled',
    size: 'small',
    color: 'default',
  };
}

/**
 * Read-only overview of the default tenant hiring flow for admins editing AI hiring policy.
 */
const WorkflowOverviewCard: React.FC = () => {
  return (
    <Paper variant="outlined" sx={{ p: 1.75, mb: 2, borderRadius: 2 }}>
      <Stack spacing={1.5}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.25 }}>
            <AccountTreeIcon sx={{ fontSize: 20, color: 'text.secondary' }} aria-hidden />
            <Typography variant="subtitle1" component="h3" fontWeight={600}>
              How hiring works (tenant baseline)
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Typical path when tenant defaults apply. Job orders, user groups, and manual actions can change what any one
            candidate experiences.
          </Typography>
        </Box>

        <Stack component="ol" spacing={0.75} sx={{ m: 0, pl: 2 }}>
          {HOW_IT_WORKS_STEPS.map((step) => (
            <Typography key={step.title} component="li" variant="body2" color="text.primary" sx={{ lineHeight: 1.45 }}>
              <strong>{step.title}</strong> — {step.body}
            </Typography>
          ))}
        </Stack>

        <Box>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Lifecycle reference
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }} role="list" aria-label="Stages">
            {HIRING_LIFECYCLE_WORKFLOW_OVERVIEW_CHIPS.map((c) => (
              <Chip key={c.stage} label={c.label} {...chipPropsForKind(c.kind)} role="listitem" size="small" />
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
            This page sets prescreen defaults and score/capacity knobs only. Branch stages (e.g. review, waitlist) are not
            visited by every candidate. Next actions such as {HIRING_NEXT_ACTION_UI_EXAMPLES.slice(0, 2).join(', ')} show
            who should act next when present on an application.
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
};

export default WorkflowOverviewCard;
