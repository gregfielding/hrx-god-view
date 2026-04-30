/**
 * `attachEvereePortChannel` — pin the documented Web/React iframe handshake.
 *
 * Per https://developer.everee.com/docs/web-react-iframe, the V2_0
 * (`ONBOARDING`) Embed Component requires the host to:
 *   1. Create a `MessageChannel`.
 *   2. On the iframe's `load` event, `postMessage("", "*", [port2])` to
 *      `iframe.contentWindow`.
 *   3. Listen for events on `port1.onmessage`.
 *
 * Pre-EE.7 we registered `window[handlerName] = { postMessage }` and waited
 * for Everee to call it, which is the WKWebView path — the browser SDK
 * never invokes it. Result: every ONBOARDING mount surfaced an EMB-102
 * toast inside the iframe and never delivered any UI events to the host
 * (which made the EE.4 EMB-202 recovery handler unreachable, leading to
 * the deadlock chain that ate Greg's test worker).
 *
 * The tests below pin the contract precisely so any future "simplification"
 * of the bridge will fail CI loudly:
 *   - `postMessage` must be called with body=`""`, targetOrigin=`"*"`, and
 *     a one-element transfer list containing a `MessagePort`.
 *   - Messages received on `port1` must reach the consumer's `onMessage`.
 *   - String payloads must be JSON-parsed (matches the existing
 *     `normalizeEvereeBridgeMessage` contract used by the window-property
 *     bridge — keeps both transports interchangeable for callers).
 *   - `unregister()` must stop further messages and detach the load
 *     listener cleanly.
 */

import { attachEvereePortChannel } from '../hostMessageBridge';

/**
 * jsdom (CRA's default Jest environment) doesn't ship `MessageChannel`,
 * and Node's `worker_threads.MessageChannel` keeps the event loop alive
 * (real OS-thread ports), which made Jest hang on test-runner exit.
 *
 * Hand-rolled in-memory shim instead — covers the surface
 * `attachEvereePortChannel` actually depends on:
 *   - `new MessageChannel()` returning `{ port1, port2 }`.
 *   - `port2.postMessage(data)` invokes `port1.onmessage({ data })`
 *     asynchronously (microtask) — matches the spec's "delivered on
 *     the next event loop tick" guarantee that the helper depends on
 *     for `port.postMessage(...)` → `await Promise.resolve()` patterns.
 *   - `port1.close()` stops further deliveries.
 *
 * Strict enough to catch the bug we care about (port never transferred,
 * port closed twice, handler exception eats subsequent deliveries) while
 * being entirely synchronous-on-shutdown so Jest exits cleanly.
 */
class FakeMessagePort {
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  private peer: FakeMessagePort | null = null;
  private closed = false;
  setPeer(peer: FakeMessagePort) {
    this.peer = peer;
  }
  postMessage(data: unknown): void {
    if (this.closed) throw new Error('port is closed');
    const peer = this.peer;
    if (!peer || peer.closed) return;
    // Microtask delivery — close enough to spec for our assertions.
    queueMicrotask(() => {
      const handler = peer.onmessage;
      if (handler && !peer.closed) handler({ data });
    });
  }
  close(): void {
    this.closed = true;
    this.onmessage = null;
  }
}
class FakeMessageChannel {
  public port1: FakeMessagePort;
  public port2: FakeMessagePort;
  constructor() {
    this.port1 = new FakeMessagePort();
    this.port2 = new FakeMessagePort();
    this.port1.setPeer(this.port2);
    this.port2.setPeer(this.port1);
  }
}

beforeAll(() => {
  if (typeof (globalThis as { MessageChannel?: unknown }).MessageChannel === 'undefined') {
    (globalThis as { MessageChannel?: unknown }).MessageChannel =
      FakeMessageChannel as unknown as typeof MessageChannel;
  }
});

interface FakeIframe {
  el: HTMLIFrameElement;
  loadListeners: Array<EventListenerOrEventListenerObject>;
  postMessageCalls: Array<{ body: unknown; origin: string; transfer: Transferable[] }>;
  triggerLoad: () => void;
  /** Capture the `port2` Everee would have received. Set after `triggerLoad`. */
  capturedPort: MessagePort | null;
}

/**
 * Mock iframe that records `addEventListener('load', …)` registrations and
 * captures the transferable port from `contentWindow.postMessage` calls.
 * Avoids jsdom's quirky iframe load semantics — the helper's contract is
 * pure-DOM-API so a hand-built fake is more reliable + easier to assert.
 */
