/**
 * HotToggle — the 🔥 flag (Greg, 2026-07-08: "just hot or not").
 *
 * Outlined gray flame = not hot (click to mark). 🔥 emoji = hot (click to
 * unmark). Hot is SHARED across the trio — flipping it on a job order,
 * child account, or contact flips all linked records via the
 * `setHotStatus` callable (both directions). Optimistic UI; reverts on
 * failure.
 *
 * Sizing/behavior deliberately mirrors FavoriteButton (the star it sits
 * next to): small IconButton, glyph locked at 1.2rem (override per
 * surface via `sx`'s `& .MuiSvgIcon-root`), stopPropagation, tinted
 * hover.
 */

import React, { useEffect, useState } from 'react';
import { IconButton, Tooltip, Box, SxProps, Theme } from '@mui/material';
import LocalFireDepartmentOutlinedIcon from '@mui/icons-material/LocalFireDepartmentOutlined';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../firebase';

export interface HotToggleProps {
  tenantId: string;
  originType: 'job_order' | 'account' | 'contact';
  originId: string;
  hot: boolean | undefined;
  /** Passed through to the IconButton — use the same sx as the adjacent
   *  FavoriteButton so the pair reads as one control group. */
  sx?: SxProps<Theme>;
  onChanged?: (hot: boolean) => void;
}

const HotToggle: React.FC<HotToggleProps> = ({
  tenantId,
  originType,
  originId,
  hot,
  sx,
  onChanged,
}) => {
  const [isHot, setIsHot] = useState<boolean>(hot === true);
  const [saving, setSaving] = useState(false);

  // Track upstream changes (e.g. parent reloads the doc).
  useEffect(() => {
    setIsHot(hot === true);
  }, [hot]);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (saving) return;
    const next = !isHot;
    setIsHot(next); // optimistic
    setSaving(true);
    try {
      const fn = httpsCallable(functions, 'setHotStatus', { timeout: 30000 });
      await fn({ tenantId, originType, originId, hot: next });
      onChanged?.(next);
    } catch (err) {
      console.error('setHotStatus failed:', err);
      setIsHot(!next); // revert
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tooltip
      title={
        isHot
          ? 'Hot — engaged client relationship. Click to unmark (unmarks the linked order, account, and contact too).'
          : 'Mark hot — flags this and the linked order, account, and contact for priority attention.'
      }
    >
      <IconButton
        size="small"
        onClick={toggle}
        disabled={saving}
        sx={{
          color: 'text.secondary',
          // Same 1.2rem glyph lock as FavoriteButton so the pair matches
          // across tables, cards, and headers.
          '& .MuiSvgIcon-root': {
            fontSize: '1.2rem',
          },
          '&:hover': {
            color: '#ff5722',
            backgroundColor: 'rgba(255, 87, 34, 0.08)',
          },
          ...sx,
        }}
      >
        {isHot ? (
          <Box
            component="span"
            aria-label="Hot"
            sx={{
              // The emoji renders visually larger than an SVG at equal
              // font-size; 0.92em of the icon slot keeps them level.
              fontSize: '1.05rem',
              lineHeight: 1,
            }}
          >
            🔥
          </Box>
        ) : (
          <LocalFireDepartmentOutlinedIcon />
        )}
      </IconButton>
    </Tooltip>
  );
};

export default HotToggle;
