import React from 'react';
import { Box, Typography } from '@mui/material';
import onetSkills from '../../../data/onetSkills.json';
import onetJobTitles from '../../../data/onetJobTitles.json';
import SkillsTab from '../../../pages/UserProfile/components/SkillsTab/SkillsTab';

type Props = {
  value: any;
  onChange: (v: any) => void;
};

const QualificationsStep: React.FC<Props> = ({ value, onChange }) => {
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>Tell us about your skills and background</Typography>
      <SkillsTab
        user={value || {}}
        onUpdate={(updated) => onChange(updated)}
        onetSkills={onetSkills as any}
        onetJobTitles={onetJobTitles as any}
      />
    </Box>
  );
};

export default QualificationsStep;


