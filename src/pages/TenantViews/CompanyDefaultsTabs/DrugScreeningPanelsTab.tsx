import React from 'react';
import OptionTab from './OptionTab';

interface DrugScreeningPanelsTabProps {
  tenantId: string;
}

const DrugScreeningPanelsTab: React.FC<DrugScreeningPanelsTabProps> = ({ tenantId }) => {
  return (
    <OptionTab
      tenantId={tenantId}
      sectionKey="screeningPanels"
      title="Drug Screening Panels"
      titlePlaceholder="e.g., 10-Panel"
      descriptionPlaceholder="Description (optional)"
    />
  );
};

export default DrugScreeningPanelsTab;
