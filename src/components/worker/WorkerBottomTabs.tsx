/**
 * The ONE worker navigation (Greg approved 2026-08-23, P0 of the worker-app
 * redesign): a bottom tab bar — Home · Find Shifts · Schedule · Earnings ·
 * Profile — always visible, benchmark pattern (Instawork/Wonolo/Qwick).
 * Replaces the WorkerNav sidebar, the app-bar avatar menu, and the
 * dashboard's duplicate buttons. Log out + language now live on Profile.
 * Styling follows the phone-login design language: system fonts, hairline
 * top border, ink/muted — no cards, no shadows.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import HomeIcon from '@mui/icons-material/HomeOutlined';
import WorkIcon from '@mui/icons-material/WorkOutline';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonthOutlined';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import PersonIcon from '@mui/icons-material/PersonOutline';
import { t } from '../../i18n';

const TABS = [
  { key: 'nav.home', path: '/c1/workers/dashboard', match: ['/c1/workers/dashboard'], icon: HomeIcon },
  { key: 'nav.findWork', path: '/c1/jobs-board', match: ['/c1/jobs-board'], icon: WorkIcon },
  { key: 'nav.myAssignments', path: '/c1/workers/assignments', match: ['/c1/workers/assignments', '/c1/workers/applications'], icon: CalendarMonthIcon },
  { key: 'nav.payroll', path: '/c1/workers/earnings', match: ['/c1/workers/earnings', '/c1/workers/payroll'], icon: PaymentsIcon },
  { key: 'nav.myAccount', path: '/c1/workers/profile', match: ['/c1/workers/profile'], icon: PersonIcon },
] as const;

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const WorkerBottomTabs: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <nav
      aria-label={t('nav.openMenu')}
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1200,
        display: 'flex',
        background: '#fff',
        borderTop: '1px solid #e6e6e3',
        paddingBottom: 'env(safe-area-inset-bottom)',
        fontFamily: FONT,
      }}
    >
      {TABS.map(({ key, path, match, icon: Icon }) => {
        const active = match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
        return (
          <button
            key={key}
            type="button"
            onClick={() => navigate(path)}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              padding: '8px 0 6px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: active ? '#111' : '#8a8a86',
              fontFamily: FONT,
            }}
          >
            <Icon sx={{ fontSize: 24 }} />
            <span style={{ fontSize: 11, fontWeight: active ? 650 : 500, letterSpacing: '0.01em' }}>
              {t(key)}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export default WorkerBottomTabs;
