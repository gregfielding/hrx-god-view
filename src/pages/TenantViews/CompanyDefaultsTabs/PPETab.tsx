import React from 'react';
import OptionTab from './OptionTab';

interface PPETabProps {
  tenantId: string;
}

const PPETab: React.FC<PPETabProps> = ({ tenantId }) => {
  return (
    <OptionTab
      tenantId={tenantId}
      sectionKey="ppe"
      title="PPE"
      titlePlaceholder="e.g., Safety Glasses"
      descriptionPlaceholder="Description (optional)"
    />
  );
};

export default PPETab;
