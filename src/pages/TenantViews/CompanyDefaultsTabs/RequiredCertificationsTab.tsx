import React from 'react';
import OptionTab from './OptionTab';

interface RequiredCertificationsTabProps {
  tenantId: string;
}

const RequiredCertificationsTab: React.FC<RequiredCertificationsTabProps> = ({ tenantId }) => {
  return (
    <OptionTab
      tenantId={tenantId}
      sectionKey="certifications"
      title="Required Certifications"
      titlePlaceholder="e.g., OSHA 10"
      descriptionPlaceholder="Description (optional)"
    />
  );
};

export default RequiredCertificationsTab;
