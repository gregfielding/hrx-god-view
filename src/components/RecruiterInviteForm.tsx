import React from 'react';
import { InviteUserForm } from './InviteUserForm';
import { ClaimsRole } from '../contexts/AuthContext';

export interface RecruiterInviteFormProps {
  onSuccess?: (result: any) => void;
  onCancel?: () => void;
  showCancelButton?: boolean;
}

/**
 * Specialized invite form for the Recruiter flow
 * Pre-configured with appropriate defaults for recruiting team members
 */
export const RecruiterInviteForm: React.FC<RecruiterInviteFormProps> = ({
  onSuccess,
  onCancel,
  showCancelButton = true
}) => {
  return (
    <InviteUserForm
      title="Invite Recruiter"
      subtitle="Add a new team member to your recruiting team"
      defaultRole="Recruiter"
      allowedRoles={['Admin', 'Recruiter', 'Manager']}
      showRoleSelector={true}
      flowType="recruiter"
      customMessage="You have been invited to join our recruiting team. Please set up your account to get started."
      onSuccess={onSuccess}
      onCancel={onCancel}
      showCancelButton={showCancelButton}
      submitButtonText="Invite Recruiter"
      cancelButtonText="Cancel"
    />
  );
};

export default RecruiterInviteForm;
