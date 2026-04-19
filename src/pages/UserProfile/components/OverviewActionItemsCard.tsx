import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import type { ActionItem } from '../../../types/actionItems';
import { ACTION_ITEMS_RULES_VERSION } from '../../../types/actionItems';
import {
  mapActionItemsToSections,
  countActionItemsByBlockingKind,
  type ActionItemsSections,
} from '../../../utils/userActionItems/mapToSections';
import { actorLabel, scopeBadgeLabelForActionItem } from '../../../utils/userActionItems/actionItemPresentation';
import {
  overviewCardFlatSx,
  overviewSectionTitleTypographyProps,
  overviewProfileFieldValueSx,
  overviewCardHeaderTextButtonSx,
} from './OverviewDashboardSections';

export type OverviewActionItemsCardProps = {
  items: ActionItem[];
  loading?: boolean;
  onNavigateCta?: (item: ActionItem) => void;
};

type RowVariant = 'blocker' | 'urgentNext' | 'next' | 'watchout';

function rowVariantForItem(item: ActionItem): RowVariant {
  if (item.blocking === 'hard') return 'blocker';
  if (item.blocking === 'soft' && (item.severity === 'high' || item.severity === 'critical')) return 'urgentNext';
  if (item.blocking === 'soft') return 'next';
  return 'watchout';
}

function rowShellSx(variant: RowVariant) {
  const base = {
    borderRadius: 0.5,
    py: 0.65,
    px: 0.85,
    pl: variant === 'watchout' ? 0.85 : 1,
  } as const;
  switch (variant) {
    case 'blocker':
      return {
        ...base,
        borderLeft: '3px solid',
        borderColor: 'error.main',
        bgcolor: (theme: Theme) => alpha(theme.palette.error.main, 0.07),
      };
    case 'urgentNext':
      return {
        ...base,
        borderLeft: '3px solid',
        borderColor: 'warning.main',
        bgcolor: (theme: Theme) => alpha(theme.palette.warning.main, 0.09),
      };
    case 'next':
      return {
        ...base,
        borderLeft: '2px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
      };
    case 'watchout':
    default:
      return {
        ...base,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.default',
      };
  }
}

