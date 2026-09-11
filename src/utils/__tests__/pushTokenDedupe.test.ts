import { findSupersededWebTokens, webPushDeviceId } from '../pushTokenDedupe';

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
const OTHER_UA = 'Mozilla/5.0 (Linux; Android 13; SM-G991U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Mobile Safari/537.36';
const current = { token: 'tok-new', origin: 'https://app.c1staffing.com', userAgent: UA };

describe('findSupersededWebTokens', () => {
  it('disables the same browser on the other origin', () => {
    expect(
      findSupersededWebTokens(
        [
          { id: 'tok-new', platform: 'web', enabled: true, origin: current.origin, userAgent: UA },
          { id: 'tok-old', platform: 'web', enabled: true, origin: 'https://hrxone.com', userAgent: UA },
        ],
        current,
      ),
    ).toEqual(['tok-old']);
  });

  it('treats legacy tokens (no origin/userAgent) as hrxone.com, matched by deviceId', () => {
    expect(
      findSupersededWebTokens([{ id: 'legacy', platform: 'web', enabled: true, deviceId: webPushDeviceId(UA) }], current),
    ).toEqual(['legacy']);
    // Registering on hrxone.com itself never disables legacy hrxone.com tokens.
    expect(
      findSupersededWebTokens([{ id: 'legacy', platform: 'web', enabled: true, deviceId: webPushDeviceId(UA) }], {
        ...current,
        origin: 'https://hrxone.com',
      }),
    ).toEqual([]);
  });

  it('keeps other browsers, other devices, native apps, same-origin and already-disabled tokens', () => {
    expect(
      findSupersededWebTokens(
        [
          { id: 'other-browser', platform: 'web', enabled: true, origin: 'https://hrxone.com', userAgent: OTHER_UA },
          { id: 'ios-app', platform: 'ios', enabled: true, deviceId: 'iphone' },
          { id: 'same-origin', platform: 'web', enabled: true, origin: current.origin, userAgent: UA },
          { id: 'disabled', platform: 'web', enabled: false, origin: 'https://hrxone.com', userAgent: UA },
        ],
        current,
      ),
    ).toEqual([]);
  });
});
