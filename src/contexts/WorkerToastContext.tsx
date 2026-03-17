/**
 * Worker UI toast notifications (success, error, warning, info).
 * Supports up to 3 visible toasts stacked; new push old up; oldest dismisses first; overflow queued.
 * Placement: bottom-center (mobile), top-right (desktop). Entrance: fade + slide up 120ms.
 * See docs/WORKER_INTERACTION_SYSTEM.md §3.
 */

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Box, Alert } from '@mui/material';

export type WorkerToastSeverity = 'success' | 'error' | 'warning' | 'info';

export interface WorkerToastOptions {
  /** Auto-hide after ms; default 5000 */
  duration?: number;
  /** Optional action button label */
  actionLabel?: string;
  /** Optional action callback */
  onAction?: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  severity: WorkerToastSeverity;
  duration: number;
  actionLabel?: string;
  onAction?: () => void;
}

interface WorkerToastContextValue {
  showToast: (message: string, severity?: WorkerToastSeverity, options?: WorkerToastOptions) => void;
  success: (message: string, options?: WorkerToastOptions) => void;
  error: (message: string, options?: WorkerToastOptions) => void;
  warning: (message: string, options?: WorkerToastOptions) => void;
  info: (message: string, options?: WorkerToastOptions) => void;
}

const MAX_VISIBLE_TOASTS = 3;
const TOAST_ENTRANCE_MS = 120;
const MOTION_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const WorkerToastContext = createContext<WorkerToastContextValue | null>(null);

export function WorkerToastProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState<ToastItem[]>([]);
  const queueRef = useRef<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: number) => {
    setVisible((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (timersRef.current[id] != null) {
        clearTimeout(timersRef.current[id]);
        delete timersRef.current[id];
      }
      const queued = queueRef.current.shift();
      if (queued != null) {
        setTimeout(() => {
          setVisible((v) => [...v, queued]);
          const d = queued.duration;
          if (d > 0) {
            timersRef.current[queued.id] = setTimeout(() => dismiss(queued.id), d);
          }
        }, 0);
      }
      return next;
    });
  }, []);

  const showToast = useCallback(
    (message: string, severity: WorkerToastSeverity = 'info', options?: WorkerToastOptions) => {
      const id = ++idRef.current;
      const item: ToastItem = {
        id,
        message,
        severity,
        duration: options?.duration ?? 5000,
        actionLabel: options?.actionLabel,
        onAction: options?.onAction,
      };
      setVisible((prev) => {
        if (prev.length >= MAX_VISIBLE_TOASTS) {
          queueRef.current = [...queueRef.current, item];
          return prev;
        }
        if (item.duration > 0) {
          timersRef.current[id] = setTimeout(() => dismiss(id), item.duration);
        }
        return [...prev, item];
      });
    },
    [dismiss]
  );

  const success = useCallback((message: string, options?: WorkerToastOptions) => showToast(message, 'success', options), [showToast]);
  const error = useCallback((message: string, options?: WorkerToastOptions) => showToast(message, 'error', options), [showToast]);
  const warning = useCallback((message: string, options?: WorkerToastOptions) => showToast(message, 'warning', options), [showToast]);
  const info = useCallback((message: string, options?: WorkerToastOptions) => showToast(message, 'info', options), [showToast]);

  const handleClose = useCallback(
    (id: number) => (_?: React.SyntheticEvent | Event, reason?: string) => {
      if (reason === 'clickaway') return;
      dismiss(id);
    },
    [dismiss]
  );

  const value: WorkerToastContextValue = { showToast, success, error, warning, info };

  return (
    <WorkerToastContext.Provider value={value}>
      {children}
      <Box
        sx={{
          position: 'fixed',
          zIndex: 1400,
          bottom: { xs: 24, sm: 'auto' },
          top: { xs: 'auto', sm: 24 },
          left: { xs: 16, sm: 'auto' },
          right: { xs: 16, sm: 24 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: { xs: 'stretch', sm: 'flex-end' },
          gap: 1.5,
          maxWidth: { xs: 'calc(100vw - 32px)', sm: 400 },
          pointerEvents: 'none',
          '& > *': { pointerEvents: 'auto' },
        }}
      >
        {visible.map((t, index) => (
          <Box
            key={t.id}
            sx={{
              animation: `workerToastIn ${TOAST_ENTRANCE_MS}ms ${MOTION_EASING} ${index * 40}ms forwards`,
              '@keyframes workerToastIn': {
                '0%': { opacity: 0, transform: 'translateY(14px) scale(0.98)' },
                '100%': { opacity: 1, transform: 'translateY(0) scale(1)' },
              },
              borderRadius: 12,
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            }}
          >
            <Alert
              onClose={handleClose(t.id)}
              severity={t.severity}
              variant="filled"
              elevation={0}
              action={
                t.actionLabel && t.onAction ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={t.onAction}
                    onKeyDown={(e) => e.key === 'Enter' && t.onAction?.()}
                    style={{ marginLeft: 8, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {t.actionLabel}
                  </span>
                ) : undefined
              }
              sx={{
                width: '100%',
                borderRadius: 12,
                '& .MuiAlert-icon': { fontSize: 22 },
              }}
            >
              {t.message}
            </Alert>
          </Box>
        ))}
      </Box>
    </WorkerToastContext.Provider>
  );
}

export function useWorkerToast(): WorkerToastContextValue {
  const ctx = useContext(WorkerToastContext);
  if (!ctx) {
    return {
      showToast: () => {},
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
    };
  }
  return ctx;
}
