import React from 'react';
import { Paper, Tabs, Tab, Box } from '@mui/material';

interface ConsistentTabsProps {
  value: number;
  onChange: (event: React.SyntheticEvent, newValue: number) => void;
  tabs: { label: string; content: React.ReactNode }[];
  ariaLabel?: string;
}

const ConsistentTabs: React.FC<ConsistentTabsProps> = ({
  value,
  onChange,
  tabs,
  ariaLabel = "tabs"
}) => {
  return (
    <>
      <Paper elevation={1} sx={{ mb: 3, borderRadius: 0 }}>
        <Tabs
          value={value}
          onChange={onChange}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          aria-label={ariaLabel}
        >
          {tabs.map((tab, index) => (
            <Tab key={index} label={tab.label} />
          ))}
        </Tabs>
      </Paper>
      
      {tabs.map((tab, index) => (
        <Box key={index} role="tabpanel" hidden={value !== index}>
          {value === index && tab.content}
        </Box>
      ))}
    </>
  );
};

export default ConsistentTabs; 