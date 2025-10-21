import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Box } from '@mui/material';
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
  const debounceRef = useRef<any>(null);

  // Auto-save on change with debounce
  useEffect(() => {
    // Don't save on initial load
    if (JSON.stringify(value) === JSON.stringify(initial)) return;

    // Clear existing timeout
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Set new timeout to save after 500ms
    debounceRef.current = setTimeout(async () => {
      try {
        await onUpdate({
          workEligibility: !!value.workAuthorized,
          requireSponsorship: !!value.requireSponsorship,
          gender: value.gender || '',
          veteranStatus: value.veteranStatus || '',
          disabilityStatus: value.disabilityStatus || ''
        });
      } catch (error) {
        console.error('Error saving work eligibility:', error);
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, initial, onUpdate]);

  return (
    <Box>
      <WorkEligibilityStep value={value} onChange={setValue} />
    </Box>
  );
};

export default WorkEligibilityTab;


