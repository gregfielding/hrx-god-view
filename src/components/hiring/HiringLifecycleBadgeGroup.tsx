import React from 'react';
import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import {
  HIRING_LIFECYCLE_STAGE_LABELS,
  HIRING_NEXT_ACTION_LABELS,
  isHiringLifecycleStage,
  isHiringNextAction,
  type HiringLifecycleStage,
  type HiringNextAction,
} from '../../constants/hiringLifecycle';
import type { ApplicationHiringLifecycle } from '../../types/applicationHiringLifecycle';

export type HiringLifecycleBadgeGroupProps = {
  lifecycle?: ApplicationHiringLifecycle | null;
  /**
   * Stored application status (humanized). When `lifecycle` is present, used as a secondary line
   * in the tooltip only. When lifecycle is absent, shown as the primary fallback label.
   */
  legacyStatusLabel?: string | null;
  /** Orchestrator snapshot — tooltip/context only, never a competing primary chip row. */
  aiAutomationSummary?: string | null;
  compact?: boolean;
};

function stageLabel(stage: string): string {
  if (isHiringLifecycleStage(stage)) {
    return HIRING_LIFECYCLE_STAGE_LABELS[stage as HiringLifecycleStage];
  }
  return stage.replace(/_/g, ' ');
}

function nextActionLabel(action: string): string {
  if (isHiringNextAction(action)) {
    return HIRING_NEXT_ACTION_LABELS[action as HiringNextAction];
  }
  return action.replace(/_/g, ' ');
}

function shortenBlocker(code: string, max = 22): string {
  if (code.length <= max) return code;
  return `${code.slice(0, max - 1)}…`;
}

function buildContextTooltip(args: {
  lifecycleSummaryLines: string[];
  legacyStatusLabel?: string | null;
  aiAutomationSummary?: string | null;
}): string {
  const lines: string[] = [...args.lifecycleSummaryLines];
  const leg = args.legacyStatusLabel && String(args.legacyStatusLabel).trim();
  if (leg) lines.push(`Status: ${leg}`);
  const ai = args.aiAutomationSummary && String(args.aiAutomationSummary).trim();
  if (ai) lines.push(`AI automation: ${ai}`);
  return lines.join('\n');
}

/**
 * Recruiter/admin summary: lifecycle stage + nextAction + blockers (primary).
 * Fallback: legacy status. AI orchestrator details only in tooltip.
 */
const HiringLifecycleBadgeGroup: React.FC<HiringLifecycleBadgeGroupProps> = ({
  lifecycle,
  legacyStatusLabel,
  aiAutomationSummary,
  compact,
}) => {
  const hasLifecycle =
    lifecycle &&
    (lifecycle.stage != null || lifecycle.nextAction != null || (lifecycle.blockers && lifecycle.blockers.length > 0));

  if (!hasLifecycle) {
    if (legacyStatusLabel && String(legacyStatusLabel).trim()) {
      const ai = aiAutomationSummary && String(aiAutomationSummary).trim();
      const tip =
        ai != null && ai.length > 0
          ? `Stored application status (no hiringLifecycle yet).\n\nAI automation: ${ai}`
          : 'Stored application status (no hiringLifecycle yet).';
      return (
        <Tooltip title={tip}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ maxWidth: compact ? 140 : 220 }}>
            Legacy: {legacyStatusLabel}
          </Typography>
        </Tooltip>
      );
    }
    return (
      <Typography variant="caption" color="text.disabled">
        —
      </Typography>
    );
  }

  const stage = lifecycle!.stage;
  const nextAction = lifecycle!.nextAction;
  const blockers = lifecycle!.blockers ?? [];
  const showNext = nextAction !== undefined && nextAction !== '' && nextAction !== 'none';

  const sub = lifecycle?.subStatus && String(lifecycle.subStatus).trim();
  const stageChipTitle = sub
    ? `${stageLabel(String(stage ?? ''))} — ${sub.replace(/_/g, ' ')}`
    : stageLabel(String(stage ?? ''));

  const lifecycleSummaryLines: string[] = [];
  if (stage != null && stage !== '') lifecycleSummaryLines.push(stageChipTitle);
  if (showNext) lifecycleSummaryLines.push(`Next: ${nextActionLabel(String(nextAction))}`);
  if (blockers.length) lifecycleSummaryLines.push(`Blockers: ${blockers.join(', ')}`);

  const tooltipTitle = buildContextTooltip({
    lifecycleSummaryLines:
      lifecycleSummaryLines.length > 0 ? lifecycleSummaryLines : ['(lifecycle present; no stage/next/blockers parsed)'],
    legacyStatusLabel,
    aiAutomationSummary,
  });

  return (
    <Tooltip title={tooltipTitle}>
      <Stack spacing={0.5} alignItems="flex-start" sx={{ maxWidth: compact ? 200 : 280 }}>
        {stage != null && stage !== '' && (
          <Tooltip title={stageChipTitle}>
            <Chip
              size="small"
              label={stageLabel(String(stage))}
              color="primary"
              variant="filled"
              sx={{ fontWeight: 700, fontSize: compact ? '0.7rem' : undefined }}
            />
          </Tooltip>
        )}
        {showNext && (
          <Chip
            size="small"
            label={nextActionLabel(String(nextAction))}
            variant="outlined"
            sx={{ fontSize: compact ? '0.65rem' : '0.75rem', color: 'text.secondary', borderColor: 'divider' }}
          />
        )}
        {blockers.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
            {blockers.slice(0, 2).map((b) => (
              <Tooltip key={b} title={b}>
                <Chip
                  size="small"
                  label={shortenBlocker(String(b))}
                  variant="outlined"
                  sx={{ fontSize: '0.65rem', maxWidth: 120 }}
                />
              </Tooltip>
            ))}
            {blockers.length > 2 && (
              <Typography variant="caption" color="text.secondary">
                +{blockers.length - 2}
              </Typography>
            )}
          </Box>
        )}
      </Stack>
    </Tooltip>
  );
};

export default HiringLifecycleBadgeGroup;
