import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { LoadScript, Libraries } from '@react-google-maps/api';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import UsersTable from './pages/UsersTable';
import UserProfile from './pages/UserProfile';
import Login from './pages/Login';
import UserOnboarding from './pages/UserOnboarding';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AssociationsCacheProvider } from './contexts/AssociationsCacheContext';
import ProtectedRoute from './components/ProtectedRoute';
import TenantsTable from './pages/Admin/TenantsTable';
import AgencyProfile from './pages/AgencyProfile';

import TenantWorkforce from './pages/TenantViews/TenantWorkforce';
import TenantSettings from './pages/TenantViews/TenantSettings';
import TenantLocations from './pages/TenantViews/TenantLocations';
import TenantUserGroups from './pages/TenantViews/TenantUserGroups';
import TenantAssignments from './pages/TenantViews/TenantAssignments';
import TenantModules from './pages/TenantViews/TenantModules';
import TenantAISettings from './pages/TenantViews/TenantAISettings';
import TenantFlex from './pages/TenantViews/TenantFlex';
import JobsBoard from './pages/TenantViews/JobsBoard';
import TenantCRM from './pages/TenantViews/TenantCRM';
import CompanyDetails from './pages/TenantViews/CompanyDetails';
import ContactDetails from './pages/TenantViews/ContactDetails';
import DealDetails from './pages/TenantViews/DealDetails';
import TenantSalesperson from './pages/TenantViews/TenantSalesperson';
import LocationDetails from './pages/TenantViews/LocationDetails';
import TenantUsers from './pages/TenantViews/TenantUsers';
import AddUserForm from './pages/AddUserForm';
import Customers from './pages/Customers';
import CustomerProfile from './pages/CustomerProfile';
import AddCustomerForm from './pages/CustomerProfile/AddCustomerForm';
import UserGroupDetails from './pages/AgencyProfile/components/UserGroupDetails';

import AIContextDashboard from './pages/Admin/AIContextDashboard';
import ModulesDashboard from './pages/Admin/ModulesDashboard';
import CustomerDetails from './pages/AgencyProfile/CustomerDetails';
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
import OnboardingProfileForm from './components/OnboardingProfileForm';
import OnboardingCompleteScreen from './components/OnboardingCompleteScreen';
import Help from './pages/Help';
import HelpManagement from './pages/Admin/HelpManagement';
import JobSatisfactionInsights from './pages/Admin/JobSatisfactionInsights';
import JSIDocumentation from './pages/Admin/JSIDocumentation';
import DailyMotivation from './pages/Admin/DailyMotivation';
import LogCoverageDashboard from './pages/Admin/LogCoverageDashboard';
import AutoDevOpsMonitoring from './pages/Admin/AutoDevOpsMonitoring';
import AutoDevOpsPipeline from './pages/Admin/AutoDevOpsPipeline';
import MotivationLibrarySeeder from './pages/Admin/MotivationLibrarySeeder';
import HelloMessageConfig from './pages/Admin/HelloMessageConfig';
import MobileAppErrors from './pages/Admin/MobileAppErrors';
import ResumeManagement from './pages/ResumeManagement';
import Reports from './pages/Reports';
import AIAnalytics from './pages/Admin/AIAnalytics';
import AIFeedbackDashboard from './pages/Admin/AIFeedbackDashboard';
import SetupPassword from './pages/SetupPassword';
import MobileApp from './pages/MobileApp';
import PrivacySettings from './pages/PrivacySettings';
import WorkerAssignments from './pages/WorkerAssignments';
import FlexSettings from './pages/FlexSettings';
import RecruiterSettings from './pages/RecruiterSettings';
import InsightReports from './pages/InsightReports';

// Read the Google Maps API key from environment variables
const googleMapsApiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';
console.log('Google Maps API key available:', !!googleMapsApiKey);

// Static libraries array to prevent performance warnings
const googleMapsLibraries: Libraries = ['places'];

function UserGroupDetailsWrapper() {
  const { groupId } = useParams();
  const { activeTenant } = useAuth();
  if (!activeTenant?.id || !groupId) return null;
  return <UserGroupDetails tenantId={activeTenant.id} groupId={groupId} />;
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

function App() {
  console.log('App rendered');
  
  const routes = (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup-password" element={<SetupPassword />} />
      <Route path="/invite/:token" element={<InviteTokenValidator />} />
      <Route path="/onboarding/profile" element={<OnboardingProfileForm />} />
      <Route path="/onboarding/complete" element={<OnboardingCompleteScreen />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="dashboard" element={<Dashboard />} />

        {/* Admin/Manager only routes */}
        <Route path="users" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <TenantUsers />
          </ProtectedRoute>
        } />
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
        <Route path="jobs-board" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <JobsBoard />
          </ProtectedRoute>
        } />
        <Route path="crm" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <TenantCRM />
          </ProtectedRoute>
        } />
        <Route path="crm/companies/:companyId" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <CompanyDetails />
          </ProtectedRoute>
        } />
        <Route path="crm/contacts/:contactId" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <ContactDetails />
          </ProtectedRoute>
        } />
        <Route path="tenant/salesperson/:salespersonId" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <TenantSalesperson />
          </ProtectedRoute>
        } />
        <Route path="crm/deals/:dealId" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <DealDetails />
          </ProtectedRoute>
        } />
        <Route path="crm/companies/:companyId/locations/:locationId" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <LocationDetails />
          </ProtectedRoute>
        } />
        <Route path="workforce" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <TenantWorkforce />
          </ProtectedRoute>
        } />
        <Route path="customers" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <Customers />
          </ProtectedRoute>
        } />
        <Route path="settings" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <TenantSettings />
          </ProtectedRoute>
        } />
        <Route path="locations" element={
          <ProtectedRoute requiredSecurityLevel="3">
            <TenantLocations />
          </ProtectedRoute>
        } />
        <Route path="usergroups" element={
          <ProtectedRoute requiredSecurityLevel="4">
            <TenantUserGroups />
          </ProtectedRoute>
        } />
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
        <Route path="privacy-settings" element={<PrivacySettings />} />
        <Route path="assignments" element={<WorkerAssignments />} />
      </Route>
    </Routes>
  );

  console.log('App component about to return JSX');
  return (
    <Router>
      <AuthProvider>
        <AssociationsCacheProvider>
          {googleMapsApiKey ? (
            <LoadScript googleMapsApiKey={googleMapsApiKey} libraries={googleMapsLibraries}>
              {routes}
            </LoadScript>
          ) : (
            <div>
              {routes}
            </div>
          )}
        </AssociationsCacheProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
