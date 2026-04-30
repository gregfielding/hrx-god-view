/**
 * EvereePayrollSetupEmbed — worker-facing "Complete payroll setup" panel.
 *
 * Architecture (HRX Everee Master Plan §6, Everee Embed SDK):
 *
 *   Web  ────────────────────────────────────────────────────────────
 *   1. On open: call `evereeEnsureWorker` (idempotent) → evereeWorkerId.
 *   2. Immediately call `evereeCreateOnboardingSession` for a fresh,
 *      one-time-use `embedUrl`. Sessions are short-lived so we MUST NOT
 *      cache across opens.
 *   3. Mount <iframe src={embedUrl}>.
 *   4. Listen for Everee's `MESSAGE_PORT_REGISTERED` via `window.addEventListener('message')`.
 *      Everee transfers a MessagePort; we keep a handle on `portRef` and
 *      listen for subsequent events (`WORKER_ONBOARDING_COMPLETE`,
 *      `DISMISS`) on that port.
 *   5. On `WORKER_ONBOARDING_COMPLETE`: optimistically update UI +
 *      `onComplete()` so the parent can refresh; the authoritative
 *      update lands via the Everee webhook (`evereeWebhook.ts`) which
 *      flips `everee_workers.status` → `onboarding_complete` and mirrors
 *      onto `user_employments` / `onboarding_instances`.
 *   6. On `DISMISS`: close dialog; no state change.
 *
 *   Flutter parity — `lib/features/employment/presentation/widgets/
 *   everee_payroll_setup_sheet.dart` uses webview_flutter + a
 *   JavaScriptChannel keyed off the same `EVEREE_CHANNEL_NAME` so the
 *   embed emits the same event envelope regardless of container.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import {
  evereeCreateOnboardingSession,
  evereeEnsureWorker,
  type EvereeWorkerType,
} from '../../services/everee/evereeCallables';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';
import {
  attachEvereePortChannel,
  EVEREE_DEFAULT_HOST_HANDLER_NAME,
  registerEvereeHostBridge,
} from '../../utils/everee/hostMessageBridge';

/** Same channel name used on the Flutter side — keeps event shape identical. */
export const EVEREE_CHANNEL_NAME = 'evereeEmbed';

/** Events emitted by Everee Embed SDK. Only the three listed are wired today. */
type EvereeEmbedEventType =
  | 'MESSAGE_PORT_REGISTERED'
  | 'WORKER_ONBOARDING_COMPLETE'
  | 'DISMISS'
  | string;

interface EvereeEmbedEvent {
  type: EvereeEmbedEventType;
  /** Free-form payload passed through from Everee; shape depends on event type. */
  payload?: Record<string, unknown> | null;
}

export interface EvereePayrollSetupEmbedProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  entityId: string;
  userId: string;
  workerType?: EvereeWorkerType;
  /** Optional prefill for worker creation when Everee worker doesn't exist yet. */
  prefill?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  };
  /**
   * Called on `WORKER_ONBOARDING_COMPLETE`. Parent should refresh employment
   * overview here; Firestore will catch up via webhook within ~seconds.
   */
  onComplete?: () => void;
  /** Optional — custom post-embed return URL passed to Everee. */
  returnUrl?: string;
  /** Accessibility / copy override. Defaults to "Complete payroll setup". */
  title?: string;
}

type Phase =
  | { state: 'idle' }
  | { state: 'creating' }
  | {
      state: 'ready';
      embedUrl: string;
      sessionId: string;
      /** Bridge name registered on `window` for V2_0 embeds — defaults to `hrx_default`. */
      eventHandlerName: string;
    }
  | { state: 'completing' }
  | { state: 'error'; message: string };

