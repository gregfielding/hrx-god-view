import React from 'react';
import { useNavigate } from 'react-router-dom';
import { IconButton, Tooltip } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { SxProps, Theme } from '@mui/material/styles';

/**
 * UniversalBackButton — the canonical "back" affordance for admin and
 * recruiter-facing pages.
 *
 * Visual spec (matches the back button on the User Group detail page,
 * `/usergroups/:id`):
 *   - 32x32 square IconButton
 *   - 1px outline in `rgba(0, 87, 184, 0.5)`
 *   - Brand blue icon (`#0057B8`), `fontSize: 18`
 *   - On hover, border darkens to solid `#0057B8` and the bg picks up a
 *     translucent blue tint
 *   - Wrapped in a `<Tooltip title="Back" />`
 *
 * Behavior:
 *   - If `to` is provided, `navigate(to)` is called.
 *   - Otherwise, falls back to `navigate(-1)` (browser-style back).
 *   - Pass `onClick` to override entirely (e.g. for callers that need to
 *     reconcile state — like User Group Details, which navigates to a
 *     different route depending on whether it was opened from the top-level
 *     Users hub or from a tenant tab).
 *
 * NOTE: This component is for admin/recruiter surfaces only. Worker-facing
 * pages (e.g. anything under `src/pages/c1/workers/`) should keep their
 * existing platform-native back affordances.
 */
export interface UniversalBackButtonProps {
  /** Destination route. Ignored if `onClick` is provided. */
  to?: string;
  /** Override the default navigation behavior entirely. */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Tooltip override (defaults to "Back"). */
  tooltip?: string;
  /** Optional sx overrides — merged with the canonical style. */
  sx?: SxProps<Theme>;
  /** Optional aria-label override (defaults to the tooltip text). */
  ariaLabel?: string;
}

const baseSx: SxProps<Theme> = {
  width: 32,
  height: 32,
  border: '1px solid',
  borderColor: 'rgba(0, 87, 184, 0.5)',
  color: '#0057B8',
  '&:hover': {
    borderColor: '#0057B8',
    bgcolor: 'rgba(0, 87, 184, 0.04)',
  },
};

const UniversalBackButton: React.FC<UniversalBackButtonProps> = ({
  to,
  onClick,
  tooltip = 'Back',
  sx,
  ariaLabel,
}) => {
  const navigate = useNavigate();

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (onClick) {
      onClick(event);
      return;
    }
    if (to) {
      navigate(to);
      return;
    }
    navigate(-1);
  };

  return (
    <Tooltip title={tooltip}>
      <IconButton
        onClick={handleClick}
        aria-label={ariaLabel ?? tooltip}
        sx={Array.isArray(sx) ? [baseSx, ...sx] : [baseSx, sx ?? {}]}
      >
        <ArrowBackIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Tooltip>
  );
};

export default UniversalBackButton;
