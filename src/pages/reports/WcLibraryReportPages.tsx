/**
 * Three WC surfaces moved from Settings → Onboarding Library into the
 * report library's Workers' comp section (Greg 2026-08-19): the class-
 * code catalog (with Sync to Everee + Add Class Code), the insured
 * worksites table, and the 8040-placeholder cleanup queue. Thin
 * wrappers over the existing tab components — one file, three pages.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, IconButton } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import StyleOutlinedIcon from '@mui/icons-material/StyleOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import PendingActionsOutlinedIcon from '@mui/icons-material/PendingActionsOutlined';

import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';
import WCClassCodesTab from '../TenantViews/settings/WCClassCodesTab';
import WcWorksitesTab from '../TenantViews/settings/WcWorksitesTab';
import Wc8040PlaceholdersTab from '../TenantViews/settings/Wc8040PlaceholdersTab';

const shell = (
  title: string,
  icon: React.ReactNode,
  body: (tenantId: string) => React.ReactNode,
): React.FC => {
  const Page: React.FC = () => {
    const { tenantId } = useAuth();
    const navigate = useNavigate();
    return (
      <Box sx={{ p: 2 }}>
        <PageHeader
          title={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <IconButton size="small" aria-label="Back to reports" onClick={() => navigate('/reports')}>
                <ArrowBackIcon fontSize="small" />
              </IconButton>
              {icon}
              <span>{title}</span>
            </Box>
          }
        />
        <Box sx={{ mt: 2 }}>{tenantId ? body(tenantId) : null}</Box>
      </Box>
    );
  };
  return Page;
};

export const WcClassCodesReportPage = shell(
  'WC Class Codes',
  <StyleOutlinedIcon fontSize="small" />,
  (tenantId) => <WCClassCodesTab tenantId={tenantId} />,
);

export const WcWorksitesReportPage = shell(
  'WC Worksites',
  <PlaceOutlinedIcon fontSize="small" />,
  (tenantId) => <WcWorksitesTab tenantId={tenantId} />,
);

export const Wc8040ReportPage = shell(
  '8040 Placeholders',
  <PendingActionsOutlinedIcon fontSize="small" />,
  (tenantId) => <Wc8040PlaceholdersTab tenantId={tenantId} />,
);

export default WcClassCodesReportPage;
