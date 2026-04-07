import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useNavigate, useLocation, useSearchParams, Navigate, Outlet } from 'react-router-dom';
import { LoadScript, Libraries } from '@react-google-maps/api';
import { logger } from './utils/logger';
import { getUsersIndexRedirectPath } from './utils/usersLayoutPersistence';

import Layout from './components/Layout';
import ConditionalJobsBoardLayout from './components/ConditionalJobsBoardLayout';
import ConditionalWorkerLayout from './components/ConditionalWorkerLayout';
import PageViewTracker from './components/PageViewTracker';
import Dashboard from './pages/Dashboard';
import CalendarPage from './pages/CalendarPage';
import TasksPage from './pages/TasksPage';
import TaskDetailPage from './pages/TaskDetailPage';
import AIDashboard from './pages/TenantViews/AIDashboard';
import ChatGPT from './pages/TenantViews/ChatGPT';
import UserProfile from './pages/UserProfile';
import UserReadinessPage from './pages/UserReadinessPage';
import Login from './pages/Login';
import UserOnboarding from './pages/UserOnboarding';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { canAccessAccountInvoicingTab, canAccessGlobalInvoicing } from './utils/invoicingAccessControl';
import { AssociationsCacheProvider } from './contexts/AssociationsCacheContext';
import { CRMCacheProvider } from './contexts/CRMCacheContext';
import { SalespeopleProvider } from './contexts/SalespeopleContext';
import { DirectMessengerProvider } from './contexts/DirectMessengerContext';
import { ChatGPTProvider } from './contexts/ChatGPTContext';
import ProtectedRoute from './components/ProtectedRoute';
import SlackProtectedRoute from './components/SlackProtectedRoute';
import { Box, Typography } from '@mui/material';
import TenantsTable from './pages/Admin/TenantsTable';
import AgencyProfile from './pages/AgencyProfile';
import TenantWorkforce from './pages/TenantViews/TenantWorkforce';
import WorkforceDashboard from './pages/TenantViews/WorkforceDashboard';
import CompanyDirectory from './pages/TenantViews/CompanyDirectory';
import AddWorkers from './pages/TenantViews/AddWorkers';
import PendingInvites from './pages/TenantViews/PendingInvites';
import WorkforcePageWrapper from './pages/TenantViews/WorkforcePageWrapper';
import TenantSettings from './pages/TenantViews/TenantSettings';
import SettingsLanding from './pages/TenantViews/SettingsLanding';
import CompanySetup from './pages/TenantViews/CompanySetup';
import MessagingTab from './pages/TenantViews/MessagingTab';
import SenderManagementPage from './pages/TenantViews/SenderManagementPage';
import CompanyDefaults from './pages/TenantViews/CompanyDefaults';
import TenantLocations from './pages/TenantViews/TenantLocations';
import TenantUserGroups from './pages/TenantViews/TenantUserGroups';
import IntegrationsTab from './pages/TenantViews/IntegrationsTab';
import TenantModules from './pages/TenantViews/TenantModules';
import TenantAISettings from './pages/TenantViews/TenantAISettings';
import TenantFlex from './pages/TenantViews/TenantFlex';
import JobsBoard from './pages/TenantViews/JobsBoard';
import EditJobPost from './pages/TenantViews/EditJobPost';
import PublicJobsBoard from './pages/PublicJobsBoard';
import JobPostingDetail from './pages/JobPostingDetail';
import ApplyWizardPage from './pages/ApplyWizardPage';
import UserApplications from './pages/UserApplications';
import MyAssignments from './pages/MyAssignments';
import AssignmentDetails from './pages/AssignmentDetails';
import Communications from './pages/Communications';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import SMSPrivacy from './pages/SMSPrivacy';
import SignerPage from './pages/SignerPage';
import Apply from './pages/Apply';
import TenantCRM from './pages/TenantViews/TenantCRM';
import PublicCRMView from './pages/PublicCRMView';
import CompanyDetails from './pages/TenantViews/CompanyDetails';
import ContactDetails from './pages/TenantViews/ContactDetails';
import DealDetails from './pages/TenantViews/DealDetails';
import TenantSalesperson from './pages/TenantViews/TenantSalesperson';
import LocationDetails from './pages/TenantViews/LocationDetails';
import TenantUsers from './pages/TenantViews/TenantUsers';
import AddUserForm from './pages/AddUserForm';
import Customers from './pages/Customers';
import UserGroupDetails from './pages/AgencyProfile/components/UserGroupDetails';
import AIContextDashboard from './pages/Admin/AIContextDashboard';
import ModulesDashboard from './pages/Admin/ModulesDashboard';
import AILaunchpad from './pages/Admin/AILaunchpad';
import TraitsEngine from './pages/Admin/TraitsEngine';
import ToneSettings from './pages/Admin/ToneSettings';
import MomentsEngine from './pages/Admin/MomentsEngine';
import AICampaigns from './pages/Admin/AICampaigns';
import ScheduledMomentsDashboard from './pages/Admin/ScheduledMomentsDashboard';
import NotificationsTable from './pages/Admin/NotificationsTable';
import FeedbackEngine from './pages/Admin/FeedbackEngine';
import CustomerToneOverrides from './pages/Admin/CustomerToneOverrides';
import WeightsEngine from './pages/Admin/WeightsEngine';
import ContextEngine from './pages/Admin/ContextEngine';
import AILogs from './pages/Admin/AILogs';
import RetrievalFilters from './pages/Admin/RetrievalFilters';
import VectorSettings from './pages/Admin/VectorSettings';
import AutoContextEngine from './pages/Admin/AutoContextEngine';
import AutoDevOps from './pages/Admin/AutoDevOps';
import AIChat from './pages/Admin/AIChat';
import Broadcast from './pages/Admin/Broadcast';
import BroadcastManagement from './pages/Admin/BroadcastManagement';
import TranslationManagement from './pages/Admin/TranslationManagement';
import UserLanguagePreferences from './pages/Admin/UserLanguagePreferences';
import HelloMessageManagement from './pages/Admin/HelloMessageManagement';
import AutoContextEngineNew from './pages/Admin/AutoContextEngine';
import AISelfImprovement from './pages/Admin/AISelfImprovement';
import InviteTokenValidator from './components/InviteTokenValidator';
import WorkerRoute from './auth/WorkerRoute';
import C1WorkerLayout from './layouts/C1WorkerLayout';
import C1WorkersIndex from './pages/c1/workers/index';
import C1WorkerDashboard from './pages/c1/workers/dashboard';
import C1WorkerAssignments from './pages/c1/workers/assignments';
import C1WorkerProfile from './pages/c1/workers/profile';
import C1WorkerProfileSection from './pages/c1/workers/profileSection';
import C1WorkerMyEmployment from './pages/c1/workers/myEmployment';
import C1WorkerMyEmploymentDetail from './pages/c1/workers/myEmploymentDetail';
import C1WorkerScreening from './pages/c1/workers/screening';
import C1WorkerSupport from './pages/c1/workers/support';
import C1WorkerNotifications from './pages/c1/workers/notifications';
import OnboardingProfileForm from './components/OnboardingProfileForm';
import OnboardingCompleteScreen from './components/OnboardingCompleteScreen';
import Help from './pages/Help';
import HelpManagement from './pages/Admin/HelpManagement';
import DataOperations from './pages/Admin/DataOperations';
import JobSatisfactionInsights from './pages/Admin/JobSatisfactionInsights';
import JSIDocumentation from './pages/Admin/JSIDocumentation';
import DailyMotivation from './pages/Admin/DailyMotivation';
import LogCoverageDashboard from './pages/Admin/LogCoverageDashboard';
import AutoDevOpsMonitoring from './pages/Admin/AutoDevOpsMonitoring';
import AutoDevOpsPipeline from './pages/Admin/AutoDevOpsPipeline';
import MotivationLibrarySeeder from './pages/Admin/MotivationLibrarySeeder';
import HelloMessageConfig from './pages/Admin/HelloMessageConfig';
import SlackAdminPage from './pages/Admin/SlackAdminPage';
import MobileAppErrors from './pages/Admin/MobileAppErrors';
import ResumeManagement from './pages/ResumeManagement';
import Reports from './pages/Reports';
import AIAnalytics from './pages/Admin/AIAnalytics';
import AIFeedbackDashboard from './pages/Admin/AIFeedbackDashboard';
import AssociationsAdmin from './pages/Admin/AssociationsAdmin';
import SetupPassword from './pages/SetupPassword';
import MobileApp from './pages/MobileApp';
import PrivacySettings from './pages/PrivacySettings';
import WorkerAssignments from './pages/WorkerAssignments';
import FlexSettings from './pages/FlexSettings';
import RecruiterSettings from './pages/RecruiterSettings';
import RecruiterDashboard from './pages/RecruiterDashboard';
import AccountsDashboard from './pages/AccountsDashboard';
import RecruiterMain from './pages/RecruiterMain';
import RecruiterJobOrders from './pages/RecruiterJobOrders';
import RecruiterAccounts from './pages/RecruiterAccounts';
import RecruiterJobOrderDetail from './pages/RecruiterJobOrderDetail';
import RecruiterApplicants from './pages/RecruiterApplicants';
import SmartGroupsPage from './pages/SmartGroupsPage';
import AllSmartGroupsPage from './pages/AllSmartGroupsPage';
import MySmartGroupsListPage from './pages/MySmartGroupsListPage';
import InviteUsersPage from './pages/InviteUsersPage';
import SavedSmartGroupDetailPage from './pages/SavedSmartGroupDetailPage';
import RecruiterUsers from './pages/RecruiterUsers';
import UsersLayout from './pages/UsersLayout';
import RecruiterAccountDetails from './pages/RecruiterAccountDetails';
import AccountLocationDetail from './pages/AccountLocationDetail';
import GlobalInvoicingPage from './pages/GlobalInvoicingPage';
import FinancesBudgetingPage from './pages/FinancesBudgetingPage';
import StaffOnboardingCenter from './pages/StaffOnboardingCenter';
import WorkersCompRatesPage from './pages/TenantViews/settings/WorkersCompRatesPage';
import RecruiterContacts from './pages/RecruiterContacts';
import RecruiterContactDetails from './pages/RecruiterContactDetails';
import NewJobOrder from './pages/NewJobOrder';
import RecruiterUserGroups from './pages/RecruiterUserGroups';
import RecruiterUserGroupDetails from './pages/RecruiterUserGroupDetails';
import UserInboxPage from './pages/UserInboxPage';
import MessagesPage from './pages/MessagesPage';
import TextMessagesPage from './pages/TextMessagesPage';
import SlackPage from './pages/SlackPage';
import ContactsPage from './pages/ContactsPage';
import CompaniesPage from './pages/CompaniesPage';

