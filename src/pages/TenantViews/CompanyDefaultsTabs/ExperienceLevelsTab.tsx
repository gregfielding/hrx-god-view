import React from 'react';
import OptionTab from './OptionTab';

interface ExperienceLevelsTabProps {
  tenantId: string;
}

const ExperienceLevelsTab: React.FC<ExperienceLevelsTabProps> = ({ tenantId }) => {
  return (
    <OptionTab
      tenantId={tenantId}
      sectionKey="experienceLevels"
      title="Experience Levels"
      titlePlaceholder="e.g., 3-5 years"
      descriptionPlaceholder="Description (optional)"
    />
  );
};

export default ExperienceLevelsTab;
