/**
 * HotToggle — the 🔥 flag (Greg, 2026-07-08: "just hot or not").
 *
 * Outlined gray flame = not hot (click to mark). 🔥 emoji = hot (click to
 * unmark). Hot is SHARED across the trio — flipping it on a job order,
 * child account, or contact flips all linked records via the
 * `setHotStatus` callable (both directions). Optimistic UI; reverts on
 * failure.
 */

import React, { useEffect, useState } from 'react';
import { IconButton, Tooltip, Box } from '@mui/material';
import LocalFireDepartmentOutlinedIcon from '@mui/icons-material/LocalFireDepartmentOutlined';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../firebase';

export interface HotToggleProps {
  tenantId: string;
  originType: 'job_order' | 'account' | 'contact';
  originId: string;
  hot: boolean | undefined;
  /** Icon square size in px (default 18). */
  size?: number;
  onChanged?: (hot: boolean) => void;
}

const HotToggle: React.FC<HotToggleProps> = ({
  tenantId,
  originType,
  originId,
  hot,
  size = 18,
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
      arrow
    >
      <IconButton size="small" onClick={toggle} disabled={saving} sx={{ p: 0.35 }}>
        {isHot ? (
          <Box component="span" sx={{ fontSize: size - 2, lineHeight: 1 }} aria-label="Hot">
            🔥
          </Box>
        ) : (
          <LocalFireDepartmentOutlinedIcon sx={{ fontSize: size, color: 'text.disabled' }} />
        )}
      </IconButton>
    </Tooltip>
  );
};

export default HotToggle;
