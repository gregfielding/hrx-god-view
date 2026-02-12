import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Box } from '@mui/material';
import WorkEligibilityStep from '../../../components/apply/steps/WorkEligibilityStep';
import { deriveWorkEligibilityFromAttestation } from '../../../types/workEligibility';

type Props = {
  user: any;
  onUpdate: (partial: any) => Promise<void> | void;
};

const WorkEligibilityTab: React.FC<Props> = ({ user, onUpdate }) => {
  const initial = useMemo(() => {
    const a = user?.workEligibilityAttestation;
    if (a && typeof a === 'object') {
      return {
        workAuthorized: a.authorizedToWorkUS === true,
        requireSponsorship: !!a.requireSponsorship,
        gender: a.gender ?? user?.gender ?? '',
        veteranStatus: a.veteranStatus ?? user?.veteranStatus ?? '',
        disabilityStatus: a.disabilityStatus ?? user?.disabilityStatus ?? '',
      };
    }
    return {
      workAuthorized: !!user?.workEligibility,
      requireSponsorship: !!user?.requireSponsorship,
      gender: user?.gender || '',
      veteranStatus: user?.veteranStatus || '',
      disabilityStatus: user?.disabilityStatus || '',
    };
  }, [user]);

  const [value, setValue] = useState<any>(initial);
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    if (JSON.stringify(value) === JSON.stringify(initial)) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const attestation = {
          authorizedToWorkUS: !!value.workAuthorized,
          requireSponsorship: !!value.requireSponsorship,
          attestedAt: new Date(),
          gender: value.gender || null,
          veteranStatus: value.veteranStatus || null,
          disabilityStatus: value.disabilityStatus || null,
        };
        const workEligibility = deriveWorkEligibilityFromAttestation(attestation as any);
        await onUpdate({
          workEligibilityAttestation: attestation,
          workEligibility,
          requireSponsorship: !!value.requireSponsorship,
          gender: value.gender || '',
          veteranStatus: value.veteranStatus || '',
          disabilityStatus: value.disabilityStatus || '',
        });
      } catch (error) {
        console.error('Error saving work eligibility:', error);
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, initial, onUpdate]);

  return (
    <Box>
      <WorkEligibilityStep value={value} onChange={setValue} />
    </Box>
  );
};

export default WorkEligibilityTab;


