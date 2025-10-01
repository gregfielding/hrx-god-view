import React from 'react';
import OptionTab from './OptionTab';

interface LanguagesTabProps {
  tenantId: string;
}

const LanguagesTab: React.FC<LanguagesTabProps> = ({ tenantId }) => {
  return (
    <OptionTab
      tenantId={tenantId}
      sectionKey="languages"
      title="Languages"
      titlePlaceholder="e.g., Spanish"
      descriptionPlaceholder="Description (optional)"
    />
  );
};

export default LanguagesTab;
