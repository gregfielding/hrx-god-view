import React, { useState } from 'react';
import { Box, Typography, Tabs, Tab, Paper } from '@mui/material';

import { useAuth } from '../../contexts/AuthContext';
import ToneStyleSettings from '../AgencyProfile/components/AISettingsTabSections/ToneStyleSettings';
import CustomPromptsSettings from '../AgencyProfile/components/AISettingsTabSections/CustomPromptsSettings';
import PromptFrequencyGoalSettings from '../AgencyProfile/components/AISettingsTabSections/PromptFrequencyGoalSettings';
import ContextBrandingSettings from '../AgencyProfile/components/AISettingsTabSections/ContextBrandingSettings';
import TraitsEngineSettings from '../AgencyProfile/components/AISettingsTabSections/TraitsEngineSettings';
import MomentsEngineSettings from '../AgencyProfile/components/AISettingsTabSections/MomentsEngineSettings';
import FeedbackEngineSettings from '../AgencyProfile/components/AISettingsTabSections/FeedbackEngineSettings';
import WeightsEngineSettings from '../AgencyProfile/components/AISettingsTabSections/WeightsEngineSettings';
import VectorSettings from '../AgencyProfile/components/AISettingsTabSections/VectorSettings';
import RetrievalFilters from '../AgencyProfile/components/AISettingsTabSections/RetrievalFilters';
import ConversationSettings from '../AgencyProfile/components/AISettingsTabSections/ConversationSettings';

const tabLabels = [
  'Tone & Style',
  'Custom Prompts',
  'Prompt Goals',
  'Context & Branding',
  'Traits Engine',
  'Moments Engine',
  'Feedback Engine',
  'Weights Engine',
  'Vector Settings',
  'Retrieval Filters',
  'Conversation Settings',
];

const TenantAISettings: React.FC = () => {
  const { tenantId } = useAuth();
  const [tab, setTab] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTab(newValue);
  };

  return (
    <Box sx={{ width: '100%', p: 0 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3} mt={0}>
        <Typography variant="h3" component="h1">
          AI Settings
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure how the AI interacts with workers, processes feedback, and manages conversations. Each section controls different aspects of the AI's behavior and capabilities.
      </Typography>
      <Paper elevation={1} sx={{ mb: 3, borderRadius: 0 }}>
        <Tabs
          value={tab}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          aria-label="ai settings tabs"
        >
          {tabLabels.map((label, index) => (
            <Tab key={index} label={label} />
          ))}
        </Tabs>
      </Paper>
      <Box role="tabpanel" hidden={tab !== 0}>
        {tab === 0 && <ToneStyleSettings tenantId={tenantId} />}
      </Box>
      <Box role="tabpanel" hidden={tab !== 1}>
        {tab === 1 && <CustomPromptsSettings tenantId={tenantId} />}
      </Box>
      <Box role="tabpanel" hidden={tab !== 2}>
        {tab === 2 && <PromptFrequencyGoalSettings tenantId={tenantId} />}
      </Box>
      <Box role="tabpanel" hidden={tab !== 3}>
        {tab === 3 && <ContextBrandingSettings tenantId={tenantId} />}
      </Box>
      <Box role="tabpanel" hidden={tab !== 4}>
        {tab === 4 && <TraitsEngineSettings tenantId={tenantId} />}
      </Box>
      <Box role="tabpanel" hidden={tab !== 5}>
        {tab === 5 && <MomentsEngineSettings tenantId={tenantId} />}
      </Box>
      <Box role="tabpanel" hidden={tab !== 6}>
        {tab === 6 && <FeedbackEngineSettings tenantId={tenantId} />}
      </Box>
      <Box role="tabpanel" hidden={tab !== 7}>
        {tab === 7 && <WeightsEngineSettings tenantId={tenantId} />}
      </Box>
      <Box role="tabpanel" hidden={tab !== 8}>
        {tab === 8 && <VectorSettings tenantId={tenantId} />}
      </Box>
      <Box role="tabpanel" hidden={tab !== 9}>
        {tab === 9 && <RetrievalFilters tenantId={tenantId} />}
      </Box>
      <Box role="tabpanel" hidden={tab !== 10}>
        {tab === 10 && <ConversationSettings tenantId={tenantId} />}
      </Box>
    </Box>
  );
};

export default TenantAISettings; 