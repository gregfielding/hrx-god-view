import {
  DEFAULT_PLAY_STORE_URL,
  WORKER_APP_BANNER_OFF,
  detectAppBannerPlatform,
  isAppBannerPath,
  parseWorkerAppBannerConfig,
  resolveWorkerAppBanner,
  type AppBannerDecisionInput,
} from '../workerAppBanner';

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const androidOn = parseWorkerAppBannerConfig({ android: { enabled: true } });

function input(overrides: Partial<AppBannerDecisionInput> = {}): AppBannerDecisionInput {
  return {
    platform: 'android',
    config: androidOn,
    pathname: '/c1/workers/dashboard',
    dismissedUntil: 0,
    now: 1_000_000,
    installed: false,
    preview: false,
    ...overrides,
  };
}

describe('parseWorkerAppBannerConfig', () => {
  it('is off when the doc is missing or malformed', () => {
    expect(parseWorkerAppBannerConfig(null)).toEqual(WORKER_APP_BANNER_OFF);
    expect(parseWorkerAppBannerConfig('yes')).toEqual(WORKER_APP_BANNER_OFF);
    expect(parseWorkerAppBannerConfig({ android: { enabled: 'true' } }).android.enabled).toBe(false);
    expect(parseWorkerAppBannerConfig({ android: true }).android.enabled).toBe(false);
  });

  it('turns a platform on only with a literal true and defaults the Play URL', () => {
    expect(androidOn.android).toEqual({ enabled: true, storeUrl: DEFAULT_PLAY_STORE_URL });
    expect(androidOn.ios).toEqual({ enabled: false, storeUrl: null });
  });

  it('ignores store URLs that are not the real stores', () => {
    const cfg = parseWorkerAppBannerConfig({
      android: { enabled: true, storeUrl: 'https://evil.example/app' },
      ios: { enabled: true, storeUrl: 'http://apps.apple.com/app/id1' },
    });
    expect(cfg.android.storeUrl).toBe(DEFAULT_PLAY_STORE_URL);
    expect(cfg.ios.storeUrl).toBeNull();
  });

  it('keeps a valid App Store URL', () => {
    const cfg = parseWorkerAppBannerConfig({ ios: { enabled: true, storeUrl: 'https://apps.apple.com/us/app/id6808699956' } });
    expect(cfg.ios).toEqual({ enabled: true, storeUrl: 'https://apps.apple.com/us/app/id6808699956' });
  });
});

describe('detectAppBannerPlatform', () => {
  it('detects Android, iPhone, and iPadOS; ignores desktop', () => {
    expect(detectAppBannerPlatform(ANDROID_UA)).toBe('android');
    expect(detectAppBannerPlatform(IPHONE_UA)).toBe('ios');
    expect(detectAppBannerPlatform(MAC_UA, 5)).toBe('ios');
    expect(detectAppBannerPlatform(MAC_UA, 0)).toBeNull();
  });
});

describe('isAppBannerPath', () => {
  it('allows signed-in worker pages', () => {
    expect(isAppBannerPath('/c1/workers/dashboard')).toBe(true);
    expect(isAppBannerPath('/c1/workers/assignments/abc')).toBe(true);
    expect(isAppBannerPath('/c1/workers/earnings')).toBe(true);
  });

  it('never shows on the jobs board, postings, apply, or prescreen', () => {
    expect(isAppBannerPath('/c1/jobs-board')).toBe(false);
    expect(isAppBannerPath('/c1/jobs/123')).toBe(false);
    expect(isAppBannerPath('/c1/apply')).toBe(false);
    expect(isAppBannerPath('/apply/c1/job1')).toBe(false);
    expect(isAppBannerPath('/c1/workers/prescreen')).toBe(false);
  });
});

describe('resolveWorkerAppBanner', () => {
  it('shows for Android when the switch is on', () => {
    expect(resolveWorkerAppBanner(input())).toEqual({ platform: 'android', storeUrl: DEFAULT_PLAY_STORE_URL });
  });

  it('stays hidden while the switch is off (the shipped default)', () => {
    expect(resolveWorkerAppBanner(input({ config: WORKER_APP_BANNER_OFF }))).toBeNull();
  });

  it('stays hidden on iPhone until iOS is enabled with a store URL', () => {
    expect(resolveWorkerAppBanner(input({ platform: 'ios' }))).toBeNull();
    const iosOnNoUrl = parseWorkerAppBannerConfig({ ios: { enabled: true } });
    expect(resolveWorkerAppBanner(input({ platform: 'ios', config: iosOnNoUrl }))).toBeNull();
  });

  it('hides on desktop, when installed, when dismissed, and on excluded paths', () => {
    expect(resolveWorkerAppBanner(input({ platform: null }))).toBeNull();
    expect(resolveWorkerAppBanner(input({ installed: true }))).toBeNull();
    expect(resolveWorkerAppBanner(input({ dismissedUntil: 2_000_000 }))).toBeNull();
    expect(resolveWorkerAppBanner(input({ pathname: '/c1/jobs-board' }))).toBeNull();
  });

  it('shows again once the dismissal expires', () => {
    expect(resolveWorkerAppBanner(input({ dismissedUntil: 999_999 }))).not.toBeNull();
  });

  it('preview ignores the switch, dismissal, and desktop, but not the path rule', () => {
    const preview = input({ preview: true, config: WORKER_APP_BANNER_OFF, platform: null, dismissedUntil: 9e12 });
    expect(resolveWorkerAppBanner(preview)).toEqual({ platform: 'android', storeUrl: DEFAULT_PLAY_STORE_URL });
    expect(resolveWorkerAppBanner({ ...preview, pathname: '/c1/apply' })).toBeNull();
  });
});
