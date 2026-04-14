import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { EmploymentEntityKey, EmploymentEntityOverview } from './employmentV2Types';
import { employmentHeaderStateLabel } from '../../../../utils/deriveEmploymentHeaderState';
import { entityEmploymentStatusForDisplay } from '../../../../utils/entityEmploymentLifecycle';
import { EMPLOYMENT_I9_SECTION_ELEMENT_ID } from '../../../../utils/workerReadinessBannerModel';
import { workerEmploymentEntityKeySkipsWorkerI9SupportingDocuments } from '../../../../utils/workerEmploymentWorkerSurface';
import { buildTaxIdentityChecklistItems } from '../../../../utils/employmentMinimalChecklistModel';
import EmploymentI9SupportingDocumentsSubsection from '../../../../components/i9SupportingDocuments/EmploymentI9SupportingDocumentsSubsection';
import ProfileTabPointerAlert from '../../../../components/profile/ProfileTabPointerAlert';
import { workerEmploymentShouldShowScreeningPointerAlert } from '../../../../utils/workerEmploymentBackgroundsCrossLink';
import { useT } from '../../../../i18n';

export interface EmploymentWorkerEmploymentHubProps {
  entityKey: EmploymentEntityKey;
  overview: EmploymentEntityOverview;
  tenantId: string;
  profileUserId: string;
  onNavigateToProfileTab?: (tabLabel: string) => void;
  /** C1 worker shell: override copy + navigation target for screening cross-link (default = Backgrounds tab). */
  screeningPointerMessage?: string;
  onNavigateToScreening?: () => void;
  onRefresh?: () => void;
  onOpenWorkerNotificationComposer?: (args: {
    channel: 'sms' | 'email';
    body: string;
    subject?: string;
  }) => void;
  onSendWorkerNotificationDirect?: (args: {
    channel: 'sms' | 'email';
    body: string;
    subject?: string;
  }) => void | Promise<void>;
}

function payrollButtonRow(
  overview: EmploymentEntityOverview,
  tr: (key: string, params?: Record<string, string | number>) => string,
) {
  const payroll = overview.systems.payroll;
  const payrollComplete = String(overview.workerPayrollAccount?.payrollStatus || '').toLowerCase() === 'complete';
  const signup = String(payroll?.entityOnboardingUrl || '').trim() || null;
  const portalEntity = String(payroll?.entityPortalUrl || '').trim() || null;
  const workerLink = String(payroll?.portalUrl || '').trim() || null;
  const same = Boolean(signup && portalEntity && signup === portalEntity);

  const setupHref = !payrollComplete ? signup || portalEntity || workerLink || null : null;
  const loginWhileOnboardingHref = !payrollComplete && portalEntity && signup && !same ? portalEntity : null;
  const viewHref = payrollComplete ? workerLink || portalEntity || signup || null : null;

  if (!setupHref && !loginWhileOnboardingHref && !viewHref) return null;

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
      {setupHref ? (
        <Button
          variant="contained"
          size="small"
          startIcon={<OpenInNewIcon />}
          href={setupHref}
          target="_blank"
          rel="noopener noreferrer"
          component="a"
          sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
        >
          {tr('workerEmploymentDetail.payrollButtonSetup')}
        </Button>
      ) : null}
      {loginWhileOnboardingHref ? (
        <Button
          variant="outlined"
          size="small"
          startIcon={<OpenInNewIcon />}
          href={loginWhileOnboardingHref}
          target="_blank"
          rel="noopener noreferrer"
          component="a"
          sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
        >
          {tr('workerEmploymentDetail.payrollButtonView')}
        </Button>
      ) : null}
      {viewHref ? (
        <Button
          variant={setupHref || loginWhileOnboardingHref ? 'outlined' : 'contained'}
          size="small"
          startIcon={<OpenInNewIcon />}
          href={viewHref}
          target="_blank"
          rel="noopener noreferrer"
          component="a"
          sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
        >
          {tr('workerEmploymentDetail.payrollButtonView')}
        </Button>
      ) : null}
    </Stack>
  );
}

