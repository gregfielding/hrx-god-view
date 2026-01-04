import React from 'react';
import OptionTab from './OptionTab';

interface RequiredLicensesTabProps {
  tenantId: string;
}

const RequiredLicensesTab: React.FC<RequiredLicensesTabProps> = ({ tenantId }) => {
  return (
    <OptionTab
      tenantId={tenantId}
      sectionKey="licenses"
      title="Required Licenses"
      titlePlaceholder="e.g., Driver License"
      descriptionPlaceholder="Description (optional)"
    />
  );
};

export default RequiredLicensesTab;
