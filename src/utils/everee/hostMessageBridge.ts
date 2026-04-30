/**
 * Everee Embedded SDK — host-side message bridges.
 *
 * Two transports live here, both required to cover Everee's full Embed
 * Component matrix:
 *
 *   1. **`attachEvereePortChannel`** — the documented Web/React iframe
 *      handshake (https://developer.everee.com/docs/web-react-iframe).
 *      Host creates a `MessageChannel`, transfers `port2` into the iframe
 *      on its `load` event, and listens on `port1` for events. This is the
 *      transport V2_0 (`ONBOARDING`) embeds use in browsers — without it
 *      they render the EMB-102 ("No event handler has been registered")
 *      toast and never dispatch any UI events.
 *
 *   2. **`registerEvereeHostBridge`** — the iOS-style `window[handlerName]`
 *      convention. Used by V2_0 embeds inside WKWebView (and as a defensive
 *      fallback in browsers, since the SDK probes for it before falling
 *      back to the MessagePort path).
 *
 * V1_0 embeds (`WORKER_HOME` etc.) deliver events via
 * `parent.postMessage(envelope, origin, [port])` — caught by callers'
 * `window.addEventListener('message')` listeners. Neither helper here is
 * involved in V1_0; they're additive.
 *
 * History note: pre-EE.7 we believed the V2 SDK in browsers used the
 * window-property transport (transport (1) above). It does not — that's
 * the WKWebView path. The browser path is the documented `MessageChannel`
 * handshake. EE.7 added `attachEvereePortChannel` as the canonical
 * browser fix; the window-property bridge stays for the WKWebView /
 * Flutter `webview_flutter` mounts and as a defensive secondary.
 *
 * Single instance assumption
 * --------------------------
 * Worker-facing flows mount at most one Everee embed at a time, so the
 * "last registration wins" semantic is fine. If we ever need concurrent
 * embeds (e.g., recruiter previewing + worker completing in same tab) the
 * registry can grow into a multi-subscriber list — kept simple for now.
 */

const HOST_BRIDGE_GLOBAL_FLAG = '__hrx_everee_host_bridge_keys__';

/** Default handler name — must match `eventHandlerName` sent on session create. */
export const EVEREE_DEFAULT_HOST_HANDLER_NAME = 'hrx_default';

/**
 * Canonicalize an Everee origin string (typically the `origin` field on the
 * session-create response) so it can be `===`-compared against the
 * `event.origin` of `window.postMessage` events from the embedded iframe.
 *
 * Why this exists
 * ---------------
 * Everee's session-create API has been observed to return values like
 * `'https://app.everee.com/'` (with a trailing slash) for some tenants, while
 * the same tenant's iframe sends `event.origin === 'https://app.everee.com'`
 * (no slash, per RFC 6454 / HTML §7.2 — `MessageEvent.origin` is always a
 * serialized origin without trailing path). A naive `event.origin === apiOrigin`
 * comparison rejects every message → the embed sits at the loading spinner
 * because the host never acknowledges the iframe's `MESSAGE_PORT_REGISTERED`
 * handshake.
 *
 * Passing both sides through `URL(...).origin` makes them agree:
 *   - `'https://app.everee.com/'`           → `'https://app.everee.com'`
 *   - `'https://app.everee.com'`            → `'https://app.everee.com'`
 *   - `'https://app.everee.com/embedded'`   → `'https://app.everee.com'`
 *   - `'https://app.everee.com:443/'`       → `'https://app.everee.com'` (port stripped per spec)
 *
 * Returns the canonical origin string, or empty string if the input cannot be
 * parsed. Whitespace-only / null / undefined inputs return empty string.
 */
export function canonicalEvereeOrigin(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return '';
  }
}

/**
 * Loose envelope as it arrives from the SDK. The SDK sometimes stringifies and
 * sometimes hands us the parsed object — callers shouldn't care.
 */
export type EvereeBridgeRawMessage = unknown;

/**
 * Best-effort parse of the raw bridge payload into a normalized object envelope.
 * Returns the original value if it can't be parsed (so callers can still pattern-match).
 */
export function normalizeEvereeBridgeMessage(raw: EvereeBridgeRawMessage): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

export interface EvereeHostBridgeRegistration {
  /** The name actually registered (after sanitization). */
  handlerName: string;
  /** Tear down the bridge — safe to call multiple times. */
  unregister: () => void;
}

interface EvereeHostBridgeOptions {
  /** Defaults to `hrx_default`. Whitespace-only / empty values fall back to default. */
  handlerName?: string | null;
  /**
   * Called on every message the SDK pushes through. The first one is the
   * `MESSAGE_PORT_REGISTERED` handshake (from the SDK's perspective —
   * V2_0 happily proceeds without us actually registering a port back, as
   * long as it can deliver the envelope to *some* transport).
   */
  onMessage: (message: unknown) => void;
}

/**
 * Register `window[handlerName] = { postMessage: <forwarder> }` so Everee's
 * V2 embed can deliver UI events (and clear its EMB-102 toast). Returns a
 * disposer that restores any previously-registered handler on unmount.
 */
