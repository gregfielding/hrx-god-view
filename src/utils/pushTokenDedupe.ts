/**
 * One web push registration per browser across our hostnames.
 *
 * FCM web tokens are bound to the page's origin (service worker scope), so a
 * browser that allows notifications on both hrxone.com and app.c1staffing.com
 * holds two live tokens and receives every push twice. When a browser
 * registers on one origin, its registrations from OTHER origins are disabled
 * (`enabled: false` — every server sender filters on enabled == true). If the
 * worker goes back to the other host, that registration re-enables itself on
 * load and this one gets superseded in turn: the most recently used host wins.
 *
 * "Same browser" = identical full user agent (or, for tokens saved before the
 * userAgent field existed, the same 80-char `deviceId`). Two different devices
 * with identical user agents only collide if the same worker uses one of them
 * on each host — rare, and the loser re-enables on its next visit.
 */

export interface WebPushTokenDoc {
  id: string;
  platform?: string;
  enabled?: boolean;
  origin?: string;
  userAgent?: string;
  deviceId?: string;
}

/** Tokens saved before 2026-09-11 carry no origin; they all came from hrxone.com. */
export const LEGACY_WEB_PUSH_ORIGIN = 'https://hrxone.com';

export function webPushDeviceId(userAgent: string): string {
  return 'web-' + (userAgent?.slice(0, 80) ?? 'unknown');
}

/** Ids of this browser's enabled web tokens registered on other origins. */
export function findSupersededWebTokens(
  docs: readonly WebPushTokenDoc[],
  current: { token: string; origin: string; userAgent: string },
): string[] {
  return docs
    .filter((d) => d.id !== current.token)
    .filter((d) => (d.platform ?? 'web') === 'web' && d.enabled !== false)
    .filter((d) =>
      d.userAgent ? d.userAgent === current.userAgent : d.deviceId === webPushDeviceId(current.userAgent),
    )
    .filter((d) => (d.origin || LEGACY_WEB_PUSH_ORIGIN) !== current.origin)
    .map((d) => d.id);
}
