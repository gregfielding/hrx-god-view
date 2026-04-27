import React from 'react';
import type { SvgIconComponent } from '@mui/icons-material';
import DirectionsBike from '@mui/icons-material/DirectionsBike';
import DirectionsCar from '@mui/icons-material/DirectionsCar';
import DirectionsTransit from '@mui/icons-material/DirectionsTransit';
import DirectionsWalk from '@mui/icons-material/DirectionsWalk';
import MoreHoriz from '@mui/icons-material/MoreHoriz';
import RecordHeaderActionIcon from './RecordHeaderActionIcon';

/** Matches ProfileOverview `transportOptions` values (users.transportMethod). */
const TRANSPORT_BY_VALUE: Record<string, { Icon: SvgIconComponent; label: string }> = {
  Car: { Icon: DirectionsCar, label: 'Car' },
  'Public Transit': { Icon: DirectionsTransit, label: 'Public Transit' },
  Bike: { Icon: DirectionsBike, label: 'Bike' },
  Walk: { Icon: DirectionsWalk, label: 'Walk' },
  Other: { Icon: MoreHoriz, label: 'Other' },
};

function resolveTransport(raw: string | null | undefined): { Icon: SvgIconComponent; label: string } | null {
  if (raw == null) return null;
  const key = String(raw).trim();
  if (!key) return null;
  return TRANSPORT_BY_VALUE[key] ?? { Icon: MoreHoriz, label: key };
}

export type RecordHeaderTransportMethodIconProps = {
  transportMethod: string | null | undefined;
};

/**
 * Signal-strip icon for `users.transportMethod` (same options as Profile → employment).
 * Hidden when not set.
 */
const RecordHeaderTransportMethodIcon: React.FC<RecordHeaderTransportMethodIconProps> = ({
  transportMethod,
}) => {
  const resolved = resolveTransport(transportMethod);
  if (!resolved) return null;
  const { Icon, label } = resolved;
  return (
    <RecordHeaderActionIcon tooltip={`Transportation: ${label}`}>
      <Icon />
    </RecordHeaderActionIcon>
  );
};

export default RecordHeaderTransportMethodIcon;
