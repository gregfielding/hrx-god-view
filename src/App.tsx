import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useNavigate, useLocation, useSearchParams, Navigate, Outlet } from 'react-router-dom';
import { LoadScript } from '@react-google-maps/api';
import { GOOGLE_MAPS_LIBRARIES } from './utils/googleMapsLoader';
import { logger } from './utils/logger';
import { getUsersIndexRedirectPath } from './utils/usersLayoutPersistence';

const CertEngineShadowDebugPanel =
  process.env.NODE_ENV === 'development'
    ? lazy(() => import('./components/dev/CertEngineShadowDebugPanel'))
    : null;

import Layout from './components/Layout';
import ConditionalJobsBoardLayout from './components/ConditionalJobsBoardLayout';
import ConditionalWorkerLayout from './components/ConditionalWorkerLayout';
import PageViewTracker from './components/PageViewTracker';
import NavigationWatchdog from './components/NavigationWatchdog';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const AIDashboard = lazy(() => import('./pages/TenantViews/AIDashboard'));
const ChatGPT = lazy(() => import('./pages/TenantViews/ChatGPT'));
const UserProfile = lazy(() => import('./pages/UserProfile'));
const UserReadinessPage = lazy(() => import('./pages/UserReadinessPage'));
const Login = lazy(() => import('./pages/Login'));
// Phone (OTP) sign-in — alternate login layout under test (Greg 2026-08-21).
const PhoneLoginPage = lazy(() => import('./pages/PhoneLoginPage'));
const LoginGate = lazy(() => import('./pages/LoginGate'));
const UserOnboarding = lazy(() => import('./pages/UserOnboarding'));
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { canAccessAccountInvoicingTab, canAccessGlobalInvoicing } from './utils/invoicingAccessControl';
import { AssociationsCacheProvider } from './contexts/AssociationsCacheContext';
import { CRMCacheProvider } from './contexts/CRMCacheContext';
import { SalespeopleProvider } from './contexts/SalespeopleContext';
import { DirectMessengerProvider } from './contexts/DirectMessengerContext';
import { ChatGPTProvider } from './contexts/ChatGPTContext';
import ProtectedRoute from './components/ProtectedRoute';
import SlackProtectedRoute from './components/SlackProtectedRoute';
import { Box, CircularProgress, Typography } from '@mui/material';
const TenantsTable = lazy(() => import('./pages/Admin/TenantsTable'));
const AgencyProfile = lazy(() => import('./pages/AgencyProfile'));
const TenantWorkforce = lazy(() => import('./pages/TenantViews/TenantWorkforce'));
const WorkforceDashboard = lazy(() => import('./pages/TenantViews/WorkforceDashboard'));
const CompanyDirectory = lazy(() => import('./pages/TenantViews/CompanyDirectory'));
const AddWorkers = lazy(() => import('./pages/TenantViews/AddWorkers'));
const PendingInvites = lazy(() => import('./pages/TenantViews/PendingInvites'));
const WorkforcePageWrapper = lazy(() => import('./pages/TenantViews/WorkforcePageWrapper'));
const TenantSettings = lazy(() => import('./pages/TenantViews/TenantSettings'));
const SettingsLanding = lazy(() => import('./pages/TenantViews/SettingsLanding'));
const CompanySetup = lazy(() => import('./pages/TenantViews/CompanySetup'));
const MessagingTab = lazy(() => import('./pages/TenantViews/MessagingTab'));
const SenderManagementPage = lazy(() => import('./pages/TenantViews/SenderManagementPage'));
const CompanyDefaults = lazy(() => import('./pages/TenantViews/CompanyDefaults'));
const TenantLocations = lazy(() => import('./pages/TenantViews/TenantLocations'));
const TenantUserGroups = lazy(() => import('./pages/TenantViews/TenantUserGroups'));
const IntegrationsTab = lazy(() => import('./pages/TenantViews/IntegrationsTab'));
const TenantModules = lazy(() => import('./pages/TenantViews/TenantModules'));
const TenantAISettings = lazy(() => import('./pages/TenantViews/TenantAISettings'));
const TenantFlex = lazy(() => import('./pages/TenantViews/TenantFlex'));
const JobsBoard = lazy(() => import('./pages/TenantViews/JobsBoard'));
const EditJobPost = lazy(() => import('./pages/TenantViews/EditJobPost'));
const PublicJobsBoard = lazy(() => import('./pages/PublicJobsBoard'));
const JobPostingDetail = lazy(() => import('./pages/JobPostingDetail'));
const ApplyWizardPage = lazy(() => import('./pages/ApplyWizardPage'));
const UserApplications = lazy(() => import('./pages/UserApplications'));
const MyAssignments = lazy(() => import('./pages/MyAssignments'));
const AssignmentDetails = lazy(() => import('./pages/AssignmentDetails'));
const Communications = lazy(() => import('./pages/Communications'));
const Terms = lazy(() => import('./pages/Terms'));
const Privacy = lazy(() => import('./pages/Privacy'));
const SMSPrivacy = lazy(() => import('./pages/SMSPrivacy'));
const Apply = lazy(() => import('./pages/Apply'));
const TenantCRM = lazy(() => import('./pages/TenantViews/TenantCRM'));
const PublicCRMView = lazy(() => import('./pages/PublicCRMView'));
const CompanyDetails = lazy(() => import('./pages/TenantViews/CompanyDetails'));
const ContactDetails = lazy(() => import('./pages/TenantViews/ContactDetails'));
const DealDetails = lazy(() => import('./pages/TenantViews/DealDetails'));
const TenantSalesperson = lazy(() => import('./pages/TenantViews/TenantSalesperson'));
const LocationDetails = lazy(() => import('./pages/TenantViews/LocationDetails'));
const TenantUsers = lazy(() => import('./pages/TenantViews/TenantUsers'));
const AddUserForm = lazy(() => import('./pages/AddUserForm'));
const Customers = lazy(() => import('./pages/Customers'));
const UserGroupDetails = lazy(() => import('./pages/AgencyProfile/components/UserGroupDetails'));
const AIContextDashboard = lazy(() => import('./pages/Admin/AIContextDashboard'));
const ModulesDashboard = lazy(() => import('./pages/Admin/ModulesDashboard'));
const AILaunchpad = lazy(() => import('./pages/Admin/AILaunchpad'));
const TraitsEngine = lazy(() => import('./pages/Admin/TraitsEngine'));
const ToneSettings = lazy(() => import('./pages/Admin/ToneSettings'));
const MomentsEngine = lazy(() => import('./pages/Admin/MomentsEngine'));
const AICampaigns = lazy(() => import('./pages/Admin/AICampaigns'));
const ScheduledMomentsDashboard = lazy(() => import('./pages/Admin/ScheduledMomentsDashboard'));
const NotificationsTable = lazy(() => import('./pages/Admin/NotificationsTable'));
const FeedbackEngine = lazy(() => import('./pages/Admin/FeedbackEngine'));
const CustomerToneOverrides = lazy(() => import('./pages/Admin/CustomerToneOverrides'));
const WeightsEngine = lazy(() => import('./pages/Admin/WeightsEngine'));
const ContextEngine = lazy(() => import('./pages/Admin/ContextEngine'));
const AILogs = lazy(() => import('./pages/Admin/AILogs'));
const RetrievalFilters = lazy(() => import('./pages/Admin/RetrievalFilters'));
const VectorSettings = lazy(() => import('./pages/Admin/VectorSettings'));
const AutoContextEngine = lazy(() => import('./pages/Admin/AutoContextEngine'));
const AutoDevOps = lazy(() => import('./pages/Admin/AutoDevOps'));
const AIChat = lazy(() => import('./pages/Admin/AIChat'));
const Broadcast = lazy(() => import('./pages/Admin/Broadcast'));
const BroadcastManagement = lazy(() => import('./pages/Admin/BroadcastManagement'));
const TranslationManagement = lazy(() => import('./pages/Admin/TranslationManagement'));
const UserLanguagePreferences = lazy(() => import('./pages/Admin/UserLanguagePreferences'));
const HelloMessageManagement = lazy(() => import('./pages/Admin/HelloMessageManagement'));
const AutoContextEngineNew = lazy(() => import('./pages/Admin/AutoContextEngine'));
const AISelfImprovement = lazy(() => import('./pages/Admin/AISelfImprovement'));
import InviteTokenValidator from './components/InviteTokenValidator';
import WorkerRoute from './auth/WorkerRoute';
import C1WorkerLayout from './layouts/C1WorkerLayout';
const C1WorkersIndex = lazy(() => import('./pages/c1/workers/index'));
const C1WorkerDashboard = lazy(() => import('./pages/c1/workers/dashboard'));
const C1WorkerAssignments = lazy(() => import('./pages/c1/workers/assignments'));
const C1WorkerProfile = lazy(() => import('./pages/c1/workers/profile'));
const C1WorkerProfileSection = lazy(() => import('./pages/c1/workers/profileSection'));
const C1WorkerProfileExperience = lazy(() => import('./pages/c1/workers/profileExperience'));
const C1WorkerProfileAboutLegal = lazy(() => import('./pages/c1/workers/profileAboutLegal'));
const C1WorkerDocuments = lazy(() => import('./pages/c1/workers/documents'));
const C1WorkerMyEmployment = lazy(() => import('./pages/c1/workers/myEmployment'));
const C1WorkerMyEmploymentDetail = lazy(() => import('./pages/c1/workers/myEmploymentDetail'));
const C1WorkerScreening = lazy(() => import('./pages/c1/workers/screening'));
const C1WorkerSupport = lazy(() => import('./pages/c1/workers/support'));
const C1WorkerNotifications = lazy(() => import('./pages/c1/workers/notifications'));
const WorkerPayrollIndex = lazy(() => import('./pages/c1/workers/WorkerPayrollIndex'));
const WorkerPayrollEvereeTenant = lazy(() => import('./pages/c1/workers/WorkerPayrollEvereeTenant'));
const WorkerAiPrescreenPage = lazy(() => import('./pages/c1/workers/WorkerAiPrescreenPage'));
const C1WorkerPayrollHelp = lazy(() => import('./pages/c1/workers/payrollHelp'));
const C1WorkerPayHistory = lazy(() => import('./pages/c1/workers/payHistory'));
const PayrollTicketsPage = lazy(() => import('./pages/PayrollTicketsPage'));
import OnboardingProfileForm from './components/OnboardingProfileForm';
import OnboardingCompleteScreen from './components/OnboardingCompleteScreen';
const Help = lazy(() => import('./pages/Help'));
const HelpManagement = lazy(() => import('./pages/Admin/HelpManagement'));
const DataOperations = lazy(() => import('./pages/Admin/DataOperations'));
const JobSatisfactionInsights = lazy(() => import('./pages/Admin/JobSatisfactionInsights'));
const JSIDocumentation = lazy(() => import('./pages/Admin/JSIDocumentation'));
const DailyMotivation = lazy(() => import('./pages/Admin/DailyMotivation'));
const LogCoverageDashboard = lazy(() => import('./pages/Admin/LogCoverageDashboard'));
const AutoDevOpsMonitoring = lazy(() => import('./pages/Admin/AutoDevOpsMonitoring'));
const AutoDevOpsPipeline = lazy(() => import('./pages/Admin/AutoDevOpsPipeline'));
const MotivationLibrarySeeder = lazy(() => import('./pages/Admin/MotivationLibrarySeeder'));
const HelloMessageConfig = lazy(() => import('./pages/Admin/HelloMessageConfig'));
const SlackAdminPage = lazy(() => import('./pages/Admin/SlackAdminPage'));
const MobileAppErrors = lazy(() => import('./pages/Admin/MobileAppErrors'));
const ResumeManagement = lazy(() => import('./pages/ResumeManagement'));
const Reports = lazy(() => import('./pages/Reports'));
const AIAnalytics = lazy(() => import('./pages/Admin/AIAnalytics'));
const AIFeedbackDashboard = lazy(() => import('./pages/Admin/AIFeedbackDashboard'));
const AssociationsAdmin = lazy(() => import('./pages/Admin/AssociationsAdmin'));
const SetupPassword = lazy(() => import('./pages/SetupPassword'));
const MobileApp = lazy(() => import('./pages/MobileApp'));
const PrivacySettings = lazy(() => import('./pages/PrivacySettings'));
import PrivacySettingsAdminShellGate from './components/PrivacySettingsAdminShellGate';
const WorkerAssignments = lazy(() => import('./pages/WorkerAssignments'));
const FlexSettings = lazy(() => import('./pages/FlexSettings'));
const RecruiterSettings = lazy(() => import('./pages/RecruiterSettings'));
const RecruiterDashboard = lazy(() => import('./pages/RecruiterDashboard'));
const Shifts = lazy(() => import('./pages/Shifts'));
const ShiftsList = lazy(() => import('./pages/ShiftsList'));
const ShiftsCalendar = lazy(() => import('./pages/ShiftsCalendar'));
const ShiftsLog = lazy(() => import('./pages/ShiftsLog'));
const Timesheets = lazy(() => import('./pages/Timesheets'));
const Workforce = lazy(() => import('./pages/Workforce'));
const WorkforceEmployeeReadiness = lazy(() => import('./pages/WorkforceEmployeeReadiness'));
const WorkforceJobReadiness = lazy(() => import('./pages/WorkforceJobReadiness'));
const WorkforceI9Signatures = lazy(() => import('./pages/WorkforceI9Signatures'));
const AccountsDashboard = lazy(() => import('./pages/AccountsDashboard'));
const RecruiterMain = lazy(() => import('./pages/RecruiterMain'));
// RecruiterMyQueue is no longer routed from App.tsx — `/jobs/my-queue`
// redirects directly via <Navigate>. The file is kept as a deprecated
// thin wrapper for any code that imports the component directly. See
// src/pages/RecruiterMyQueue.tsx for the cleanup timeline.
const RecruiterJobOrders = lazy(() => import('./pages/RecruiterJobOrders'));
const BackgroundCheckPolicyPage = lazy(() => import('./pages/compliance/BackgroundCheckPolicyPage'));
const RecruiterAccounts = lazy(() => import('./pages/RecruiterAccounts'));
const RecruiterJobOrderDetail = lazy(() => import('./pages/RecruiterJobOrderDetail'));
const RecruiterApplicants = lazy(() => import('./pages/RecruiterApplicants'));
const SmartGroupsPage = lazy(() => import('./pages/SmartGroupsPage'));
const AllSmartGroupsPage = lazy(() => import('./pages/AllSmartGroupsPage'));
const MySmartGroupsListPage = lazy(() => import('./pages/MySmartGroupsListPage'));
const InviteUsersPage = lazy(() => import('./pages/InviteUsersPage'));
const SavedSmartGroupDetailPage = lazy(() => import('./pages/SavedSmartGroupDetailPage'));
const RecruiterUsers = lazy(() => import('./pages/RecruiterUsers'));
const UsersLayout = lazy(() => import('./pages/UsersLayout'));
const DeletionRequestsPage = lazy(() => import('./pages/DeletionRequestsPage'));
const PhoneChangeRequestsPage = lazy(() => import('./pages/PhoneChangeRequestsPage'));
const RecruiterAccountDetails = lazy(() => import('./pages/RecruiterAccountDetails'));
const AccountLocationDetail = lazy(() => import('./pages/AccountLocationDetail'));
const GlobalInvoicingPage = lazy(() => import('./pages/GlobalInvoicingPage'));
const PayrollCostsPage = lazy(() => import('./pages/PayrollCostsPage'));
const ReportsIndexPage = lazy(() => import('./pages/reports/ReportsIndexPage'));
const ArAgingReportPage = lazy(() => import('./pages/reports/ArAgingReportPage'));
const GrossMarginReportPage = lazy(() => import('./pages/reports/GrossMarginReportPage'));
const JobCostingReportPage = lazy(() => import('./pages/reports/JobCostingReportPage'));
const PayrollRegisterPage = lazy(() => import('./pages/reports/PayrollRegisterPage'));
const PayrollJournalPage = lazy(() => import('./pages/reports/PayrollJournalPage'));
const WcAuditReportPage = lazy(() => import('./pages/reports/WcAuditReportPage'));
const I9StatusReportPage = lazy(() => import('./pages/reports/I9StatusReportPage'));
const AcaLookbackReportPage = lazy(() => import('./pages/reports/AcaLookbackReportPage'));
const TaxSickLeaveReportPage = lazy(() => import('./pages/reports/TaxSickLeaveReportPage'));
const QboClassesPage = lazy(() => import('./pages/reports/QboClassesPage'));
const CashFlowReportPage = lazy(() => import('./pages/reports/CashFlowReportPage'));
const WcClassCodesReportPage = lazy(() =>
  import('./pages/reports/WcLibraryReportPages').then((m) => ({ default: m.WcClassCodesReportPage })),
);
const WcWorksitesReportPage = lazy(() =>
  import('./pages/reports/WcLibraryReportPages').then((m) => ({ default: m.WcWorksitesReportPage })),
);
const Wc8040ReportPage = lazy(() =>
  import('./pages/reports/WcLibraryReportPages').then((m) => ({ default: m.Wc8040ReportPage })),
);
const FinancesBudgetingPage = lazy(() => import('./pages/FinancesBudgetingPage'));
const SchedulingHealthPage = lazy(() => import('./pages/SchedulingHealthPage'));
const WhosWorkingPage = lazy(() => import('./pages/WhosWorkingPage'));
const StaffOnboardingCenter = lazy(() => import('./pages/StaffOnboardingCenter'));
const RecruiterContacts = lazy(() => import('./pages/RecruiterContacts'));
const RecruiterContactDetails = lazy(() => import('./pages/RecruiterContactDetails'));
const NewJobOrder = lazy(() => import('./pages/NewJobOrder'));
const RecruiterUserGroups = lazy(() => import('./pages/RecruiterUserGroups'));
const RecruiterUserGroupDetails = lazy(() => import('./pages/RecruiterUserGroupDetails'));
const UserInboxPage = lazy(() => import('./pages/UserInboxPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
const TextMessagesPage = lazy(() => import('./pages/TextMessagesPage'));
const SlackPage = lazy(() => import('./pages/SlackPage'));
const ContactsPage = lazy(() => import('./pages/ContactsPage'));
const CompaniesPage = lazy(() => import('./pages/CompaniesPage'));

const InsightReports = lazy(() => import('./pages/InsightReports'));

// Read the Google Maps API key from environment variables
const googleMapsApiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';

// C1 worker pages: use same names as default exports to avoid TS "Cannot find name" when referenced in routes
const WorkerDashboard = C1WorkerDashboard;
const WorkerProfile = C1WorkerProfile;
const WorkerSupport = C1WorkerSupport;

// Static libraries array to prevent performance warnings (shared across app)
// Shared constant — see src/utils/googleMapsLoader.ts (all loaders must
// build the identical script URL or the Maps API gets torn down/reloaded).
const googleMapsLibraries = GOOGLE_MAPS_LIBRARIES;

/**
 * Two-phase mount for heavy route components (2026-07-09, Greg: "clicked
 * the table row and the address bar changed, but navigation stayed on
 * the job orders layout").
 *
 * React Router v7 performs client-side navigations inside
 * React.startTransition. A transition render is RESTARTED whenever an
 * urgent update interrupts it — and pages with live Firestore
 * subscriptions (job orders list, notification badges, messenger) fire
 * urgent updates constantly. When the destination component's first
 * render is expensive (RecruiterJobOrderDetail is the biggest page in
 * the app), the transition can starve indefinitely: the URL updates but
 * the old screen never swaps. Direct URL loads were unaffected (full
 * page load = no transition), which is why this bug kept reading as "a
 * stale tab".
 *
 * This wrapper makes the transition commit a trivial skeleton (cannot
 * be outrun), then mounts the real page in a post-commit urgent pass.
 */
function DeferredMount({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  return <>{children}</>;
}



function UserGroupDetailsWrapper() {
  const { groupId } = useParams();
  const { activeTenant } = useAuth();
  if (!activeTenant?.id || !groupId) return null;
  return <UserGroupDetails tenantId={activeTenant.id} groupId={groupId} />;
}

function UsersRedirect() {
  const { uid } = useParams();
  return <Navigate to={`/users/${uid}`} replace />;
}

/** For any /users/:uid surface: workers (securityLevel null or 0–4) go to My
 * Account; ONLY resolved staff (5+) see the internal UserProfile. Waits for
 * auth to finish loading — the context's placeholder securityLevel briefly
 * reads as staff, which leaked the admin view (activity log, scoring) to a
 * worker on 2026-08-23. Unknown = worker, always. */
function C1UserProfileOrRedirect() {
  const { user, securityLevel, loading } = useAuth();
  if (loading) return <div />;
  const level = securityLevel != null ? Number.parseInt(String(securityLevel), 10) : 0;
  const isStaff = !Number.isNaN(level) && level >= 5;
  if (user && !isStaff) {
    return <Navigate to="/c1/workers/profile" replace />;
  }
  return <UserProfile />;
}


/** /c1/workers/payroll/:id → /c1/workers/earnings/:id (P0 rename 2026-08-23). */
function WorkerPayrollLegacyRedirect() {
  const { evereeTenantId } = useParams();
  return <Navigate to={`/c1/workers/earnings/${evereeTenantId ?? ''}`} replace />;
}
function UsersHubIndexRedirect() {
  return <Navigate to={getUsersIndexRedirectPath()} replace />;
}

function RecruiterAccountDetailsRedirect() {
  const { accountId } = useParams();
  return <Navigate to={accountId ? `/accounts/${accountId}` : '/accounts'} replace />;
}

function RecruiterAccountsRedirect() {
  const location = useLocation();
  return <Navigate to={`/accounts${location.search}${location.hash}`} replace />;
}

function RecruiterMyAccountsRedirect() {
  const location = useLocation();
  return <Navigate to={`/accounts/my${location.search}${location.hash}`} replace />;
}

function JobsRedirect() {
  const params = useParams();
  const location = useLocation();
  const rest = (params as any)['*'] as string | undefined;
  const suffix = rest ? `/${rest}` : '';
  return <Navigate to={`/jobs${suffix}${location.search}${location.hash}`} replace />;
}


function CrmCompaniesRedirect() {
  const params = useParams();
  const location = useLocation();
  const rest = (params as any)['*'] as string | undefined;
  const suffix = rest ? `/${rest}` : '';
  const target = `/companies${suffix}${location.search}${location.hash}`;
  return <Navigate to={target} replace />;
}

/** Redirect /recruiter/companies/... to canonical /companies/... */
function RecruiterCompaniesRedirect() {
  const params = useParams();
  const location = useLocation();
  const rest = (params as any)['*'] as string | undefined;
  const suffix = rest ? `/${rest}` : '';
  const target = `/companies${suffix}${location.search}${location.hash}`;
  return <Navigate to={target} replace />;
}

/** Redirect /recruiter/contacts/... to canonical /contacts/... */
function RecruiterContactsRedirect() {
  const params = useParams();
  const location = useLocation();
  const rest = (params as any)['*'] as string | undefined;
  const suffix = rest ? `/${rest}` : '';
  const target = `/contacts${suffix}${location.search}${location.hash}`;
  return <Navigate to={target} replace />;
}

function UsersPageWrapper() {
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          pb: 2,
        }}
      >
        <Outlet context={{
          activeTab: 'users' as const,
          search,
          setSearch,
          showFavoritesOnly,
          setShowFavoritesOnly,
        }} />
      </Box>
    </Box>
  );
}

