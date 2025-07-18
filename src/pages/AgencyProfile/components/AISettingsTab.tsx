import React, { useState } from 'react';
import { Paper, Typography, Tabs, Tab, Box } from '@mui/material';
import ToneStyleSettings from './AISettingsTabSections/ToneStyleSettings';
import CustomPromptsSettings from './AISettingsTabSections/CustomPromptsSettings';
import PromptFrequencyGoalSettings from './AISettingsTabSections/PromptFrequencyGoalSettings';
import ContextBrandingSettings from './AISettingsTabSections/ContextBrandingSettings';
import TraitsEngineSettings from './AISettingsTabSections/TraitsEngineSettings';
import MomentsEngineSettings from './AISettingsTabSections/MomentsEngineSettings';
import FeedbackEngineSettings from './AISettingsTabSections/FeedbackEngineSettings';
import WeightsEngineSettings from './AISettingsTabSections/WeightsEngineSettings';
import VectorSettings from './AISettingsTabSections/VectorSettings';
import RetrievalFilters from './AISettingsTabSections/RetrievalFilters';
import ConversationSettings from './AISettingsTabSections/ConversationSettings';
import SecurityLevelEngagementSettings from './AISettingsTabSections/SecurityLevelEngagementSettings';

interface AISettingsTabProps {
  tenantId: string;
}

const AISettingsTab: React.FC<AISettingsTabProps> = ({ tenantId }) => {
  const [tab, setTab] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTab(newValue);
  };

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
    'Security Level Engagement',
  ];

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        AI Settings Configuration
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure how the AI interacts with workers, processes feedback, and manages conversations.
        Each section controls different aspects of the AI's behavior and capabilities.
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
      <Box role="tabpanel" hidden={tab !== 11}>
        {tab === 11 && <SecurityLevelEngagementSettings tenantId={tenantId} />}
      </Box>
    </Paper>
  );
};

export default AISettingsTab;
