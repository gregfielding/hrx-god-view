import React from 'react';
import { Box, Typography, Grid, Paper, IconButton } from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import PsychologyAltIcon from '@mui/icons-material/PsychologyAlt';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import ScheduleIcon from '@mui/icons-material/Schedule';
import TimelineIcon from '@mui/icons-material/Timeline';
import FeedbackIcon from '@mui/icons-material/Feedback';
import { useNavigate } from 'react-router-dom';
import TuneIcon from '@mui/icons-material/Tune';
import GroupIcon from '@mui/icons-material/Group';
import ScaleIcon from '@mui/icons-material/Scale';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import InsightsIcon from '@mui/icons-material/Insights';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import ListAltIcon from '@mui/icons-material/ListAlt';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import HubIcon from '@mui/icons-material/Hub';
import MemoryIcon from '@mui/icons-material/Memory';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ChatIcon from '@mui/icons-material/Chat';
import CampaignIcon from '@mui/icons-material/Campaign';
import PsychologyIcon from '@mui/icons-material/Psychology';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import AssessmentIcon from '@mui/icons-material/Assessment';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

const tileStyle = {
  p: 3,
  bgcolor: 'background.paper',
  borderRadius: 3,
  boxShadow: 3,
  cursor: 'pointer',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.2s ease-in, border-color 0.2s ease-in',
  border: '2px solid transparent',
  '&:hover': {
    bgcolor: 'primary.dark',
    borderColor: 'primary.main',
    color: 'white',
    '& .MuiTypography-root': {
      color: 'white !important',
    },
    '& .MuiSvgIcon-root': {
      color: 'white !important',
    },
  },
};

const AILaunchpad: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 0, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Typography variant="h3" mb={2}>
        AI Launchpad
      </Typography>
      <Grid container spacing={4}>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/traits')}>
            <PsychologyAltIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Traits Engine
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Define and manage AI traits and behavioral signals.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/tone')}>
            <TuneIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Tone Settings
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Configure the default AI tone and personality for the platform.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/moments')}>
            <AccessTimeIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Moments Engine
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Manage and schedule AI-driven moments and interventions.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/scheduled-moments')}>
            <InsightsIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Scheduled Moments
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              View and manage all scheduled moments.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/customer-tone-overrides')}>
            <GroupIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Customer Tone Overrides
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              View and manage custom AI tone settings for each customer.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/feedback-engine')}>
            <FeedbackIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Feedback Engine
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Launch and analyze AI-powered feedback campaigns.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/help')}>
            <ManageAccountsIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Help Management
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Manage help topics, review feedback, and track usage analytics for the Help & Guide
              System.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/weights')}>
            <ScaleIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Weights Engine
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Fine-tune how the AI balances admin rules, customer context, and employee feedback.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/hello-message-config')}>
            <ChatIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Hello Message Config
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Configure AI hello messages for mobile app users with bilingual support.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/context')}>
            <MenuBookIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Context Engine
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Define and manage the global and scenario-specific context that guides AI behavior
              across the platform.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/logs')}>
            <ListAltIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Logs
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              View every AI action, trigger, and outcome across the platform.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/retrieval-filters')}>
            <FilterAltIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Retrieval Filters
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Define filter rules that control which context chunks (vectors) are retrieved when
              composing a prompt. Scope by module, customer, or scenario.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/vector-settings')}>
            <MemoryIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Vector Settings
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Configure how vectors are embedded, scored, and surfaced. View, search, and manage all
              vector chunks and settings.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/auto-context-engine')}>
            <HubIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Auto-Context Engine
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Orchestrate real-time context injection and weighting for every AI call. View recent
              decisions and test prompt walkthroughs.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai/devops')}>
            <AutoFixHighIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              AutoDevOps Assistant
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              AI-powered DevOps monitoring with automated fix suggestions and real-time issue
              detection.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai-chat')}>
            <ChatIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              AI Chat
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Smart HR chatbot for worker questions with intelligent escalation to human support.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/broadcast')}>
            <CampaignIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              AI Broadcast
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Send targeted messages to your workforce with AI-assisted replies and analytics.
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai-campaigns')}>
            <CampaignIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              AI Campaigns
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Launch goal-oriented AI initiatives with multi-step engagement and trait tracking.
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/auto-context-engine')}>
            <PsychologyIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Auto-Context Engine
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              The conductor that orchestrates all AI engines and composes intelligent prompts.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/ai-self-improvement')}>
            <LightbulbIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              AI Self-Improvement
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Monitor AI performance, track improvements, and generate optimization recommendations.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/log-coverage')}>
            <AnalyticsIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Log Coverage Dashboard
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Monitor AI field logging coverage, test field changes, and validate log integrity.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/autodevops-monitoring')}>
            <AssessmentIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              AutoDevOps Monitoring
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Real-time monitoring of AutoDevOps performance, fix success rates, and system health.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper sx={tileStyle} onClick={() => navigate('/admin/autodevops-pipeline')}>
            <CloudUploadIcon sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>
              AutoDevOps Pipeline
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Automated deployment pipeline with AI-generated fixes and self-healing capabilities.
            </Typography>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default AILaunchpad;
