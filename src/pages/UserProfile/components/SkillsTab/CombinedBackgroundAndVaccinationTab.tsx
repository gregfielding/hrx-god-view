import React from 'react';
import { Box, Divider } from '@mui/material';
import BackgroundCheckTab from './BackgroundCheckTab';
import VaccinationStatusTab from './VaccinationStatusTab';

const CombinedBackgroundAndVaccinationTab = ({ uid }: { uid: string }) => {
  return (
    <Box>
      <BackgroundCheckTab uid={uid} />
      <Divider sx={{ my: 4 }} />
      <VaccinationStatusTab uid={uid} />
    </Box>
  );
};

export default CombinedBackgroundAndVaccinationTab; 