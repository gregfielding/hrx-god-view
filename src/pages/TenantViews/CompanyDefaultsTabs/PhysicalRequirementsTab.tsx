import React from 'react';
import OptionTab from './OptionTab';

interface PhysicalRequirementsTabProps {
  tenantId: string;
}

const PhysicalRequirementsTab: React.FC<PhysicalRequirementsTabProps> = ({ tenantId }) => {
  return (
    <OptionTab
      tenantId={tenantId}
      sectionKey="physicalRequirements"
      title="Physical Requirements"
      titlePlaceholder="e.g., Lifting 50 lbs"
      descriptionPlaceholder="Description (optional)"
    />
  );
};

export default PhysicalRequirementsTab;