const EmploymentWorkerEmploymentHub: React.FC<EmploymentWorkerEmploymentHubProps> = ({
  entityKey,
  overview,
  tenantId,
  profileUserId,
  onNavigateToProfileTab,
  screeningPointerMessage,
  onNavigateToScreening,
  onRefresh,
  onOpenWorkerNotificationComposer,
  onSendWorkerNotificationDirect,
}) => {
  const t = useT();
  const { entityEmployment, headerEntityName } = overview;
  const showI9 = overview.workerType !== '1099';
  const skipI9Docs = workerEmploymentEntityKeySkipsWorkerI9SupportingDocuments(entityKey);
  const hiringEntityId = entityEmployment?.entityId?.trim() || '';
  const { i9: i9Checklist } = buildTaxIdentityChecklistItems(overview);

  const scrollToI9 = () => {
    document.getElementById(EMPLOYMENT_I9_SECTION_ELEMENT_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const showScreeningPointer =
    (Boolean(onNavigateToProfileTab) || Boolean(onNavigateToScreening)) &&
    workerEmploymentShouldShowScreeningPointerAlert(overview);

  const screeningMessage = screeningPointerMessage ?? t('workerEmploymentDetail.screeningPointerDefault');

  return (
    <Stack spacing={2}>
      {showScreeningPointer && (onNavigateToScreening || onNavigateToProfileTab) ? (
        <ProfileTabPointerAlert
          message={screeningMessage}
          onNavigate={() =>
            onNavigateToScreening ? onNavigateToScreening() : onNavigateToProfileTab?.('Backgrounds')
          }
        />
      ) : null}
      <Alert severity="success" variant="outlined" sx={{ alignItems: 'flex-start' }}>
        <Typography variant="body2" fontWeight={600}>
          {t('workerEmploymentDetail.hubAllSetTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.45 }}>
          {t('workerEmploymentDetail.hubAllSetBodyShort')}
        </Typography>
      </Alert>

      <Card variant="outlined">
        <CardHeader
          title={t('workerEmploymentDetail.hubYourEmploymentShort')}
          titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
          sx={{ pb: 1 }}
        />
        <CardContent sx={{ pt: 0, '&:last-child': { pb: 2 } }}>
          <Stack spacing={2} divider={<Divider flexItem />}>
            <Box component="section">
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                {t('workerEmploymentDetail.bridgeSectionPayroll')}
              </Typography>
              {payrollButtonRow(overview, t) ?? (
                <Typography variant="body2" color="text.secondary">
                  {t('workerEmploymentDetail.hubPayrollLinksPlaceholder')}
                </Typography>
              )}
            </Box>

            <Box component="section">
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                {t('workerEmploymentDetail.bridgeSectionIdentity')}
              </Typography>
              {showI9 && !skipI9Docs ? (
                <Stack spacing={1.5}>
                  <Button size="small" variant="outlined" onClick={scrollToI9} sx={{ textTransform: 'none', alignSelf: 'flex-start' }}>
                    {t('workerEmploymentDetail.hubJumpToI9Short')}
                  </Button>
                  <Box
                    id={EMPLOYMENT_I9_SECTION_ELEMENT_ID}
                    sx={{
                      scrollMarginTop: 96,
                    }}
                  >
                    <EmploymentI9SupportingDocumentsSubsection
                      tenantId={tenantId}
                      profileUserId={profileUserId}
                      requestedForEntityId={hiringEntityId || null}
                      employmentEntityKey={entityKey}
                      workerEmploymentRecordId={overview.entityEmployment?.id?.trim() || `${profileUserId}__${entityKey}`}
                      hiringEntityDisplayName={headerEntityName?.trim() || undefined}
                      onRefresh={onRefresh}
                      onOpenWorkerNotificationComposer={onOpenWorkerNotificationComposer}
                      onSendWorkerNotificationDirect={onSendWorkerNotificationDirect}
                      i9EmployeeSectionComplete={i9Checklist.completed}
                    />
                  </Box>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t('workerEmploymentDetail.hubNoI9Uploads')}
                </Typography>
              )}
            </Box>

            <Box component="section">
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                {t('workerEmploymentDetail.bridgeSectionScreening')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {headerEntityName?.trim() || t('workerEmploymentDetail.hubEmployerFallback')}
                {entityEmployment
                  ? ` · ${entityEmploymentStatusForDisplay(entityEmployment)} · ${employmentHeaderStateLabel(overview.employmentHeaderState)}`
                  : ''}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
};

export default EmploymentWorkerEmploymentHub;
