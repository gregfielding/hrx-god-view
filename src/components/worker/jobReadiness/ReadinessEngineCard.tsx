import React from 'react';
import { Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';

import type { ReadinessCard } from '../../../utils/jobReadinessEngine';

interface ReadinessEngineCardProps {
  card: ReadinessCard;
  onAction: (actionValue: string) => void;
}

const ReadinessEngineCard: React.FC<ReadinessEngineCardProps> = ({ card, onAction }) => {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, borderColor: 'divider', minHeight: 240 }}>
      <CardContent sx={{ p: 2.5 }}>
        <Typography variant="overline" color="primary.main" sx={{ fontWeight: 700 }}>
          Next Best Step
        </Typography>
        <Typography variant="h6" sx={{ mt: 0.5, fontWeight: 700 }}>
          {card.title}
        </Typography>
        {card.lifecycleState ? (
          <Chip
            size="small"
            label={`Status: ${card.lifecycleState.replace('_', ' ')}`}
            sx={{ mt: 1, alignSelf: 'flex-start' }}
          />
        ) : null}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {card.body}
        </Typography>
        {card.whyThisMatters ? (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Why this matters: {card.whyThisMatters}
          </Typography>
        ) : null}
        {card.whatThisUnlocks ? (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            What this can unlock: {card.whatThisUnlocks}
          </Typography>
        ) : null}

        <Stack direction="row" spacing={1} sx={{ mt: 2 }} useFlexGap flexWrap="wrap">
          {card.actions.map((action) => (
            <Button
              key={action.id}
              variant={action.variant || 'outlined'}
              size="small"
              onClick={() => onAction(action.value || action.id)}
            >
              {action.label}
            </Button>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ReadinessEngineCard;

