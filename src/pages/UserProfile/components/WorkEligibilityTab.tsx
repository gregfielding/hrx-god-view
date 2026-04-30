import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Alert, Box } from '@mui/material';
import WorkEligibilityStep from '../../../components/apply/steps/WorkEligibilityStep';
import { deriveWorkEligibilityFromAttestation } from '../../../types/workEligibility';
import { isWorkAuthCollectionDisabled } from '../../../utils/workAuthCollectionFlag';

type Props = {
  user: any;
  onUpdate: (partial: any) => Promise<void> | void;
};

const WorkEligibilityTab: React.FC<Props> = ({ user, onUpdate }) => {
  // W.3 — once collection is disabled (default), this tab no longer
  // accepts edits. Display surfaces still source from
  // `users.workEligibility`, which W.1's server-side mirror keeps fresh
  // (Everee I-9 for W-2, federal contractor rule for 1099). Show a
  // single explanatory alert so HRX staff opening the tab understand
  // why the editor is gone, instead of seeing a blank tab.
  const collectionDisabled = isWorkAuthCollectionDisabled();

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
    // When collection is disabled the editor never renders and `value`
    // never changes; this effect is effectively a no-op. Skip the early
    // diff to avoid running the setTimeout dance for nothing.
    if (collectionDisabled) return;
    if (JSON.stringify(value) === JSON.stringify(initial)) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        // W.3 — preserve the existing nested attestation when the EEO
        // inputs aren't rendered (default path). Without this spread, a
        // save would clobber any historical EEO with `null`. See the
        // sibling Wizard persist for the same pattern.
        const prevAtt = (user?.workEligibilityAttestation || {}) as Record<string, unknown>;
        const attestation: Record<string, unknown> = {
          ...prevAtt,
          authorizedToWorkUS: !!value.workAuthorized,
          requireSponsorship: !!value.requireSponsorship,
          attestedAt: new Date(),
          ...(value.gender !== undefined ? { gender: value.gender || null } : {}),
          ...(value.veteranStatus !== undefined ? { veteranStatus: value.veteranStatus || null } : {}),
          ...(value.disabilityStatus !== undefined ? { disabilityStatus: value.disabilityStatus || null } : {}),
        };
        const workEligibility = deriveWorkEligibilityFromAttestation(attestation as any);
        await onUpdate({
          workEligibilityAttestation: attestation,
          workEligibility,
          requireSponsorship: !!value.requireSponsorship,
          ...(value.gender !== undefined ? { gender: value.gender || '' } : {}),
          ...(value.veteranStatus !== undefined ? { veteranStatus: value.veteranStatus || '' } : {}),
          ...(value.disabilityStatus !== undefined ? { disabilityStatus: value.disabilityStatus || '' } : {}),
        });
      } catch (error) {
        console.error('Error saving work eligibility:', error);
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, initial, onUpdate, collectionDisabled, user]);

  if (collectionDisabled) {
    return (
      <Box>
        <Alert severity="info">
          Work authorization is collected during payroll onboarding through Everee.
          No action needed here.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <WorkEligibilityStep value={value} onChange={setValue} />
    </Box>
  );
};

export default WorkEligibilityTab;