export function registerEvereeHostBridge(
  options: EvereeHostBridgeOptions,
): EvereeHostBridgeRegistration {
  const handlerName =
    options.handlerName && options.handlerName.trim()
      ? options.handlerName.trim()
      : EVEREE_DEFAULT_HOST_HANDLER_NAME;

  if (typeof window === 'undefined') {
    return { handlerName, unregister: () => undefined };
  }

  const w = window as unknown as Record<string, unknown> & {
    [HOST_BRIDGE_GLOBAL_FLAG]?: Set<string>;
  };
  if (!w[HOST_BRIDGE_GLOBAL_FLAG]) {
    w[HOST_BRIDGE_GLOBAL_FLAG] = new Set<string>();
  }
  const registry = w[HOST_BRIDGE_GLOBAL_FLAG] as Set<string>;
  const previous = w[handlerName];

  const bridge = {
    postMessage: (payload: EvereeBridgeRawMessage) => {
      try {
        options.onMessage(normalizeEvereeBridgeMessage(payload));
      } catch (err) {
        // Never let host-side handler bugs propagate back into the iframe —
        // Everee's SDK throws away exceptions silently anyway, but keep the
        // stack trace visible during dev for diagnostics.
        // eslint-disable-next-line no-console
        console.warn('[everee host bridge] handler threw', err);
      }
    },
  };

  w[handlerName] = bridge;
  registry.add(handlerName);

  let disposed = false;
  return {
    handlerName,
    unregister: () => {
      if (disposed) return;
      disposed = true;
      // Only revert if our bridge is still the current registration — another
      // surface may have registered over the top of us in the interim.
      if (w[handlerName] === bridge) {
        if (previous === undefined) {
          delete w[handlerName];
        } else {
          w[handlerName] = previous;
        }
        registry.delete(handlerName);
      }
    },
  };
}

export interface EvereePortChannelOptions {
  /**
   * Same payload-shape contract as `registerEvereeHostBridge.onMessage`.
   * Caller dispatches by inspecting `eventType` / `type` on the payload.
   * The raw `MessageEvent.data` is forwarded after `normalizeEvereeBridgeMessage`,
   * so string payloads are JSON-parsed when possible.
   */
  onMessage: (message: unknown) => void;
}

export interface EvereePortChannelHandle {
  /** Tear down the channel + listener — safe to call multiple times. */
  unregister: () => void;
}

/**
 * Attach the documented Web/React iframe host bridge to a mounted iframe.
 *
 * Per https://developer.everee.com/docs/web-react-iframe, the V2_0
 * (`ONBOARDING`) embed expects the host to:
 *   1. Create a `MessageChannel`.
 *   2. On the iframe's `load` event, transfer `port2` into the iframe via
 *      `iframe.contentWindow.postMessage("", "*", [channel.port2])`.
 *      The body is intentionally an empty string and the target origin is
 *      `"*"` per Everee's example — the SDK only reads the transferable
 *      list. We can't safely tighten the target origin because the iframe
 *      may redirect its document origin during the embed lifecycle.
 *   3. Listen on `port1.onmessage` for events from the embedded UX.
 *
 * Without this attachment Everee surfaces an `EMB-102` ("No event handler
 * has been registered") toast inside the iframe and never dispatches any
 * UI events back to the host — which (pre-EE.7) was the unrecoverable
 * deadlock at the heart of `EMB-202` and the worker-onboarding stuck
 * states. Recovery handlers in `WorkerPayrollEvereeTenant.tsx` (e.g. the
 * EMB-202 → ONBOARDING auto-swap) only fire when this bridge is in place.
 *
 * Failure modes
 * -------------
 * - Runs without `MessageChannel` (very old engines / SSR): returns a
 *   no-op handle. Other transports — V1's `window.message` and the
 *   `window[handlerName]` bridge — still apply.
 * - Iframe `load` already fired before attach: the listener still wins
 *   on the *next* `load` (e.g. session refresh). For the very first
 *   mount, attach during the same render cycle that mounts the iframe;
 *   React commits the ref before the browser fires `load` on the new
 *   element, so the order is reliable in practice.
 * - `contentWindow.postMessage` throws (cross-origin readiness, GC'd
 *   iframe): swallowed + warned. The iframe will re-render on the next
 *   session and we'll re-attach.
 */
export function attachEvereePortChannel(
  iframe: HTMLIFrameElement,
  options: EvereePortChannelOptions,
): EvereePortChannelHandle {
  if (typeof MessageChannel === 'undefined') {
    return { unregister: () => undefined };
  }

  const channel = new MessageChannel();
  let disposed = false;

  channel.port1.onmessage = (event: MessageEvent) => {
    if (disposed) return;
    try {
      options.onMessage(normalizeEvereeBridgeMessage(event.data));
    } catch (err) {
      // Same containment rationale as the window-property bridge — host
      // bugs must never propagate back into the iframe.
      // eslint-disable-next-line no-console
      console.warn('[everee port channel] handler threw', err);
    }
  };

  const onLoad = () => {
    if (disposed) return;
    const target = iframe.contentWindow;
    if (!target) return;
    try {
      // Empty body, wildcard origin, transfer list = [port2] — exactly
      // the shape Everee documents. The SDK installs port2 inside the
      // iframe and starts emitting events back through it.
      target.postMessage('', '*', [channel.port2]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[everee port channel] port transfer failed', err);
    }
  };

  iframe.addEventListener('load', onLoad);

  return {
    unregister: () => {
      if (disposed) return;
      disposed = true;
      try {
        iframe.removeEventListener('load', onLoad);
      } catch {
        // Iframe may already be detached — listener is gone with it.
      }
      try {
        channel.port1.onmessage = null;
        channel.port1.close();
      } catch {
        // Port may already be closed (e.g. iframe navigated cross-origin).
      }
    },
  };
}
