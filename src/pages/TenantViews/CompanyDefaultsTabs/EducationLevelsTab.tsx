import React from 'react';
import OptionTab from './OptionTab';

interface EducationLevelsTabProps {
  tenantId: string;
}

const EducationLevelsTab: React.FC<EducationLevelsTabProps> = ({ tenantId }) => {
  return (
    <OptionTab
      tenantId={tenantId}
      sectionKey="educationLevels"
      title="Education Levels"
      titlePlaceholder="e.g., High School / GED"
      descriptionPlaceholder="Description (optional)"
    />
  );
};

export default EducationLevelsTab;
