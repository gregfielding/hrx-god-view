import React from 'react';
import OptionTab from './OptionTab';

interface SkillsTabProps {
  tenantId: string;
}

const SkillsTab: React.FC<SkillsTabProps> = ({ tenantId }) => {
  return (
    <OptionTab
      tenantId={tenantId}
      sectionKey="skills"
      title="Skills"
      titlePlaceholder="e.g., Forklift"
      descriptionPlaceholder="Description (optional)"
    />
  );
};

export default SkillsTab;
