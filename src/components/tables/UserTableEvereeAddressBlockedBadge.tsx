/**
 * UserTableEvereeAddressBlockedBadge
 *
 * Surfaces "this Everee-linked worker is missing a complete profile
 * address" so recruiters can chase the gap before the next sync. The
 * lockout itself happens server-side (Everee's anti-fraud engine flips
 * `accountAccessPermitted: false` on a worker created with an empty /
 * stub homeAddress), but it's invisible from the HRX side until you
 * try to open the embed. This chip makes it visible from the worker
 * record header at a glance.
 *
 * Gate:
 *   - User must be Everee-linked (at least one entity-keyed entry in
 *     `users.evereeWorkerIds`). Workers not yet provisioned aren't
 *     "blocked" — they're just not synced.
 *   - The shared `extractEvereeHomeAddressFromUserDoc` must return null
 *     against the user doc. Mirrors exactly what the server will do
 *     on the next `evereeEnsureWorker` / address-patch call, so the
 *     chip never lies about the actual provisioning state.
 *
 * Same lightweight shape as `UserTableIndeedFlexBadge` etc. so the
 * existing header layout can slot it next to its siblings without
 * extra wrapper containers.
 */

import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';

import { extractEvereeHomeAddressFromUserDoc } from '../../shared/everee/extractHomeAddress';

type Props = {
  user: Record<string, unknown> | null | undefined;
  /** When true, no top margin — use inline with other row icons. */
  compact?: boolean;
};

function isEvereeLinked(user: Record<string, unknown> | null | undefined): boolean {
  if (!user) return false;
  const map = user.evereeWorkerIds;
  if (!map || typeof map !== 'object') return false;
  // Any non-empty string value in the map means at least one entity
  // has a linkage to Everee for this worker.
  for (const v of Object.values(map as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim().length > 0) return true;
  }
  return false;
}

const UserTableEvereeAddressBlockedBadge: React.FC<Props> = ({ user, compact }) => {
  if (!isEvereeLinked(user)) return null;
  // `user` is the same record-shape we pass to the server extractor —
  // includes `addressInfo` / `address` / loose top-level fields.
  const extracted = extractEvereeHomeAddressFromUserDoc(
    user as Record<string, unknown>,
  );
  if (extracted) return null; // Address is complete — nothing to flag.

  return (
    <Box sx={{ mt: compact ? 0 : 0.25, lineHeight: 0 }}>
      <Tooltip
        title={
          <Box sx={{ maxWidth: 280 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Everee sync blocked
            </Typography>
            <Typography variant="caption" sx={{ display: 'block' }}>
              Worker is missing a complete home address (street, city,
              state, 5-digit ZIP). Everee&apos;s anti-fraud engine locks
              accounts created without one. Update the profile address,
              then resync.
            </Typography>
          </Box>
        }
        arrow
        placement="top"
      >
        {/* Span wrapper so disabled-state Tooltip warnings don't fire. */}
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.25,
            // Mirror the Indeed Flex / Fieldglass badge sizing so the
            // row visually balances. Soft-red palette to read as a
            // warning without screaming "error".
            bgcolor: '#fdecea',
            color: '#b3261e',
            borderRadius: '999px',
            px: 0.75,
            py: 0.25,
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}
        >
          <WarningAmberRoundedIcon sx={{ fontSize: 14 }} />
          <span>Everee blocked</span>
        </Box>
      </Tooltip>
    </Box>
  );
};

export default UserTableEvereeAddressBlockedBadge;
