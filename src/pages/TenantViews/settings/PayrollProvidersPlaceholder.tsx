import React from 'react';
import Phase2Placeholder from './Phase2Placeholder';

const PayrollProvidersPlaceholder: React.FC = () => (
  <Phase2Placeholder
    title="Payroll Providers"
    description="Configure provider mode: TempWorks = track status and milestones only, link workers to portal; Everee = integrated when available. Portal link URL and tenant/entity mappings."
    system="Payroll"
  />
);

export default PayrollProvidersPlaceholder;
