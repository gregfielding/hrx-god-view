import React from 'react';
import { InviteUserForm } from './InviteUserForm';
import { ClaimsRole } from '../contexts/AuthContext';

export interface WorkforceInviteFormProps {
  onSuccess?: (result: any) => void;
  onCancel?: () => void;
  showCancelButton?: boolean;
}

/**
 * Specialized invite form for the Workforce flow
 * Pre-configured with appropriate defaults for workforce members
 */
export const WorkforceInviteForm: React.FC<WorkforceInviteFormProps> = ({
  onSuccess,
  onCancel,
  showCancelButton = true
}) => {
  return (
    <InviteUserForm
      title="Invite Worker"
      subtitle="Add a new member to your workforce"
      defaultRole="Worker"
      allowedRoles={['Worker', 'Customer']}
      showRoleSelector={true}
      flowType="workforce"
      customMessage="You have been invited to join our workforce. Please set up your account to get started."
      onSuccess={onSuccess}
      onCancel={onCancel}
      showCancelButton={showCancelButton}
      submitButtonText="Invite Worker"
      cancelButtonText="Cancel"
    />
  );
};

export default WorkforceInviteForm;