const EvereePayrollSetupEmbed: React.FC<EvereePayrollSetupEmbedProps> = ({
  open,
  onClose,
  tenantId,
  entityId,
  userId,
  workerType,
  prefill,
  onComplete,
  returnUrl,
  title = 'Complete payroll setup',
}) => {
  const [phase, setPhase] = useState<Phase>({ state: 'idle' });
  const portRef = useRef<MessagePort | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  /**
   * Detach the MessagePort cleanly — otherwise the old port keeps firing
   * into the parent on subsequent opens (ports are reset on each session).
   */
  const teardownPort = useCallback(() => {
    const p = portRef.current;
    if (p) {
      try {
        p.onmessage = null;
        p.close();
      } catch {
        /* no-op — port already closed */
      }
    }
    portRef.current = null;
  }, []);

  /** Parse a single event envelope. Tolerant of string, {type}, {data:{type}}. */
  const parseEvereeEvent = useCallback((data: unknown): EvereeEmbedEvent | null => {
    if (!data) return null;
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data) as unknown;
        return parseEvereeEvent(parsed);
      } catch {
        return null;
      }
    }
    if (typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    // EE.7 — Everee's documented event payload uses `eventType` as the
    // discriminator (https://developer.everee.com/docs/handling-events).
    // The legacy `type` alias is kept because some SDK versions / V1_0
    // embeds emit envelopes shaped that way, and our pre-EE.7 path
    // depended on it. Read both, prefer `eventType` when present.
    const rawType =
      typeof d.eventType === 'string'
        ? d.eventType
        : typeof d.type === 'string'
          ? d.type
          : null;
    if (rawType) return { type: rawType, payload: (d.payload ?? null) as Record<string, unknown> | null };
    // Some SDK versions nest the envelope under `data`.
    const inner = d.data;
    if (inner && typeof inner === 'object') {
      const innerObj = inner as Record<string, unknown>;
      const innerType =
        typeof innerObj.eventType === 'string'
          ? innerObj.eventType
          : typeof innerObj.type === 'string'
            ? innerObj.type
            : null;
      if (innerType) {
        return {
          type: innerType,
          payload: (innerObj.payload ?? null) as Record<string, unknown> | null,
        };
      }
    }
    return null;
  }, []);

  const handleEvereeEvent = useCallback(
    (evt: EvereeEmbedEvent) => {
      switch (evt.type) {
        case 'WORKER_ONBOARDING_COMPLETE':
          setPhase({ state: 'completing' });
          // Optimistic callback — webhook will settle authoritative state.
          try {
            onComplete?.();
          } catch {
            /* no-op — parent callback mustn't break the UX */
          }
          // Close after a short beat so the worker sees the completion state in Everee.
          window.setTimeout(() => {
            teardownPort();
            onClose();
          }, 800);
          return;
        case 'DISMISS':
          teardownPort();
          onClose();
          return;
        default:
          // Forward-compat: unknown event types are ignored deliberately.
          return;
      }
    },
    [onClose, onComplete, teardownPort],
  );

  /**
   * Root window.message listener. Two responsibilities:
   *  1. Receive the initial `MESSAGE_PORT_REGISTERED` envelope and capture
   *     the transferred port.
   *  2. On some SDK versions, events arrive as plain postMessage (no port
   *     transfer). We dispatch those directly too.
   */
  useEffect(() => {
    if (!open) return;

    const onMessage = (event: MessageEvent) => {
      // Iframe src origin is whatever Everee returned; we accept only when
      // the message arrives from our mounted iframe's contentWindow.
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;

      const parsed = parseEvereeEvent(event.data);
      if (!parsed) return;

      if (parsed.type === 'MESSAGE_PORT_REGISTERED') {
        const port = event.ports?.[0] ?? null;
        if (port) {
          teardownPort();
          portRef.current = port;
          port.onmessage = (portEvent: MessageEvent) => {
            const childEvt = parseEvereeEvent(portEvent.data);
            if (childEvt) handleEvereeEvent(childEvt);
          };
          try {
            port.start();
          } catch {
            /* `start()` is a no-op on already-started ports */
          }
        }
        return;
      }

      // Fallback: SDK emitted event on the window bus directly.
      handleEvereeEvent(parsed);
    };

    window.addEventListener('message', onMessage);

    // V2_0 (`ONBOARDING`) embeds deliver events through `window[handlerName]`
    // (not via parent.postMessage). Register the host bridge with whatever
    // name the server told us was sent on the session — falls back to the
    // stable `hrx_default`. Without this, V2 embeds render an EMB-102 toast.
    const bridgeHandlerName =
      phase.state === 'ready' ? phase.eventHandlerName : EVEREE_DEFAULT_HOST_HANDLER_NAME;
    const bridge = registerEvereeHostBridge({
      handlerName: bridgeHandlerName,
      onMessage: (msg) => {
        const evt = parseEvereeEvent(msg);
        if (evt) handleEvereeEvent(evt);
      },
    });

    // EE.7 — the documented Web/React iframe transport
    // (https://developer.everee.com/docs/web-react-iframe). Pre-EE.7 we
    // only registered the `window[handlerName]` bridge above, which the V2
    // SDK in browsers doesn't actually probe for (that's the WKWebView
    // path). The result was an EMB-102 toast on every ONBOARDING mount.
    // Additive: V1_0 port-transfer via `parent.postMessage` is still
    // captured by the `MESSAGE_PORT_REGISTERED` branch in `onMessage`
    // above, and the window-property bridge stays as a defensive
    // fallback for non-browser hosts.
    const portChannel =
      phase.state === 'ready' && iframeRef.current
        ? attachEvereePortChannel(iframeRef.current, {
            onMessage: (msg) => {
              const evt = parseEvereeEvent(msg);
              if (evt) handleEvereeEvent(evt);
            },
          })
        : null;

    return () => {
      window.removeEventListener('message', onMessage);
      bridge.unregister();
      portChannel?.unregister();
    };
  }, [open, parseEvereeEvent, handleEvereeEvent, teardownPort, phase]);

  /**
   * On open: ensure Everee worker exists, then create a fresh ephemeral
   * embed session. Sessions are one-time-use, so we always create a new one
   * on every open — never cache across mounts.
   */
  useEffect(() => {
    if (!open) {
      // Reset on close so next open starts clean.
      teardownPort();
      setPhase({ state: 'idle' });
      return;
    }
    let cancelled = false;

    async function launch() {
      if (!tenantId || !entityId || !userId) {
        setPhase({ state: 'error', message: 'Missing tenantId/entityId/userId.' });
        return;
      }
      setPhase({ state: 'creating' });
      try {
        const ensured = await evereeEnsureWorker({
          tenantId,
          entityId,
          userId,
          workerType,
          email: prefill?.email,
          firstName: prefill?.firstName,
          lastName: prefill?.lastName,
          phone: prefill?.phone,
        });
        if (cancelled) return;
        const evereeWorkerId = ensured.data?.evereeWorkerId?.trim();
        if (!evereeWorkerId) {
          setPhase({
            state: 'error',
            message: 'Could not provision Everee worker record.',
          });
          return;
        }
        const session = await evereeCreateOnboardingSession({
          tenantId,
          entityId,
          userId,
          evereeWorkerId,
          returnUrl,
        });
        if (cancelled) return;
        const embedUrl = session.data?.embedUrl?.trim();
        const sessionId = session.data?.sessionId?.trim() || '';
        if (!embedUrl) {
          setPhase({ state: 'error', message: 'Everee did not return an embed URL.' });
          return;
        }
        const handlerNameFromServer =
          typeof session.data?.eventHandlerName === 'string' &&
          session.data.eventHandlerName.trim()
            ? session.data.eventHandlerName.trim()
            : EVEREE_DEFAULT_HOST_HANDLER_NAME;
        setPhase({
          state: 'ready',
          embedUrl,
          sessionId,
          eventHandlerName: handlerNameFromServer,
        });
      } catch (e: unknown) {
        if (cancelled) return;
        setPhase({
          state: 'error',
          message: formatFirebaseHttpsError(e) || 'Could not start payroll setup.',
        });
      }
    }

    void launch();

    return () => {
      cancelled = true;
    };
  }, [open, tenantId, entityId, userId, workerType, prefill?.email, prefill?.firstName, prefill?.lastName, prefill?.phone, returnUrl, teardownPort]);

  const handleClose = useCallback(() => {
    teardownPort();
    onClose();
  }, [onClose, teardownPort]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="everee-payroll-setup-title"
      PaperProps={{ sx: { height: { xs: '100%', sm: '85vh' } } }}
    >
      <DialogTitle
        id="everee-payroll-setup-title"
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}
      >
        <Typography component="span" variant="h6" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <IconButton aria-label="close" onClick={handleClose} edge="end">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
        {phase.state === 'creating' ? (
          <Stack
            alignItems="center"
            justifyContent="center"
            spacing={1.5}
            sx={{ flex: 1, p: 4 }}
          >
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">
              Starting your payroll setup session…
            </Typography>
          </Stack>
        ) : null}

        {phase.state === 'error' ? (
          <Box sx={{ p: 3 }}>
            <Alert severity="error" sx={{ mb: 2 }}>
              {phase.message}
            </Alert>
            <Button variant="outlined" onClick={handleClose}>
              Close
            </Button>
          </Box>
        ) : null}

        {phase.state === 'ready' || phase.state === 'completing' ? (
          <Box
            sx={{
              flex: 1,
              position: 'relative',
              minHeight: 520,
              bgcolor: 'background.default',
            }}
          >
            {phase.state === 'completing' ? (
              <Stack
                alignItems="center"
                justifyContent="center"
                spacing={1}
                sx={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 2,
                  bgcolor: 'rgba(255,255,255,0.92)',
                }}
              >
                <CircularProgress size={24} />
                <Typography variant="body2" color="text.secondary">
                  Finishing up…
                </Typography>
              </Stack>
            ) : null}
            <iframe
              ref={iframeRef}
              title="Everee payroll setup"
              src={phase.state === 'ready' ? phase.embedUrl : undefined}
              allow="clipboard-read; clipboard-write; camera; microphone; fullscreen"
              style={{
                border: 0,
                width: '100%',
                height: '100%',
                minHeight: 520,
                display: 'block',
              }}
            />
          </Box>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

export default EvereePayrollSetupEmbed;
