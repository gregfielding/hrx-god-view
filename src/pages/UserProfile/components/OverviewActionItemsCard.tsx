import React, { useMemo } from 'react';
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import type { ActionItem } from '../../../types/actionItems';
import { mapActionItemsToSections, type ActionItemsSections } from '../../../utils/userActionItems/mapToSections';
import { overviewCardFlatSx, overviewSectionTitleTypographyProps, overviewProfileFieldValueSx } from './OverviewDashboardSections';

export type OverviewActionItemsCardProps = {
  items: ActionItem[];
  loading?: boolean;
  onOpenEmploymentTab?: () => void;
};

function ActionRows({ items, overflow }: { items: ActionItem[]; overflow: number }) {
  if (items.length === 0) {
    return (
      <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, fontStyle: 'italic' }}>
        None
      </Typography>
    );
  }
  return (
    <Stack spacing={0.75}>
      {items.map((a) => (
        <Box key={a.id} sx={{ borderLeft: '2px solid', borderColor: 'divider', pl: 0.75 }}>
          <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, fontWeight: 600, color: 'text.primary' }}>
            {a.title}
          </Typography>
          <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, display: 'block' }}>
            {a.shortDescription}
          </Typography>
        </Box>
      ))}
      {overflow > 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
          +{overflow} more
        </Typography>
      ) : null}
    </Stack>
  );
}

const OverviewActionItemsCard: React.FC<OverviewActionItemsCardProps> = ({
  items,
  loading,
  onOpenEmploymentTab,
}) => {
  const sections: ActionItemsSections = useMemo(() => mapActionItemsToSections(items), [items]);
  const total =
    sections.blocking.length + sections.nextSteps.length + sections.watchouts.length + sections.overflow.blocking + sections.overflow.nextSteps + sections.overflow.watchouts;

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
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1} flexWrap="wrap">
          <Box sx={{ minWidth: 0 }}>
            <Typography {...overviewSectionTitleTypographyProps}>Action items</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, fontSize: '0.65rem' }}>
              {loading
                ? 'Loading…'
                : total === 0
                  ? 'No action items detected'
                  : `${sections.blocking.length + sections.overflow.blocking} blockers · ${sections.nextSteps.length + sections.overflow.nextSteps} next · ${sections.watchouts.length + sections.overflow.watchouts} watchouts`}
            </Typography>
          </Box>
          {onOpenEmploymentTab && (
            <Button
              size="small"
              variant="text"
              sx={{ minWidth: 0, fontSize: '0.68rem', py: 0.125, px: 0.4, color: 'text.secondary', fontWeight: 500 }}
              onClick={onOpenEmploymentTab}
            >
              Employment
            </Button>
          )}
        </Stack>

        <Stack spacing={1.1} sx={{ mt: 0.85 }}>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 0.35, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em' }}
            >
              Blocking now
            </Typography>
            <ActionRows items={sections.blocking} overflow={sections.overflow.blocking} />
          </Box>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 0.35, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em' }}
            >
              Next steps
            </Typography>
            <ActionRows items={sections.nextSteps} overflow={sections.overflow.nextSteps} />
          </Box>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 0.35, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em' }}
            >
              Recruiter watchouts
            </Typography>
            <ActionRows items={sections.watchouts} overflow={sections.overflow.watchouts} />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default OverviewActionItemsCard;
