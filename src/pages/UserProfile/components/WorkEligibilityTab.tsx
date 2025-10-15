import React, { useMemo, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import WorkEligibilityStep from '../../../components/apply/steps/WorkEligibilityStep';

type Props = {
  user: any;
  onUpdate: (partial: any) => Promise<void> | void;
};

const WorkEligibilityTab: React.FC<Props> = ({ user, onUpdate }) => {
  const initial = useMemo(() => ({
    workAuthorized: !!user?.workEligibility,
    requireSponsorship: !!user?.requireSponsorship,
    gender: user?.gender || '',
    veteranStatus: user?.veteranStatus || '',
    disabilityStatus: user?.disabilityStatus || ''
  }), [user]);

  const [value, setValue] = useState<any>(initial);
  const [saving, setSaving] = useState(false);

  const hasChanges = JSON.stringify(value) !== JSON.stringify(initial);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({
        workEligibility: !!value.workAuthorized,
        requireSponsorship: !!value.requireSponsorship,
        gender: value.gender || '',
        veteranStatus: value.veteranStatus || '',
        disabilityStatus: value.disabilityStatus || ''
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>Manage your work authorization and optional EEO info</Typography>
      <WorkEligibilityStep value={value} onChange={setValue} />
      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
        <Button variant="contained" disabled={!hasChanges || saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </Stack>
    </Box>
  );
};

export default WorkEligibilityTab;


