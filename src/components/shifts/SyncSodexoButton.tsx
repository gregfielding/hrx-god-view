/**
 * SyncSodexoButton — one-click Fieldglass order sync from inside HRX
 * (top-right of the Job Orders page).
 *
 * The web app cannot read Fieldglass itself (cross-origin), so the click
 * is relayed to the HRX Fieldglass Sync Chrome extension via a
 * window.postMessage bridge (the extension injects
 * browser-extensions/fieldglass-sync/hrx-bridge.js into HRX pages). The
 * extension then: pulls HRX's pending-order queue, opens/reuses the
 * recruiter's logged-in Fieldglass tab, scans the worklist for order
 * links, and bulk-syncs the merged set — details, site, and child
 * account per order, everything short of a job order.
 *
 * With the extension missing, the button still renders and the click
 * explains how to install it (one-time, per recruiter).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tooltip,
  Typography,
} from '@mui/material';
import { SyncOutlined } from '@mui/icons-material';

interface BridgeProgress {
  running?: boolean;
  total?: number;
  done?: number;
  summary?: { ok: number; failed: number; competitorFlags?: number };
}

interface BridgeMessage {
  __hrxFgSync?: boolean;
  type?: string;
  started?: boolean;
  count?: number;
  reason?: string;
  progress?: BridgeProgress;
}

const SyncSodexoButton: React.FC = () => {
  const [extensionReady, setExtensionReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  /** Clears the transient status line a while after a run finishes. */
  const clearTimer = useRef<number | null>(null);

  const post = useCallback((data: Record<string, unknown>) => {
    window.postMessage({ __hrxFgSync: true, ...data }, window.location.origin);
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent<BridgeMessage>): void => {
      if (e.source !== window || !e.data || e.data.__hrxFgSync !== true) return;
      switch (e.data.type) {
        case 'HRX_FG_SYNC_READY':
          setExtensionReady(true);
          break;
        case 'HRX_FG_SYNC_ACK':
          if (e.data.started) {
            setStatusText(`Syncing ${e.data.count} order(s)…`);
          } else {
            setRunning(false);
            setStatusText(e.data.reason ?? 'Nothing to sync.');
          }
          break;
        case 'HRX_FG_SYNC_PROGRESS': {
          const p = e.data.progress;
          if (!p) break;
          if (p.running) {
            setRunning(true);
            setStatusText(`Syncing ${p.done ?? 0} / ${p.total ?? '?'}…`);
          } else {
            setRunning(false);
            if (p.summary) {
              const s = p.summary;
              setStatusText(
                `Done — ${s.ok} synced, ${s.failed} failed` +
                  (s.competitorFlags ? `, ${s.competitorFlags} candidate-in-mind` : ''),
              );
              if (clearTimer.current) window.clearTimeout(clearTimer.current);
              clearTimer.current = window.setTimeout(() => setStatusText(null), 30000);
            }
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('message', onMessage);
    // Probe — the bridge announces on load, but this component may mount
    // later (SPA navigation).
    post({ type: 'HRX_FG_SYNC_PING' });
    return () => {
      window.removeEventListener('message', onMessage);
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
    };
  }, [post]);

  const handleClick = (): void => {
    if (!extensionReady) {
      setInstallOpen(true);
      return;
    }
    setRunning(true);
    setStatusText('Starting…');
    post({ type: 'HRX_FG_SYNC_START' });
  };

  return (
    <>
      <Tooltip
        title={
          extensionReady
            ? 'Pull every open Sodexo order from Fieldglass — details, site, and account. No job orders are created.'
            : 'Requires the HRX Fieldglass Sync browser extension'
        }
      >
        <span>
          <Button
            variant="outlined"
            size="small"
            startIcon={running ? <CircularProgress size={14} /> : <SyncOutlined />}
            onClick={handleClick}
            disabled={running}
            sx={{ height: 36, whiteSpace: 'nowrap' }}
          >
            Sync Sodexo
          </Button>
        </span>
      </Tooltip>
      {statusText && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1, whiteSpace: 'nowrap' }}>
          {statusText}
        </Typography>
      )}

      <Dialog open={installOpen} onClose={() => setInstallOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Install the Fieldglass sync extension</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            Sync Sodexo works through a small Chrome extension that reads Fieldglass with your
            logged-in session (HRX can&apos;t reach Fieldglass directly). One-time setup:
          </Typography>
          <Typography variant="body2" component="ol" sx={{ pl: 2.5, '& li': { mb: 0.75 } }}>
            <li>
              Chrome → <code>chrome://extensions</code> → enable <strong>Developer mode</strong>.
            </li>
            <li>
              <strong>Load unpacked</strong> → select the repo folder{' '}
              <code>browser-extensions/fieldglass-sync</code>.
            </li>
            <li>Extension options → paste the HRX extension key (ask your admin).</li>
            <li>Reload this page — the button lights up.</li>
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInstallOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default SyncSodexoButton;