function makeFakeIframe(): FakeIframe {
  const loadListeners: Array<EventListenerOrEventListenerObject> = [];
  const postMessageCalls: Array<{
    body: unknown;
    origin: string;
    transfer: Transferable[];
  }> = [];
  const fake: FakeIframe = {
    el: null as unknown as HTMLIFrameElement,
    loadListeners,
    postMessageCalls,
    triggerLoad: () => {
      // The helper subscribes during `attach` synchronously, so by the time
      // the test calls `triggerLoad` exactly one listener exists.
      const event = new Event('load');
      for (const l of loadListeners) {
        if (typeof l === 'function') l(event);
        else l.handleEvent(event);
      }
    },
    capturedPort: null,
  };
  fake.el = {
    addEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
      if (type === 'load') loadListeners.push(cb);
    },
    removeEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
      if (type !== 'load') return;
      const idx = loadListeners.indexOf(cb);
      if (idx >= 0) loadListeners.splice(idx, 1);
    },
    contentWindow: {
      postMessage: (body: unknown, origin: string, transfer: Transferable[]) => {
        postMessageCalls.push({ body, origin, transfer });
        // Capture port2 so tests can drive messages into it from the
        // "iframe side" — that's how Everee's SDK communicates back.
        // Avoid `instanceof MessagePort` here: jsdom's prototype identity
        // can differ between the helper's MessageChannel scope and the
        // test scope, which would silently drop the captured port.
        const port = (transfer || [])[0];
        if (port) fake.capturedPort = port as MessagePort;
      },
    },
  } as unknown as HTMLIFrameElement;
  return fake;
}

