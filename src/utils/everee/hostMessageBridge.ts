/**
 * Everee Embedded SDK V2_0 — host-side message bridge.
 *
 * Why this file exists
 * --------------------
 * Everee's V2 embed (`EmbeddedRouter` / `routing-*.js`) tries to send the
 * initial `MESSAGE_PORT_REGISTERED` envelope (and every subsequent UI event)
 * to the host using THREE transports, in order, with the configured
 * `eventHandlerName` (default `hrx_default`):
 *
 *   1. **lib window property** — `window[eventHandlerName].postMessage(payload)`
 *      (the same iOS-style "JS bridge object" convention).
 *   2. **`window.webkit.messageHandlers[eventHandlerName].postMessage(payload)`**
 *      — iOS WKWebView native bridge. n/a in browsers.
 *   3. **host MessagePort** — a `MessagePort` the host transferred to the iframe
 *      *before* the SDK boots.
 *
 * V1_0 embeds (`WORKER_HOME` etc.) used `parent.postMessage(envelope, origin, [port])`
 * directly, which is what our `'message'` listeners catch. V2_0 (`ONBOARDING`)
 * does NOT do that — it requires (1) or (3). When all three transports fail,
 * the embed renders an `EMB-102` toast ("No event handler has been registered
 * with the embedded experience") and never dispatches any UI events, so the
 * iframe is stuck on its boot spinner.
 *
 * This module exposes the lib-window-property bridge for any host surface
 * that mounts an Everee embed.
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