function CRMAccessGuard({ children }: { children: React.ReactNode }) {
  const { crmSalesEnabled } = useAuth();
  if (!crmSalesEnabled) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh" flexDirection="column" gap={2}>
        <Typography variant="h5" color="error">Access Denied</Typography>
        <Typography variant="body1" color="text.secondary">You don’t have permission to access this page.</Typography>
      </Box>
    );
  }
  return <>{children}</>;
}

function RecruiterAccessGuard({ children }: { children: React.ReactNode }) {
  const { recruiterEnabled } = useAuth();
  if (!recruiterEnabled) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh" flexDirection="column" gap={2}>
        <Typography variant="h5" color="error">Access Denied</Typography>
        <Typography variant="body1" color="text.secondary">You don't have permission to access this page.</Typography>
      </Box>
    );
  }
  return <>{children}</>;
}

/**
 * Route-level guard for Account → Invoicing tab.
 * Account Invoicing tab is available to security levels 5, 6, and 7.
 * If the URL has ?tab=invoicing and the user is not 5/6/7, redirect to tab=overview.
 */
function InvoicingTabGuard({ children }: { children: React.ReactNode }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { currentClaimsSecurityLevel, securityLevel } = useAuth();
  const tab = searchParams.get('tab');
  const canAccess = canAccessAccountInvoicingTab(currentClaimsSecurityLevel ?? securityLevel);

  if (tab === 'invoicing' && !canAccess) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', 'overview');
    const to = `${location.pathname}?${nextParams.toString()}`;
    return <Navigate to={to} replace />;
  }

  return <>{children}</>;
}

