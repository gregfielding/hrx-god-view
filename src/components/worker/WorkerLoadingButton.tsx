/**
 * Worker UI button with loading state for async actions.
 * When loading: shows spinner, disables button, preserves width from original label to avoid layout shift.
 * Use with useWorkerToast().success() after completion. See docs/WORKER_INTERACTION_SYSTEM.md §5.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Button, ButtonProps, CircularProgress } from '@mui/material';

export interface WorkerLoadingButtonProps extends Omit<ButtonProps, 'disabled'> {
  /** When true, show spinner and disable; preserves button size */
  loading?: boolean;
  /** Override disabled state (still disabled when loading) */
  disabled?: boolean;
}

const WorkerLoadingButton: React.FC<WorkerLoadingButtonProps> = ({
  loading = false,
  disabled = false,
  children,
  startIcon,
  endIcon,
  sx,
  ...rest
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [preservedWidth, setPreservedWidth] = useState<number | null>(null);

  // Capture button width when not loading so we preserve it when loading
  useEffect(() => {
    if (!loading && buttonRef.current) {
      const w = buttonRef.current.getBoundingClientRect().width;
      setPreservedWidth(w);
    }
  }, [loading, children]);

  return (
    <Button
      ref={buttonRef}
      disabled={disabled || loading}
      startIcon={loading ? <CircularProgress size={18} color="inherit" /> : startIcon}
      endIcon={loading ? undefined : endIcon}
      sx={loading ? { minWidth: preservedWidth ?? 100, ...sx } : sx}
      {...rest}
    >
      {loading ? '\u00A0' : children}
    </Button>
  );
};

export default WorkerLoadingButton;
