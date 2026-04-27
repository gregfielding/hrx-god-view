import React from 'react';
import { Card, CardContent, Chip, Stack, Typography } from '@mui/material';

interface ProfileNudgeItem {
  id: string;
  label: string;
}

interface ProfileNudgesSectionProps {
  items: ProfileNudgeItem[];
  onSelectNudge: (id: string) => void;
}

const ProfileNudgesSection: React.FC<ProfileNudgesSectionProps> = ({ items, onSelectNudge }) => {
  if (items.length === 0) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1.25}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Keep building your profile
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {items.map((item) => (
              <Chip
                key={item.id}
                label={item.label}
                variant="outlined"
                onClick={() => onSelectNudge(item.id)}
              />
            ))}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ProfileNudgesSection;