function ActionItemRow({
  item,
  onNavigateCta,
}: {
  item: ActionItem;
  onNavigateCta?: (item: ActionItem) => void;
}) {
  const variant = rowVariantForItem(item);
  const scope = scopeBadgeLabelForActionItem(item);

  return (
    <Box sx={rowShellSx(variant)}>
      <Typography
        variant="body2"
        sx={{ ...overviewProfileFieldValueSx, fontWeight: 600, color: 'text.primary', display: 'block' }}
      >
        {item.title}
      </Typography>
      <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, display: 'block', mt: 0.15 }}>
        {item.shortDescription}
      </Typography>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={0.75} flexWrap="wrap" sx={{ mt: 0.4 }}>
        <Stack direction="row" alignItems="center" gap={0.5} flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            variant="outlined"
            label={actorLabel(item.actor)}
            sx={{
              height: 20,
              fontSize: '0.62rem',
              fontWeight: 500,
              borderColor: 'divider',
              color: 'text.secondary',
              '& .MuiChip-label': { px: 0.6 },
            }}
          />
          {scope ? (
            <Chip
              size="small"
              variant="outlined"
              label={scope}
              sx={{
                height: 20,
                fontSize: '0.62rem',
                fontWeight: 500,
                borderColor: 'divider',
                color: 'text.secondary',
                '& .MuiChip-label': { px: 0.6 },
              }}
            />
          ) : null}
        </Stack>
        {onNavigateCta ? (
          <Button
            size="small"
            variant="text"
            onClick={() => onNavigateCta(item)}
            sx={{ ...overviewCardHeaderTextButtonSx, fontSize: '0.72rem', flexShrink: 0 }}
          >
            {item.ctaLabel}
          </Button>
        ) : (
          <Typography variant="caption" sx={{ ...overviewProfileFieldValueSx, fontSize: '0.72rem' }}>
            {item.ctaLabel}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

function ActionRows({
  items,
  overflow,
  onNavigateCta,
}: {
  items: ActionItem[];
  overflow: number;
  onNavigateCta?: (item: ActionItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <Stack spacing={0.65}>
      {items.map((a) => (
        <ActionItemRow key={a.id} item={a} onNavigateCta={onNavigateCta} />
      ))}
      {overflow > 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', pl: 0.25 }}>
          +{overflow} more
        </Typography>
      ) : null}
    </Stack>
  );
}

const OverviewActionItemsCard: React.FC<OverviewActionItemsCardProps> = ({
  items,
  loading,
  onNavigateCta,
}) => {
  const sections: ActionItemsSections = useMemo(() => mapActionItemsToSections(items), [items]);
  const counts = useMemo(() => countActionItemsByBlockingKind(items), [items]);
  const total = counts.blocking + counts.nextSteps + counts.watchouts;

  const [debugOpen, setDebugOpen] = useState(false);
  const isDev = process.env.NODE_ENV === 'development';

  const dedupedTypes = useMemo(() => [...new Set(items.map((i) => i.type))].sort(), [items]);

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        ...overviewCardFlatSx,
      }}
    >
      <CardContent sx={{ py: 1, px: 1.25, '&:last-child': { pb: 1 } }}>
        <Typography {...overviewSectionTitleTypographyProps}>Action items</Typography>

        {loading ? (
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            <Skeleton variant="rounded" height={56} sx={{ borderRadius: 0.5 }} />
            <Skeleton variant="rounded" height={56} sx={{ borderRadius: 0.5 }} />
            <Skeleton variant="rounded" height={40} sx={{ borderRadius: 0.5, maxWidth: 280 }} />
          </Stack>
        ) : total === 0 ? (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, color: 'text.primary', fontWeight: 500 }}>
              No action items detected
            </Typography>
            <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, mt: 0.35 }}>
              This worker does not currently show any operational blockers or urgent follow-ups.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1.1} sx={{ mt: 0.85 }}>
            {sections.blocking.length + sections.overflow.blocking > 0 ? (
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 0.35, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em' }}
                >
                  Blocking now
                </Typography>
                <ActionRows
                  items={sections.blocking}
                  overflow={sections.overflow.blocking}
                  onNavigateCta={onNavigateCta}
                />
              </Box>
            ) : null}
            {sections.nextSteps.length + sections.overflow.nextSteps > 0 ? (
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 0.35, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em' }}
                >
                  Next steps
                </Typography>
                <ActionRows
                  items={sections.nextSteps}
                  overflow={sections.overflow.nextSteps}
                  onNavigateCta={onNavigateCta}
                />
              </Box>
            ) : null}
            {sections.watchouts.length + sections.overflow.watchouts > 0 ? (
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 0.35, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em' }}
                >
                  Recruiter watchouts
                </Typography>
                <ActionRows
                  items={sections.watchouts}
                  overflow={sections.overflow.watchouts}
                  onNavigateCta={onNavigateCta}
                />
              </Box>
            ) : null}
          </Stack>
        )}

        {isDev && !loading ? (
          <Box sx={{ mt: 1.25, pt: 0.75, borderTop: '1px dashed', borderColor: 'divider' }}>
            <Button
              size="small"
              variant="text"
              onClick={() => setDebugOpen((o) => !o)}
              sx={{ ...overviewCardHeaderTextButtonSx, fontSize: '0.62rem', color: 'text.disabled', minHeight: 0 }}
            >
              {debugOpen ? 'Hide' : 'Show'} action items debug
            </Button>
            <Collapse in={debugOpen}>
              <Typography
                component="pre"
                variant="caption"
                sx={{
                  display: 'block',
                  mt: 0.75,
                  fontSize: '0.6rem',
                  lineHeight: 1.45,
                  color: 'text.secondary',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  m: 0,
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                {[
                  `rulesVersion: ${items[0]?.rulesVersion ?? ACTION_ITEMS_RULES_VERSION}`,
                  `total derived (pre-cap): ${items.length}`,
                  `counts — blocking: ${counts.blocking}, next: ${counts.nextSteps}, watchouts: ${counts.watchouts}`,
                  `types (${dedupedTypes.length}): ${dedupedTypes.join(', ')}`,
                ].join('\n')}
              </Typography>
            </Collapse>
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default OverviewActionItemsCard;
