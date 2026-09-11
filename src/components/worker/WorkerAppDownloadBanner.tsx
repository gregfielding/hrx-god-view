/**
 * Slim, dismissible "Get the C1 Staffing app" bar for signed-in workers on
 * phones. Ships OFF — see src/utils/workerAppBanner.ts for the Firestore
 * switch, the QA preview param, and the show/hide rules.
 *
 * Web-only by nature (it advertises the native app), so there is no
 * c1_app counterpart; noted in the Flutter parity punch list.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import CloseIcon from '@mui/icons-material/Close';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useT } from '../../i18n';
import {
  ANDROID_PACKAGE_ID,
  APP_BANNER_DISMISS_MS,
  APP_BANNER_PREVIEW_PARAM,
  APP_BANNER_PREVIEW_SESSION_KEY,
  WORKER_APP_BANNER_OFF,
  WORKER_APP_BANNER_SETTINGS_DOC,
  appBannerDismissKey,
  detectAppBannerPlatform,
  parseWorkerAppBannerConfig,
  resolveWorkerAppBanner,
  type WorkerAppBannerConfig,
} from '../../utils/workerAppBanner';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** One read per page load; a flipped switch reaches workers on their next visit. */
let configPromise: Promise<WorkerAppBannerConfig> | null = null;
function loadBannerConfig(): Promise<WorkerAppBannerConfig> {
  if (!configPromise) {
    configPromise = getDoc(doc(db, WORKER_APP_BANNER_SETTINGS_DOC))
      .then((snap) => parseWorkerAppBannerConfig(snap.exists() ? snap.data() : null))
      .catch(() => WORKER_APP_BANNER_OFF);
  }
  return configPromise;
}

function readPreviewFlag(search: string): boolean {
  try {
    const value = new URLSearchParams(search).get(APP_BANNER_PREVIEW_PARAM);
    if (value === 'preview') window.sessionStorage.setItem(APP_BANNER_PREVIEW_SESSION_KEY, '1');
    if (value === 'off') window.sessionStorage.removeItem(APP_BANNER_PREVIEW_SESSION_KEY);
    return window.sessionStorage.getItem(APP_BANNER_PREVIEW_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

type RelatedApp = { platform?: string; id?: string };
type NavigatorWithRelatedApps = Navigator & { getInstalledRelatedApps?: () => Promise<RelatedApp[]> };

const WorkerAppDownloadBanner: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const uid = user?.uid;

  const [config, setConfig] = useState<WorkerAppBannerConfig>(WORKER_APP_BANNER_OFF);
  const [installed, setInstalled] = useState(false);
  const [dismissedUntil, setDismissedUntil] = useState(0);
  const preview = useMemo(() => readPreviewFlag(search), [search]);

  const platform = useMemo(
    () =>
      typeof navigator === 'undefined'
        ? null
        : detectAppBannerPlatform(navigator.userAgent || '', navigator.maxTouchPoints || 0),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    if (!uid || (!platform && !preview)) return undefined;
    void loadBannerConfig().then((next) => {
      if (!cancelled) setConfig(next);
    });
    return () => {
      cancelled = true;
    };
  }, [uid, platform, preview]);

  useEffect(() => {
    if (!uid) return;
    try {
      const raw = window.localStorage.getItem(appBannerDismissKey(uid));
      const until = raw ? Number(raw) : 0;
      setDismissedUntil(Number.isFinite(until) ? until : 0);
    } catch {
      setDismissedUntil(0);
    }
  }, [uid]);

  // Best effort: Chrome on Android can report the installed app when it is
  // listed in manifest.json related_applications. Anything else → not installed.
  useEffect(() => {
    let cancelled = false;
    const nav = typeof navigator === 'undefined' ? undefined : (navigator as NavigatorWithRelatedApps);
    if (platform !== 'android' || !nav?.getInstalledRelatedApps) return undefined;
    nav
      .getInstalledRelatedApps()
      .then((apps) => {
        if (!cancelled) setInstalled(apps.some((app) => app.id === ANDROID_PACKAGE_ID));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [platform]);

  if (!uid) return null;
  const decision = resolveWorkerAppBanner({
    platform,
    config,
    pathname,
    dismissedUntil,
    now: Date.now(),
    installed,
    preview,
  });
  if (!decision) return null;

  const dismiss = () => {
    const until = Date.now() + APP_BANNER_DISMISS_MS;
    try {
      window.localStorage.setItem(appBannerDismissKey(uid), String(until));
    } catch {
      // Storage blocked: hide for this page view only.
    }
    if (preview) {
      try {
        window.sessionStorage.removeItem(APP_BANNER_PREVIEW_SESSION_KEY);
      } catch {
        // ignore
      }
    }
    setDismissedUntil(until);
    if (preview) window.location.replace(pathname);
  };

  return (
    <aside
      aria-label={t('appBanner.title')}
      data-testid="worker-app-download-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 4px 8px 14px',
        marginBottom: 16,
        background: '#fff',
        border: '1px solid #e6e6e3',
        borderRadius: 12,
        fontFamily: FONT,
        color: '#111',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{t('appBanner.title')}</div>
        <div style={{ fontSize: 13, color: '#6b6b66', lineHeight: 1.35 }}>{t('appBanner.body')}</div>
      </div>
      <a
        href={decision.storeUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          flexShrink: 0,
          background: '#111',
          color: '#fff',
          borderRadius: 999,
          padding: '7px 12px',
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {t('appBanner.cta')}
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('appBanner.dismiss')}
        style={{
          flexShrink: 0,
          border: 0,
          background: 'transparent',
          color: '#6b6b66',
          padding: 6,
          cursor: 'pointer',
          display: 'flex',
        }}
      >
        <CloseIcon sx={{ fontSize: 20 }} />
      </button>
    </aside>
  );
};

export default WorkerAppDownloadBanner;
