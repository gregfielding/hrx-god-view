import React from 'react';
import OptionTab from './OptionTab';

interface BackgroundCheckPackagesTabProps {
  tenantId: string;
}

const BackgroundCheckPackagesTab: React.FC<BackgroundCheckPackagesTabProps> = ({ tenantId }) => {
  return (
    <OptionTab
      tenantId={tenantId}
      sectionKey="backgroundPackages"
      title="Background Check Packages"
      titlePlaceholder="e.g., County 7-year"
      descriptionPlaceholder="Description (optional)"
    />
  );
};

export default BackgroundCheckPackagesTab;