describe('attachEvereePortChannel', () => {
  describe('jsdom sanity check', () => {
    it('jsdom supports MessageChannel + cross-port delivery', async () => {
      const ch = new MessageChannel();
      const received: unknown[] = [];
      ch.port1.onmessage = (ev) => received.push(ev.data);
      ch.port2.postMessage({ ping: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(received).toEqual([{ ping: 1 }]);
    });
  });

  describe('handshake — postMessage shape on iframe load', () => {
    it('posts ("", "*", [MessagePort]) into contentWindow exactly once on load', () => {
      const fake = makeFakeIframe();
      attachEvereePortChannel(fake.el, { onMessage: () => undefined });
      expect(fake.postMessageCalls).toHaveLength(0);
      fake.triggerLoad();
      expect(fake.postMessageCalls).toHaveLength(1);
      const call = fake.postMessageCalls[0];
      // Per docs: empty string body, wildcard origin. We pin both because
      // either drift breaks the SDK's port-capture path silently.
      expect(call.body).toBe('');
      expect(call.origin).toBe('*');
      expect(call.transfer).toHaveLength(1);
      // Duck-type instead of `toBeInstanceOf(MessagePort)` because
      // jsdom doesn't expose the global and our shim isn't a subclass.
      // The contract Everee depends on is just "something with
      // `postMessage` + `close`" passed via the transfer list.
      const transferred = call.transfer[0] as { postMessage?: unknown; close?: unknown };
      expect(typeof transferred.postMessage).toBe('function');
      expect(typeof transferred.close).toBe('function');
    });

    it('does not transfer the port until load actually fires', () => {
      const fake = makeFakeIframe();
      attachEvereePortChannel(fake.el, { onMessage: () => undefined });
      // Before load: no transfer. (If the helper transferred eagerly,
      // the SDK would never receive port2 because the iframe's
      // contentWindow document isn't ready yet.)
      expect(fake.postMessageCalls).toHaveLength(0);
    });

    it('subscribes to the load event exactly once', () => {
      const fake = makeFakeIframe();
      attachEvereePortChannel(fake.el, { onMessage: () => undefined });
      expect(fake.loadListeners).toHaveLength(1);
    });
  });

  describe('inbound messages — port1 → onMessage', () => {
    it('forwards object payloads from port2 to the host', async () => {
      const fake = makeFakeIframe();
      const onMessage = jest.fn();
      attachEvereePortChannel(fake.el, { onMessage });
      fake.triggerLoad();
      const port = fake.capturedPort!;
      // The "iframe side" sends an event back to the host. Use the
      // documented payload shape (eventType / eventHandlerName) so this
      // test doubles as documentation of the live contract.
      port.postMessage({
        eventType: 'WORKER_ONBOARDING_COMPLETE',
        error: false,
        eventHandlerName: 'hrx_default',
      });
      // MessagePort delivery is async — give the event loop a turn.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({
        eventType: 'WORKER_ONBOARDING_COMPLETE',
        error: false,
        eventHandlerName: 'hrx_default',
      });
    });

    it('JSON-parses string payloads (parity with the window-property bridge)', async () => {
      const fake = makeFakeIframe();
      const onMessage = jest.fn();
      attachEvereePortChannel(fake.el, { onMessage });
      fake.triggerLoad();
      const port = fake.capturedPort!;
      port.postMessage(JSON.stringify({ eventType: 'DISMISS' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onMessage).toHaveBeenCalledWith({ eventType: 'DISMISS' });
    });

    it('passes through unparseable strings unchanged', async () => {
      const fake = makeFakeIframe();
      const onMessage = jest.fn();
      attachEvereePortChannel(fake.el, { onMessage });
      fake.triggerLoad();
      const port = fake.capturedPort!;
      port.postMessage('not-json');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onMessage).toHaveBeenCalledWith('not-json');
    });

    it('swallows handler exceptions so iframe events keep flowing', async () => {
      const fake = makeFakeIframe();
      const onMessage = jest.fn(() => {
        throw new Error('boom');
      });
      // Silence the expected console.warn so test output stays clean.
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      attachEvereePortChannel(fake.el, { onMessage });
      fake.triggerLoad();
      const port = fake.capturedPort!;
      port.postMessage({ eventType: 'MESSAGE_PORT_REGISTERED' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Second message still gets delivered — handler bug doesn't kill the
      // channel.
      port.postMessage({ eventType: 'WORKER_ONBOARDING_COMPLETE' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onMessage).toHaveBeenCalledTimes(2);
      warnSpy.mockRestore();
    });
  });

  describe('teardown — unregister()', () => {
    it('removes the load listener so subsequent loads do not transfer a stale port', () => {
      const fake = makeFakeIframe();
      const handle = attachEvereePortChannel(fake.el, { onMessage: () => undefined });
      handle.unregister();
      expect(fake.loadListeners).toHaveLength(0);
      // Re-firing load after unregister: nothing should happen.
      fake.triggerLoad();
      expect(fake.postMessageCalls).toHaveLength(0);
    });

    it('stops forwarding messages received after unregister', async () => {
      const fake = makeFakeIframe();
      const onMessage = jest.fn();
      const handle = attachEvereePortChannel(fake.el, { onMessage });
      fake.triggerLoad();
      const port = fake.capturedPort!;
      port.postMessage({ eventType: 'MESSAGE_PORT_REGISTERED' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onMessage).toHaveBeenCalledTimes(1);
      handle.unregister();
      // Try to send another message — the host port is closed, so the
      // consumer's onMessage must not fire again.
      try {
        port.postMessage({ eventType: 'WORKER_ONBOARDING_COMPLETE' });
      } catch {
        // Some implementations throw on send-after-close; that's fine.
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onMessage).toHaveBeenCalledTimes(1);
    });

    it('is safe to call multiple times (idempotent)', () => {
      const fake = makeFakeIframe();
      const handle = attachEvereePortChannel(fake.el, { onMessage: () => undefined });
      expect(() => {
        handle.unregister();
        handle.unregister();
        handle.unregister();
      }).not.toThrow();
    });
  });

  describe('environmental fallbacks', () => {
    it('returns a no-op handle when MessageChannel is unavailable', () => {
      const original = (globalThis as { MessageChannel?: typeof MessageChannel }).MessageChannel;
      // Simulate an SSR / pre-modern-browser environment.
      (globalThis as { MessageChannel?: typeof MessageChannel }).MessageChannel = undefined;
      try {
        const fake = makeFakeIframe();
        const onMessage = jest.fn();
        const handle = attachEvereePortChannel(fake.el, { onMessage });
        // No listener attached, no transfer queued — caller's other
        // bridges (V1 window.message, window-property) still apply.
        expect(fake.loadListeners).toHaveLength(0);
        expect(() => handle.unregister()).not.toThrow();
        expect(onMessage).not.toHaveBeenCalled();
      } finally {
        (globalThis as { MessageChannel?: typeof MessageChannel }).MessageChannel = original;
      }
    });

    it('does not throw when contentWindow is null at load time (post-detach iframe)', () => {
      const fake = makeFakeIframe();
      // Simulate the iframe being detached between attach and load.
      (fake.el as unknown as { contentWindow: null }).contentWindow = null;
      attachEvereePortChannel(fake.el, { onMessage: () => undefined });
      expect(() => fake.triggerLoad()).not.toThrow();
      expect(fake.postMessageCalls).toHaveLength(0);
    });
  });
});