/** Guard for /invoicing: only security level 7 can access (global invoicing across all accounts). */
function GlobalInvoicingGuard({ children }: { children: React.ReactNode }) {
  const { currentClaimsSecurityLevel, securityLevel } = useAuth();
  const canAccess = canAccessGlobalInvoicing(currentClaimsSecurityLevel ?? securityLevel);
  if (!canAccess) {
    return <Navigate to="/accounts" replace />;
  }
  return <>{children}</>;
}

function JobsBoardAccessGuard({ children }: { children: React.ReactNode }) {
  const { jobsBoardEnabled } = useAuth();
  if (!jobsBoardEnabled) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh" flexDirection="column" gap={2}>
        <Typography variant="h5" color="error">Access Denied</Typography>
        <Typography variant="body1" color="text.secondary">You don't have permission to access this page.</Typography>
      </Box>
    );
  }
  return <>{children}</>;
}


function MyTenantWrapper() {
  const { user, activeTenant } = useAuth();
  const navigate = useNavigate();
  
  useEffect(() => {
    if (user && activeTenant?.id) {
      navigate(`/tenants/${activeTenant.id}`, { replace: true });
    } else {
      navigate('/tenants', { replace: true });
    }
  }, [user, activeTenant, navigate]);
  
  return <div>Redirecting to your tenant...</div>;
}