import InsightReports from './pages/InsightReports';

// Read the Google Maps API key from environment variables
const googleMapsApiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';

// C1 worker pages: use same names as default exports to avoid TS "Cannot find name" when referenced in routes
const WorkerDashboard = C1WorkerDashboard;
const WorkerProfile = C1WorkerProfile;
const WorkerSupport = C1WorkerSupport;

// Static libraries array to prevent performance warnings (shared across app)
const googleMapsLibraries: Libraries = ['places', 'maps'];

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

/** For /c1/users/:uid: workers (securityLevel null or 0–4) go to My Profile; higher levels see UserProfile. */
function C1UserProfileOrRedirect() {
  const { user, securityLevel } = useAuth();
  const level = securityLevel != null ? Number.parseInt(String(securityLevel), 10) : 0;
  const isWorker = Number.isNaN(level) || level <= 4;
  if (user && isWorker) {
    return <Navigate to="/c1/workers/profile" replace />;
  }
  return <UserProfile />;
}

function RecruiterUserGroupsRedirect() {
  const { groupId } = useParams();
  return <Navigate to={`/usergroups/${groupId}`} replace />;
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
      <Route path="/login" element={<Login />} />
      <Route path="/crm/public" element={<PublicCRMView />} />
      <Route path="/setup-password" element={<SetupPassword />} />
      <Route path="/invite/:token" element={<InviteTokenValidator />} />
      <Route path="/onboarding/profile" element={<OnboardingProfileForm />} />
      <Route path="/onboarding/complete" element={<OnboardingCompleteScreen />} />
      <Route path="/c1/apply" element={<Apply />} />
      <Route path="/c1/apply/group/:groupId" element={<Apply />} />
      <Route path="/consent" element={<Communications />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/sms-privacy" element={<SMSPrivacy />} />
      {/* HRX Signatures — signer page (works in Web + Flutter webview) */}
      <Route path="/sign/s/:sessionId" element={
        <ProtectedRoute>
          <SignerPage />
        </ProtectedRoute>
      } />

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
            <Route path="profile/:section" element={<C1WorkerProfileSection />} />
            <Route path="my-employment" element={<C1WorkerMyEmployment />} />
            <Route path="my-employment/:employmentId" element={<C1WorkerMyEmploymentDetail />} />
            <Route path="screening" element={<C1WorkerScreening />} />
            <Route path="find-work" element={<Navigate to="/c1/jobs-board" replace />} />
            <Route path="job-readiness" element={<Navigate to="/c1/workers/dashboard#home-readiness-summary" replace />} />
            <Route path="documents" element={<Navigate to="/c1/workers/profile" replace />} />
            <Route path="support" element={<WorkerSupport />} />
            <Route path="settings" element={<Navigate to="/c1/workers/profile/app-language" replace />} />
            <Route path="notifications" element={<C1WorkerNotifications />} />
            <Route path="inbox" element={<Navigate to="/c1/workers/notifications" replace />} />
            <Route path="inbox/:conversationId" element={<Navigate to="/c1/workers/notifications" replace />} />
          </Route>
          <Route path="jobs-board" element={<PublicJobsBoard />} />
          <Route path="jobs-board/:postId" element={<JobPostingDetail />} />
          <Route path="jobs/:postId" element={<JobPostingDetail />} />
          <Route path="applications" element={<Navigate to="/c1/workers/applications" replace />} />
          <Route path="assignments" element={<MyAssignments />} />
          <Route path="assignments/:assignmentId" element={<AssignmentDetails />} />
          <Route path="users/:uid/readiness" element={<UserReadinessPage />} />
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
        <Route path="users/:uid/readiness" element={<UserReadinessPage />} />
        <Route path="users/:uid" element={<UserProfile />} />
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
          path="finances-budgeting"
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <FinancesBudgetingPage />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
        />
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
          element={
            <ProtectedRoute requiredSecurityLevel="5">
              <RecruiterAccessGuard>
                <WorkersCompRatesPage />
              </RecruiterAccessGuard>
            </ProtectedRoute>
          }
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
          <Route path="smart-groups" element={<SmartGroupsPage hideHeader />} />
          <Route path="all-smart-groups" element={<AllSmartGroupsPage hideHeader />} />
          <Route path="my-smart-groups" element={<MySmartGroupsListPage hideHeader />} />
          <Route path="my-smart-groups/:groupId" element={<SavedSmartGroupDetailPage hideHeader />} />
          <Route path=":uid/readiness" element={<UserReadinessPage />} />
          <Route path=":uid" element={<UserProfile />} />
        </Route>

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
          {/* User Groups moved to main menu; keep recruiter routes as redirects */}
          <Route path="user-groups" element={<Navigate to="/usergroups" replace />} />
          <Route path="user-groups/:groupId" element={<RecruiterUserGroupsRedirect />} />
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
          <Route path="onboarding" element={<Navigate to="/jobs/job-orders" replace />} />
          <Route path="job-orders/new" element={<NewJobOrder />} />
          <Route path="job-orders/:jobOrderId" element={<RecruiterJobOrderDetail />} />
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
        <Route path="privacy-settings" element={
          <ProtectedRoute requiredSecurityLevel="5">
            <PrivacySettings />
          </ProtectedRoute>
        } />
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
    </Routes>
  );

  return (
    <Box sx={{ backgroundColor: 'rgb(247, 248, 251)', minHeight: '100vh' }}>
      <Router>
        <PageViewTracker />
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
                  {routes}
                </SalespeopleProvider>
              </AssociationsCacheProvider>
            </ChatGPTProvider>
          </DirectMessengerProvider>
        </AuthProvider>
      </Router>
    </Box>
  );
}

export default App;