function ProfileRedirect() {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  useEffect(() => {
    if (user?.uid) {
      navigate(`/users/${user.uid}`, { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  }, [user, navigate]);
  
  return <div>Redirecting to your profile...</div>;
}

function HomeRedirect() {
  const { user, securityLevel, loading } = useAuth();

  if (loading) return <div>Redirecting...</div>;
  if (!user) return <Navigate to="/login" replace />;

  const level = Number.parseInt(String(securityLevel ?? '0'), 10) || 0;
  return <Navigate to={level >= 5 ? '/dashboard' : '/profile'} replace />;
}

// `/signup` is a memorable public alias for the generic worker
// application/signup page, which actually lives at `/c1/apply` (the `Apply`
// page — group optional). Preserve the optional `group/:groupId` segment and
// the query string so `?groupId=` (QR codes / labor-pool links) survive.
// Without this, `/signup` matched no route and rendered a blank page.
function SignupRedirect() {
  const location = useLocation();
  const { groupId } = useParams<{ groupId?: string }>();
  const target = groupId ? `/c1/apply/group/${groupId}` : '/c1/apply';
  return <Navigate to={`${target}${location.search}`} replace />;
}

function DashboardAdminRedirect() {
  const { user, securityLevel, loading } = useAuth();

  if (loading) return <div>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  const level = Number.parseInt(String(securityLevel ?? '0'), 10) || 0;
  if (level < 5) return <Navigate to="/profile" replace />;

  return <Dashboard />;
}

function CalendarAdminRedirect() {
  const { user, securityLevel, loading } = useAuth();

  if (loading) return <div>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  const level = Number.parseInt(String(securityLevel ?? '0'), 10) || 0;
  if (level < 5) return <Navigate to="/profile" replace />;

  return <CalendarPage />;
}

// Wrapper component for IntegrationsTab to provide tenantId
const IntegrationsTabWrapper: React.FC = () => {
  const { tenantId } = useAuth();
  return tenantId ? <IntegrationsTab tenantId={tenantId} /> : null;
};

// Wrapper component for MessagingTab to provide tenantId
const MessagingTabWrapper: React.FC = () => {
  const { tenantId, activeTenant } = useAuth();
  const effectiveTenantId = activeTenant?.id || tenantId;
  return effectiveTenantId ? <MessagingTab tenantId={effectiveTenantId} /> : null;
};

function App() {
  useEffect(() => {
    try {
      // Enable new associations read by default
      localStorage.setItem('feature.newAssociationsRead', 'true');
    } catch (e) {
      // ignore storage issues
    }
  }, []);
  
  const routes = (
    <Routes>
      {/* Phone-first login (Greg 2026-08-25): /login = phone OTP screen, with
          last-method memory bouncing email/password users to /login/email. */}
      <Route path="/login" element={<LoginGate />} />
      <Route path="/login/email" element={<Login />} />
      <Route path="/login/phone" element={<PhoneLoginPage />} />
      <Route path="/crm/public" element={<PublicCRMView />} />
      <Route path="/setup-password" element={<SetupPassword />} />
      <Route path="/invite/:token" element={<InviteTokenValidator />} />
      <Route path="/onboarding/profile" element={<OnboardingProfileForm />} />
      <Route path="/onboarding/complete" element={<OnboardingCompleteScreen />} />
      <Route path="/c1/apply" element={<Apply />} />
      <Route path="/c1/apply/group/:groupId" element={<Apply />} />
      {/* `/signup` alias → the generic apply/signup page at /c1/apply. */}
      <Route path="/signup" element={<SignupRedirect />} />
      <Route path="/signup/group/:groupId" element={<SignupRedirect />} />
      <Route path="/consent" element={<Communications />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/sms-privacy" element={<SMSPrivacy />} />
      {/* HRX Signatures /sign/s/:sessionId route + SignerPage removed 2026-06-05.
          The Phase 1C signature scaffold was never activated; production I-9
          signatures flow through Everee's hosted onboarding. */}

      {/* Single layout for /c1 and /apply so nav + top bar stay mounted on back/forward */}
      <Route element={<ConditionalWorkerLayout />}>
        <Route path="/c1" element={<Outlet />}>
          <Route index element={<Navigate to="/c1/workers/dashboard" replace />} />
          <Route path="workers" element={<Outlet />}>
            <Route index element={<C1WorkersIndex />} />
            <Route path="dashboard" element={<WorkerDashboard />} />
            <Route path="assignments" element={<C1WorkerAssignments />} />
            <Route path="assignments/:assignmentId" element={<AssignmentDetails />} />
            <Route path="applications" element={<UserApplications />} />
            <Route path="applications/:applicationId" element={<UserApplications />} />
            <Route path="profile" element={<WorkerProfile />} />
            {/* Static profile sub-pages MUST precede the :section matcher. */}
            <Route path="profile/experience" element={<C1WorkerProfileExperience />} />
            <Route path="profile/about" element={<C1WorkerProfileAboutLegal />} />
            <Route path="profile/:section" element={<C1WorkerProfileSection />} />
            <Route path="my-employment" element={<C1WorkerMyEmployment />} />
            <Route path="my-employment/:employmentId" element={<C1WorkerMyEmploymentDetail />} />
            <Route path="screening" element={<C1WorkerScreening />} />
            <Route path="prescreen" element={<WorkerAiPrescreenPage />} />
            <Route path="find-work" element={<Navigate to="/c1/jobs-board" replace />} />
            <Route path="job-readiness" element={<Navigate to="/c1/workers/dashboard#home-readiness-summary" replace />} />
            <Route path="documents" element={<C1WorkerDocuments />} />
            <Route path="support" element={<WorkerSupport />} />
            <Route path="payroll-help" element={<C1WorkerPayrollHelp />} />
            <Route path="pay-history" element={<WorkerRoute><C1WorkerPayHistory /></WorkerRoute>} />
            <Route path="pay-history/:evereeTenantId/:statementId" element={<WorkerRoute><C1WorkerPayHistory /></WorkerRoute>} />
            <Route path="payroll-help/:ticketId" element={<C1WorkerPayrollHelp />} />
            <Route path="settings" element={<Navigate to="/c1/workers/profile/app-language" replace />} />
            <Route path="notifications" element={<C1WorkerNotifications />} />
            {/*
              BI.0 RECOVERY (PR #6 Fix C): the migration messaging push (4,402
              workers, May 8 2026) sent SMS deep links to /c1/workers/payroll
              for users who had Firestore docs but no Auth accounts. Without
              this guard the page rendered a static "Sign in to view payroll"
              with no CTA — workers bounced to /c1/apply (orphaning records)
              or gave up. WorkerRoute redirects unauthenticated visitors to
              /login with the deep link preserved in state.from, then Login.tsx
              honors that on successful auth (existing logic, ../pages/Login.tsx
              line 49-57). Workers and staff (level 5+) handled by WorkerRoute.
            */}
            {/* Earnings (P0 rename 2026-08-23) — old /payroll deep links redirect. */}
            <Route path="earnings" element={<WorkerRoute><WorkerPayrollIndex /></WorkerRoute>} />
            <Route path="earnings/:evereeTenantId" element={<WorkerRoute><WorkerPayrollEvereeTenant /></WorkerRoute>} />
            <Route path="payroll" element={<Navigate to="/c1/workers/earnings" replace />} />
            <Route path="payroll/:evereeTenantId" element={<WorkerPayrollLegacyRedirect />} />
            <Route path="inbox" element={<Navigate to="/c1/workers/notifications" replace />} />
            <Route path="inbox/:conversationId" element={<Navigate to="/c1/workers/notifications" replace />} />
          </Route>
          <Route path="jobs-board" element={<PublicJobsBoard />} />
          <Route path="jobs-board/:postId" element={<JobPostingDetail />} />
          <Route path="jobs/:postId" element={<JobPostingDetail />} />
          <Route path="applications" element={<Navigate to="/c1/workers/applications" replace />} />
          <Route path="assignments" element={<MyAssignments />} />
          <Route path="assignments/:assignmentId" element={<AssignmentDetails />} />
          <Route path="users/:uid/readiness" element={
            <ProtectedRoute requiredSecurityLevel="5">
              <UserReadinessPage />
            </ProtectedRoute>
          } />
          <Route path="users/:uid" element={<C1UserProfileOrRedirect />} />
        </Route>
        <Route path="/apply/:tenantSlug/:jobId?" element={<ApplyWizardPage />} />
      </Route>

      {/* Redirects and tenant-slug routes (same layout when logged in) */}
      <Route path="/jobs-board" element={<Navigate to="/c1/jobs-board" replace />} />
      <Route path="/applications" element={<Navigate to="/c1/workers/applications" replace />} />
      <Route path="/assignments" element={<Navigate to="/c1/workers/assignments" replace />} />
      <Route element={<ConditionalJobsBoardLayout />}>
        <Route path="/:tenantSlug/jobs-board/:postId" element={<JobPostingDetail />} />
        <Route path="/:tenantSlug/jobs/:postId" element={<JobPostingDetail />} />
        <Route path="/:tenantSlug/assignments/:assignmentId" element={<AssignmentDetails />} />
      </Route>
      
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomeRedirect />} />
        <Route path="dashboard" element={<DashboardAdminRedirect />} />
        <Route path="tasks" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <TasksPage />
          </ProtectedRoute>
        } />
        <Route path="task/:taskId" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <TaskDetailPage />
          </ProtectedRoute>
        } />
        <Route path="calendar" element={<CalendarAdminRedirect />} />
        <Route path="chatgpt" element={<ChatGPT />} />
        <Route path="inbox" element={
          <ProtectedRoute>
            <UserInboxPage />
          </ProtectedRoute>
        } />
        <Route path="text-messages" element={
          <ProtectedRoute>
            <TextMessagesPage />
          </ProtectedRoute>
        } />
        <Route path="slack" element={
          <SlackProtectedRoute>
            <SlackPage />
          </SlackProtectedRoute>
        } />
        <Route path="messages" element={
          <SlackProtectedRoute>
            <MessagesPage />
          </SlackProtectedRoute>
        } />
        <Route path="profile" element={<ProfileRedirect />} />

        {/* Admin/Manager only routes */}
        {/* TenantUsers route moved to /tenant/users to avoid conflict with /users */}
        <Route path="tenant/users" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <TenantUsers />
          </ProtectedRoute>
        } />
        <Route path="users/:uid/readiness" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <UserReadinessPage />
          </ProtectedRoute>
        } />
        <Route path="users/:uid" element={<C1UserProfileOrRedirect />} />
        <Route path="users/:uid/onboarding" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <UserOnboarding />
          </ProtectedRoute>
        } />
        <Route path="user/new" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <AddUserForm />
          </ProtectedRoute>
        } />
        <Route path="tenants" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <TenantsTable />
          </ProtectedRoute>
        } />
        <Route path="tenants/me" element={<MyTenantWrapper />} />
        <Route path="tenants/:uid/*" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <AgencyProfile />
          </ProtectedRoute>
        } />

        <Route path="flex" element={<TenantFlex />} />
        <Route path="jobs-dashboard" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <JobsBoardAccessGuard>
              <JobsBoard />
            </JobsBoardAccessGuard>
          </ProtectedRoute>
        } />
        <Route path="jobs-dashboard/edit/:postId" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <JobsBoardAccessGuard>
              <EditJobPost />
            </JobsBoardAccessGuard>
          </ProtectedRoute>
        } />
        
        <Route path="crm" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <CRMAccessGuard>
              <CRMCacheProvider>
                <TenantCRM />
              </CRMCacheProvider>
            </CRMAccessGuard>
          </ProtectedRoute>
        } />

        {/* Canonical navigation routes (avoid Contacts/Companies duplication across modules) */}
        <Route path="contacts" element={<ProtectedRoute requiredSecurityLevel="3"><ContactsPage /></ProtectedRoute>} />
        <Route
          path="contacts/:contactId"
          element={
            <ProtectedRoute requiredSecurityLevel="3">
              <CRMAccessGuard>
                <CRMCacheProvider>
                  <ContactDetails />
                </CRMCacheProvider>
              </CRMAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route path="companies" element={<ProtectedRoute requiredSecurityLevel="3"><CompaniesPage /></ProtectedRoute>} />
        <Route
          path="companies/:companyId"
          element={
            <ProtectedRoute requiredSecurityLevel="3">
              <CRMAccessGuard>
                <CRMCacheProvider>
                  <CompanyDetails />
                </CRMCacheProvider>
              </CRMAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="companies/:companyId/locations/:locationId"
          element={
            <ProtectedRoute requiredSecurityLevel="3">
              <CRMAccessGuard>
                <LocationDetails />
              </CRMAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="accounts"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <AccountsDashboard />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        >
          <Route index element={<RecruiterAccounts />} />
          <Route path="my" element={<RecruiterAccounts onlyMyAccounts />} />
        </Route>
        <Route path="my-accounts" element={<Navigate to="/accounts/my" replace />} />
        <Route
          path="reports/finances-budgeting"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <FinancesBudgetingPage />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        {/* Legacy URL — moved into the report library (Greg 2026-08-19). */}
        <Route path="finances-budgeting" element={<Navigate to="/reports/finances-budgeting" replace />} />
        <Route
          path="scheduling-health"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <SchedulingHealthPage />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="whos-working"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <WhosWorkingPage />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        {/* Report library: /reports is the index, each report lives at
            /reports/<slug> (registry: src/pages/reports/reportsRegistry.tsx). */}
        <Route
          path="payroll-tickets"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <PayrollTicketsPage />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="reports"
          element={
            <ProtectedRoute requiredSecurityLevel="6">
              <RecruiterAccessGuard>
                <ReportsIndexPage />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="reports/payroll"
          element={
            <ProtectedRoute requiredSecurityLevel="6">
              <RecruiterAccessGuard>
                <PayrollCostsPage report="payroll" />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="reports/workers-comp"
          element={
            <ProtectedRoute requiredSecurityLevel="6">
              <RecruiterAccessGuard>
                <PayrollCostsPage report="workers-comp" />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        {['i9-status', 'aca-lookback', 'tax-liability'].map((slug) => (
          <Route
            key={slug}
            path={`reports/${slug}`}
            element={
              <ProtectedRoute requiredSecurityLevel="6">
                <RecruiterAccessGuard>
                  {slug === 'i9-status' ? (
                    <I9StatusReportPage />
                  ) : slug === 'aca-lookback' ? (
                    <AcaLookbackReportPage />
                  ) : (
                    <TaxSickLeaveReportPage />
                  )}
                </RecruiterAccessGuard>
              </ProtectedRoute>
            }
          />
        ))}
        {(
          [
            ['wc-class-codes', WcClassCodesReportPage],
            ['wc-worksites', WcWorksitesReportPage],
            ['wc-8040', Wc8040ReportPage],
          ] as Array<[string, React.LazyExoticComponent<React.FC>]>
        ).map(([slug, Page]) => (
          <Route
            key={slug}
            path={`reports/${slug}`}
            element={
              <ProtectedRoute requiredSecurityLevel="6">
                <RecruiterAccessGuard>
                  <Page />
                </RecruiterAccessGuard>
              </ProtectedRoute>
            }
          />
        ))}
        <Route
          path="reports/wc-audit"
          element={
            <ProtectedRoute requiredSecurityLevel="6">
              <RecruiterAccessGuard>
                <WcAuditReportPage />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="reports/payroll-journal"
          element={
            <ProtectedRoute requiredSecurityLevel="6">
              <RecruiterAccessGuard>
                <PayrollJournalPage />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="reports/payroll-register"
          element={
            <ProtectedRoute requiredSecurityLevel="6">
              <RecruiterAccessGuard>
                <PayrollRegisterPage />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="reports/job-costing"
          element={
            <ProtectedRoute requiredSecurityLevel="7">
              <RecruiterAccessGuard>
                <GlobalInvoicingGuard>
                  <JobCostingReportPage />
                </GlobalInvoicingGuard>
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="reports/cash-flow"
          element={
            <ProtectedRoute requiredSecurityLevel="7">
              <RecruiterAccessGuard>
                <GlobalInvoicingGuard>
                  <CashFlowReportPage />
                </GlobalInvoicingGuard>
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="reports/qbo-classes"
          element={
            <ProtectedRoute requiredSecurityLevel="7">
              <RecruiterAccessGuard>
                <GlobalInvoicingGuard>
                  <QboClassesPage />
                </GlobalInvoicingGuard>
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="reports/gross-margin"
          element={
            <ProtectedRoute requiredSecurityLevel="7">
              <RecruiterAccessGuard>
                <GlobalInvoicingGuard>
                  <GrossMarginReportPage />
                </GlobalInvoicingGuard>
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="reports/accounts-receivable"
          element={
            <ProtectedRoute requiredSecurityLevel="7">
              <RecruiterAccessGuard>
                <GlobalInvoicingGuard>
                  <ArAgingReportPage />
                </GlobalInvoicingGuard>
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        {/* Legacy URL — bookmarks/links keep working. */}
        <Route path="payroll-costs" element={<Navigate to="/reports/payroll" replace />} />
        <Route
          path="screenings-queue"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <Navigate to="/staff-onboarding?tab=background" replace />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="staff-onboarding"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <StaffOnboardingCenter />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="invoicing"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <GlobalInvoicingGuard>
                  <GlobalInvoicingPage />
                </GlobalInvoicingGuard>
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="workers-comp"
          element={<Navigate to="/settings?tab=workers-comp" replace />}
        />
        <Route
          path="accounts/:accountId"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <InvoicingTabGuard>
                  <RecruiterAccountDetails />
                </InvoicingTabGuard>
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="accounts/:accountId/locations/:locationId"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <AccountLocationDetail />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
        {/* Legacy account detail path -> canonical /accounts/:accountId */}
        <Route
          path="recruiter/accounts/:accountId"
          element={<RecruiterAccountDetailsRedirect />}
        />
        <Route path="users" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <RecruiterAccessGuard>
              <UsersLayout />
            </RecruiterAccessGuard>
          </ProtectedRoute>
        }>
          <Route index element={<UsersHubIndexRedirect />} />
          <Route path="all" element={<RecruiterUsers hideHeader scope="all" />} />
          <Route path="my" element={<RecruiterUsers hideHeader scope="my" />} />
          <Route path="invite-users" element={<InviteUsersPage hideHeader />} />
          <Route path="user-groups" element={<TenantUserGroups hideHeader />} />
          <Route path="my-user-groups" element={<TenantUserGroups hideHeader scope="mine" />} />
          <Route path="smart-groups" element={<SmartGroupsPage hideHeader />} />
          <Route path="all-smart-groups" element={<AllSmartGroupsPage hideHeader />} />
          <Route path="my-smart-groups" element={<MySmartGroupsListPage hideHeader />} />
          <Route path="my-smart-groups/:groupId" element={<SavedSmartGroupDetailPage hideHeader />} />
          <Route path="deletion-requests" element={<DeletionRequestsPage />} />
          <Route path="phone-changes" element={<PhoneChangeRequestsPage />} />
          <Route path=":uid/readiness" element={<UserReadinessPage />} />
          <Route path=":uid" element={<UserProfile />} />
        </Route>

        {/* Compliance policy reference (v1.1) — staff-only, opened in a new
            tab from the Backgrounds tab and the adjudication case panel. */}
        <Route path="compliance/background-check-policy" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <RecruiterAccessGuard>
              <BackgroundCheckPolicyPage />
            </RecruiterAccessGuard>
          </ProtectedRoute>
        } />

        {/* Legacy CRM companies URLs → canonical /companies/... */}
        <Route path="crm/companies/*" element={<CrmCompaniesRedirect />} />
        <Route path="crm/companies/:companyId" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <CRMAccessGuard>
              <CRMCacheProvider>
                <CompanyDetails />
              </CRMCacheProvider>
            </CRMAccessGuard>
          </ProtectedRoute>
        } />
        <Route path="crm/contacts/:contactId" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <CRMAccessGuard>
              <ContactDetails />
            </CRMAccessGuard>
          </ProtectedRoute>
        } />
        <Route path="tenant/salesperson/:salespersonId" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <TenantSalesperson />
          </ProtectedRoute>
        } />
        <Route path="crm/deals/:dealId" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <CRMAccessGuard>
              <DealDetails />
            </CRMAccessGuard>
          </ProtectedRoute>
        } />
        <Route path="crm/companies/:companyId/locations/:locationId" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <CRMAccessGuard>
              <LocationDetails />
            </CRMAccessGuard>
          </ProtectedRoute>
        } />
        <Route path="workforce" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <Navigate to="/workforce/company-directory" replace />
          </ProtectedRoute>
        } />
        <Route path="workforce/company-directory" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <WorkforceDashboard />
          </ProtectedRoute>
        } />
        <Route path="workforce/add-workers" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <WorkforceDashboard />
          </ProtectedRoute>
        } />
        <Route path="workforce/pending-invites" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <WorkforceDashboard />
          </ProtectedRoute>
        } />
        <Route path="workforce/integrations" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <WorkforceDashboard />
          </ProtectedRoute>
        } />
        <Route path="workforce/users/:uid/readiness" element={<UserReadinessPage />} />
        <Route path="workforce/users/:uid" element={<UserProfile />} />
        <Route path="customers" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <Customers />
          </ProtectedRoute>
        } />
        <Route path="settings" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <SettingsLanding />
          </ProtectedRoute>
        } />
        <Route path="settings/company-setup" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <CompanySetup />
          </ProtectedRoute>
        } />
        <Route path="settings/messaging" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <MessagingTabWrapper />
          </ProtectedRoute>
        } />
        <Route path="settings/senders" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <SenderManagementPage />
          </ProtectedRoute>
        } />
        <Route path="company-defaults" element={
          <ProtectedRoute requiredSecurityLevel="6">
            <CompanyDefaults />
          </ProtectedRoute>
        } />
        <Route path="locations" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <TenantLocations />
          </ProtectedRoute>
        } />
        <Route path="usergroups" element={<Navigate to="/users/user-groups" replace />} />
        <Route path="usergroups/:groupId" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <UserGroupDetailsWrapper />
          </ProtectedRoute>
        } />
        <Route
          path="tenants/:tenantId/userGroups/:groupId"
          element={
            <ProtectedRoute requiredSecurityLevel="4">
              <UserGroupDetailsWrapper />
            </ProtectedRoute>
          }
        />

        <Route path="reports" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <Reports />
          </ProtectedRoute>
        } />
        {/* HRX Admin only routes */}
        <Route path="admin/ai-context" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <AIContextDashboard />
          </ProtectedRoute>
        } />
        <Route path="admin/modules" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <ModulesDashboard />
          </ProtectedRoute>
        } />
        <Route path="admin/ai" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <AILaunchpad />
          </ProtectedRoute>
        } />
        <Route path="admin/ai-analytics" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <AIAnalytics />
          </ProtectedRoute>
        } />
        <Route path="admin/associations" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <AssociationsAdmin />
          </ProtectedRoute>
        } />
        <Route path="admin/ai/traits" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <TraitsEngine />
          </ProtectedRoute>
        } />
        <Route path="admin/ai/tone" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <ToneSettings />
          </ProtectedRoute>
        } />
        <Route path="admin/ai/moments" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <MomentsEngine />
          </ProtectedRoute>
        } />
        <Route path="admin/ai/scheduled-moments" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <ScheduledMomentsDashboard />
          </ProtectedRoute>
        } />
        <Route path="admin/ai/notifications" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <NotificationsTable />
          </ProtectedRoute>
        } />
        <Route
          path="admin/feedback-engine"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <FeedbackEngine />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/ai/customer-tone-overrides"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <CustomerToneOverrides />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/ai/weights"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <WeightsEngine />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/ai/context"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <ContextEngine />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/ai/logs"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <AILogs />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/data-operations"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <DataOperations />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/slack"
          element={
            <SlackProtectedRoute>
              <SlackAdminPage />
            </SlackProtectedRoute>
          }
        />
        <Route
          path="admin/ai/retrieval-filters"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RetrievalFilters />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/ai/vector-settings"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <VectorSettings />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/ai-campaigns"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <AICampaigns />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/ai/auto-context-engine"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <AutoContextEngine />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/ai/devops"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <AutoDevOps />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/ai-chat"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <AIChat />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/broadcast"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <Broadcast />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/broadcast-management"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <BroadcastManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/translation-management"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <TranslationManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/user-language-preferences"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <UserLanguagePreferences />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/hello-message-management"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <HelloMessageManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/auto-context-engine"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <AutoContextEngineNew />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/ai-self-improvement"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <AISelfImprovement />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/help"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <HelpManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/job-satisfaction-insights"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <JobSatisfactionInsights />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/jsi-documentation"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <JSIDocumentation />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/daily-motivation"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <DailyMotivation />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/log-coverage"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <LogCoverageDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/autodevops-monitoring"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <AutoDevOpsMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/autodevops-pipeline"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <AutoDevOpsPipeline />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/motivation-seeder"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <MotivationLibrarySeeder />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/hello-message-config"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <HelloMessageConfig />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/mobile-app-errors"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <MobileAppErrors />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/ai-feedback"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <AIFeedbackDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="help" element={<Help />} />
        <Route path="modules" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <TenantModules />
          </ProtectedRoute>
        } />
        <Route path="aisettings" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <TenantAISettings />
          </ProtectedRoute>
        } />
        <Route path="resume" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <ResumeManagement />
          </ProtectedRoute>
        } />
        <Route path="/campaigns" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <AICampaigns />
          </ProtectedRoute>
        } />
        <Route path="/broadcasts" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <Broadcast />
          </ProtectedRoute>
        } />
        
        {/* HRX Module routes for tenants */}
        <Route path="flex-settings" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <FlexSettings />
          </ProtectedRoute>
        } />
        <Route path="recruiter" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <RecruiterAccessGuard>
              <RecruiterDashboard />
            </RecruiterAccessGuard>
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/jobs/job-orders" replace />} />
          <Route path="accounts" element={<RecruiterAccountsRedirect />} />
          <Route path="my-accounts" element={<RecruiterMyAccountsRedirect />} />
          <Route path="job-orders/*" element={<JobsRedirect />} />
          <Route path="my-orders" element={<Navigate to="/jobs/my-orders" replace />} />
          <Route path="users" element={<Navigate to="/users" replace />} />
          <Route path="users/:uid" element={<UsersRedirect />} />
          <Route path="applicants" element={<RecruiterApplicants />} />
          <Route path="smartgroups" element={<Navigate to="/users/smart-groups" replace />} />
          {/* Redirect all recruiter/companies/... to canonical /companies/... */}
          <Route path="companies/*" element={<RecruiterCompaniesRedirect />} />
          {/* Redirect all recruiter/contacts/... to canonical /contacts/... */}
          <Route path="contacts/*" element={<RecruiterContactsRedirect />} />
          <Route path="user-groups" element={<RecruiterUserGroups />} />
          <Route path="user-groups/:groupId" element={<RecruiterUserGroupDetails />} />
          <Route path="jobs-board/*" element={<JobsRedirect />} />
          <Route path="reports" element={<Navigate to="/jobs/reports" replace />} />
        </Route>
        <Route path="jobs" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <RecruiterAccessGuard>
              <RecruiterDashboard />
            </RecruiterAccessGuard>
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/jobs/job-orders" replace />} />
          <Route path="job-orders" element={<RecruiterJobOrders />} />
          <Route path="my-orders" element={<RecruiterJobOrders />} />
          {/* Phase 1 readiness: legacy recruiter action queue, replaced by
              Phase D Workforce. Redirect at route level so the navigation
              happens before any component mounts. The deprecated
              `RecruiterMyQueue` component itself also Navigates as a safety
              net for direct imports — both paths can be removed in the
              cleanup PR after one release with no traffic on either. */}
          <Route path="my-queue" element={<Navigate to="/readiness/employee-readiness" replace />} />
          <Route path="onboarding" element={<Navigate to="/jobs/job-orders" replace />} />
          <Route path="job-orders/new" element={<NewJobOrder />} />
          <Route path="job-orders/:jobOrderId" element={<DeferredMount><RecruiterJobOrderDetail /></DeferredMount>} />
          <Route path="jobs-board" element={
            <JobsBoardAccessGuard>
              <JobsBoard />
            </JobsBoardAccessGuard>
          } />
          <Route path="jobs-board/edit/:postId" element={
            <JobsBoardAccessGuard>
              <EditJobPost />
            </JobsBoardAccessGuard>
          } />
          <Route path="reports" element={
            <Box>
              <Typography variant="h6">Reports</Typography>
              <Typography variant="body2" color="text.secondary">
                Reports content coming soon...
              </Typography>
            </Box>
          } />
        </Route>
        {/* TODO: Create RecruiterApplications component */}
        {/* <Route path="recruiter/applications" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <RecruiterApplications />
          </ProtectedRoute>
        } /> */}

        {/* Shifts — cross-job-order shift dashboard. Mirrors the /jobs Outlet
            pattern: a parent layout with tabbed nav and an Outlet for the
            active tab. Sec 5+ only (matches the sidebar gate). */}
        <Route path="shifts" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <Shifts />
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/shifts/list" replace />} />
          <Route path="list" element={<ShiftsList />} />
          <Route path="calendar" element={<ShiftsCalendar />} />
          <Route path="log" element={<ShiftsLog />} />
          {/* Legacy `/shifts/active` URL — kept as a redirect to the new
              `/shifts/list` view. The Active tab was the original v1 of
              this dashboard before the List/Calendar split. Safe to drop
              after one release with no traffic on /active. */}
          <Route path="active" element={<Navigate to="/shifts/list" replace />} />
        </Route>

        {/* Timesheets — top-level recruiter/admin timesheet workspace.
            P1.A ships the route + page shell only; the inline-editable
            grid, filter bar, totals header, and Everee batch submission
            arrive in TS.1.P1.C and onwards. Sec 5+ matches the sidebar
            gate in `menuGenerator.ts`. */}
        <Route path="timesheets" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <Timesheets />
          </ProtectedRoute>
        } />

        {/* Workforce — Phase D CSA workspace.
            Same Outlet pattern as /shifts: parent layout with two pill tabs
            and an Outlet for the active tab. Sec 5+ only (matches the
            sidebar gate in menuGenerator.ts).
            URL prefix is /readiness (NOT /workforce) because /workforce/*
            was already in use for the tenant company directory
            (WorkforceDashboard). The user-facing nav label stays "Workforce"
            per the spec naming-lock — see Workforce.tsx header for the
            rationale. */}
        <Route path="readiness" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <Workforce />
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/readiness/employee-readiness" replace />} />
          <Route path="employee-readiness" element={<WorkforceEmployeeReadiness />} />
          <Route path="job-readiness" element={<WorkforceJobReadiness />} />
          {/* D.4 sub-route stub. The Job Readiness detail surface is a
              full-page sub-route per Greg's 2026-04-25 D.1 answer
              (jo_readiness_detail = sub_route). D.4 swaps this stub for the
              real <WorkforceJobReadinessDetail /> page. */}
          <Route path="job-readiness/:jobOrderId" element={<WorkforceJobReadiness />} />
          {/* 2026-05-26 — I-9 Signatures Needed tab. Promoted from a
              section on /readiness/employee-readiness (commit def18be4)
              to its own page so the Section 2 workflow has room to
              scale (filters, deadline countdowns, bulk-complete). */}
          <Route path="i9-signatures" element={<WorkforceI9Signatures />} />
        </Route>


        <Route path="recruiter-settings" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <RecruiterSettings />
          </ProtectedRoute>
        } />
        <Route path="insight-reports" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <InsightReports />
          </ProtectedRoute>
        } />
        
        {/* Worker-specific routes */}
        <Route path="mobile-app" element={<MobileApp />} />
        <Route
          path="privacy-settings"
          element={
            <ProtectedRoute>
              <PrivacySettingsAdminShellGate>
                <PrivacySettings />
              </PrivacySettingsAdminShellGate>
            </ProtectedRoute>
          }
        />
        {/* Recruiter hub links (e.g. profile Assignments tab) use /assignments/:id — must be before static /assignments */}
        <Route
          path="assignments/:assignmentId"
          element={
            <ProtectedRoute>
              <AssignmentDetails />
            </ProtectedRoute>
          }
        />
        <Route path="assignments" element={<WorkerAssignments />} />
      </Route>

      {/* Catch-all: any unmatched URL (typos, stale links) previously
          rendered a blank page since no route matched. Redirect to `/`,
          which routes by auth — HomeRedirect sends signed-in users to their
          home (admin → /dashboard, worker → /profile) and unauthenticated
          users to /login. React Router ranks `*` lowest, so this never
          shadows a real route. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  return (
    <Box sx={{ backgroundColor: 'rgb(247, 248, 251)', minHeight: '100vh' }}>
      <Router>
        <PageViewTracker />
        <NavigationWatchdog />
        <AuthProvider>
          <DirectMessengerProvider>
            <ChatGPTProvider>
              <AssociationsCacheProvider>
                <SalespeopleProvider>
                  {googleMapsApiKey ? (
                    <LoadScript
                      id="script-loader"
                      googleMapsApiKey={googleMapsApiKey}
                      libraries={googleMapsLibraries}
                      loadingElement={<div style={{ position: 'absolute', left: -9999 }}>Loading maps...</div>}
                    >
                      <div style={{ display: 'none' }} aria-hidden="true" />
                    </LoadScript>
                  ) : null}
                  {/* All page components are lazy — this boundary shows while a
                      route chunk downloads (pages were eager before, which put
                      the ENTIRE admin app in main.js: 3.2MB gz → 45s blank on
                      worker phones). */}
                  <Suspense
                    fallback={
                      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                        <CircularProgress />
                      </Box>
                    }
                  >
                    {routes}
                  </Suspense>
                </SalespeopleProvider>
              </AssociationsCacheProvider>
            </ChatGPTProvider>
          </DirectMessengerProvider>
        </AuthProvider>
      </Router>
      {/* Dev-only cert shadow stats (reads `cert_engine_shadow_events`; requires isHRX in firestore.rules). Re-enable when needed.
      {process.env.NODE_ENV === 'development' && CertEngineShadowDebugPanel && (
        <Suspense fallback={null}>
          <CertEngineShadowDebugPanel />
        </Suspense>
      )}
      */}
    </Box>
  );
}

export default App;
