# Invite System - Unified User Invitation Flow

The invite system provides a unified mechanism for inviting users to tenants, designed to work seamlessly with both Recruiter and Workforce flows while maintaining security and flexibility.

## Architecture Overview

### Backend Components

#### 1. Cloud Function: `inviteUser`
- **Location**: `functions/src/auth/inviteUser.ts`
- **Type**: HTTP Callable (Gen2)
- **Authorization**: HRX users or Tenant Admins only
- **Functionality**:
  - Creates Firebase Auth user if not exists (disabled=false)
  - Sets claims `roles[tenantId] = { role, securityLevel }`
  - Writes lightweight `tenants/{tenantId}/pending_invites/{uid}` doc
  - Sends password reset link or email-link sign-in
  - Returns invite link for UI display

#### 2. Service Layer: `InviteService`
- **Location**: `src/services/inviteService.ts`
- **Type**: Singleton service class
- **Functionality**:
  - Provides unified interface for all invite operations
  - Handles error translation and user-friendly messages
  - Offers flow-specific convenience methods

### Frontend Components

#### 1. React Hook: `useInviteUser`
- **Location**: `src/hooks/useInviteUser.ts`
- **Functionality**:
  - Manages invite state (loading, error, result)
  - Provides methods for different invite flows
  - Handles error states and success callbacks

#### 2. Form Components
- **`InviteUserForm`**: Generic, configurable invite form
- **`RecruiterInviteForm`**: Pre-configured for recruiting team
- **`WorkforceInviteForm`**: Pre-configured for workforce members

## Usage Examples

### Basic Invite (Generic Flow)

```typescript
import { useInviteUser } from '../hooks/useInviteUser';

const MyComponent = () => {
  const { inviteUser, loading, error, result } = useInviteUser();
  
  const handleInvite = async () => {
    await inviteUser({
      email: 'user@example.com',
      firstName: 'John',
      lastName: 'Doe',
      tenantId: 'TENANT_A',
      desiredRole: 'Recruiter',
      securityLevel: '3',
      sendPasswordReset: true,
      customMessage: 'Welcome to our team!'
    });
  };
  
  return (
    <div>
      <button onClick={handleInvite} disabled={loading}>
        {loading ? 'Inviting...' : 'Invite User'}
      </button>
      {error && <div>Error: {error}</div>}
      {result && <div>Invite sent! Link: {result.inviteLink}</div>}
    </div>
  );
};
```

### Recruiter Flow

```typescript
import { RecruiterInviteForm } from '../components/RecruiterInviteForm';

const RecruiterDashboard = () => {
  const [showInviteForm, setShowInviteForm] = useState(false);
  
  return (
    <div>
      <button onClick={() => setShowInviteForm(true)}>
        Invite Recruiter
      </button>
      
      {showInviteForm && (
        <RecruiterInviteForm
          onSuccess={(result) => {
            console.log('Recruiter invited:', result);
            setShowInviteForm(false);
          }}
          onCancel={() => setShowInviteForm(false)}
        />
      )}
    </div>
  );
};
```

### Workforce Flow

```typescript
import { WorkforceInviteForm } from '../components/WorkforceInviteForm';

const WorkforceDashboard = () => {
  const [showInviteForm, setShowInviteForm] = useState(false);
  
  return (
    <div>
      <button onClick={() => setShowInviteForm(true)}>
        Invite Worker
      </button>
      
      {showInviteForm && (
        <WorkforceInviteForm
          onSuccess={(result) => {
            console.log('Worker invited:', result);
            setShowInviteForm(false);
          }}
          onCancel={() => setShowInviteForm(false)}
        />
      )}
    </div>
  );
};
```

### Direct Service Usage

```typescript
import { inviteService } from '../services/inviteService';

// Generic invite
const result = await inviteService.inviteOrAttachUser({
  email: 'user@example.com',
  firstName: 'John',
  lastName: 'Doe',
  tenantId: 'TENANT_A',
  desiredRole: 'Worker',
  securityLevel: '2'
});

// Recruiter-specific invite
const recruiterResult = await inviteService.inviteRecruiterUser({
  email: 'recruiter@example.com',
  firstName: 'Jane',
  lastName: 'Smith',
  tenantId: 'TENANT_A',
  desiredRole: 'Recruiter'
});

// Worker-specific invite
const workerResult = await inviteService.inviteWorkerUser({
  email: 'worker@example.com',
  firstName: 'Bob',
  lastName: 'Johnson',
  tenantId: 'TENANT_A',
  desiredRole: 'Worker'
});
```

## Configuration Options

### Flow Types

#### Recruiter Flow
- **Default Role**: Recruiter
- **Allowed Roles**: Admin, Recruiter, Manager
- **Security Level**: 3 (default)
- **Custom Message**: "You have been invited to join our recruiting team."

#### Workforce Flow
- **Default Role**: Worker
- **Allowed Roles**: Worker, Customer
- **Security Level**: 2 (default)
- **Custom Message**: "You have been invited to join our workforce."

#### General Flow
- **Default Role**: Worker
- **Allowed Roles**: All roles
- **Security Level**: Configurable
- **Custom Message**: Configurable

### Form Customization

```typescript
<InviteUserForm
  title="Custom Invite Form"
  subtitle="Custom subtitle"
  defaultRole="Manager"
  allowedRoles={['Admin', 'Manager']}
  showRoleSelector={true}
  flowType="general"
  customMessage="Custom welcome message"
  onSuccess={handleSuccess}
  onCancel={handleCancel}
  showCancelButton={true}
  submitButtonText="Send Custom Invite"
  cancelButtonText="Cancel"
/>
```

## Security Features

### Authorization
- **HRX Users**: Can invite users to any tenant
- **Tenant Admins**: Can invite users to their own tenant
- **Other Users**: Cannot invite users

### Claims-Based Roles
- User roles are set in Firebase custom claims
- Fast, secure authorization checks
- No Firestore reads for role verification
- Automatic token refresh when claims change

### Audit Trail
- All invites are tracked in `tenants/{tenantId}/pending_invites/{uid}`
- Includes metadata: inviter, timestamp, role, status
- Supports invite management and cancellation

## Error Handling

### Common Error Cases
- **Permission Denied**: User doesn't have invite permissions
- **Already Exists**: User with email already exists
- **Invalid Email**: Malformed email address
- **Account Disabled**: Target user account is disabled
- **Network Error**: Connection or service issues

### Error Messages
The service provides user-friendly error messages:
```typescript
try {
  await inviteUser(params);
} catch (error) {
  // Error messages are automatically translated to user-friendly text
  console.error(error.message); // "You do not have permission to invite users to this tenant."
}
```

## Integration Points

### With Existing Systems
- **AuthContext**: Uses active tenant for invite operations
- **Role System**: Integrates with claims-based role management
- **UI Components**: Provides reusable form components
- **Error Handling**: Consistent with application error patterns

### Future Extensions
- **Invite Management**: Cancel, resend, track invite status
- **Bulk Invites**: Invite multiple users at once
- **Template System**: Pre-configured invite templates
- **Analytics**: Track invite success rates and user onboarding

## Testing

### Unit Tests
```typescript
// Test the service
import { inviteService } from '../services/inviteService';

describe('InviteService', () => {
  it('should invite a new user', async () => {
    const result = await inviteService.inviteOrAttachUser({
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      tenantId: 'TEST_TENANT',
      desiredRole: 'Worker'
    });
    
    expect(result.inviteLink).toBeDefined();
    expect(result.userExists).toBe(false);
  });
});
```

### Integration Tests
```typescript
// Test the hook
import { renderHook, act } from '@testing-library/react';
import { useInviteUser } from '../hooks/useInviteUser';

describe('useInviteUser', () => {
  it('should handle successful invite', async () => {
    const { result } = renderHook(() => useInviteUser());
    
    await act(async () => {
      await result.current.inviteUser({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tenantId: 'TEST_TENANT',
        desiredRole: 'Worker'
      });
    });
    
    expect(result.current.result).toBeDefined();
    expect(result.current.error).toBeNull();
  });
});
```

## Deployment

### Cloud Function Deployment
```bash
# Deploy the invite function
firebase deploy --only functions:inviteUser

# Deploy all auth functions
firebase deploy --only functions:setTenantRole,functions:inviteUser
```

### Environment Variables
```bash
# Required for invite links
FRONTEND_URL=https://your-app.com
```

## Troubleshooting

### Common Issues

#### "Permission Denied" Error
- Check that the user has HRX access or is a Tenant Admin
- Verify the user is authenticated
- Ensure the tenant ID is correct

#### "User Already Exists" Error
- The email is already registered in Firebase Auth
- Check if the user needs to be added to the tenant instead
- Consider using a different email or contacting the existing user

#### "Invalid Email" Error
- Verify the email format is correct
- Check for typos in the email address
- Ensure the email domain is valid

#### Invite Link Not Working
- Check that `FRONTEND_URL` environment variable is set correctly
- Verify the link hasn't expired
- Ensure the user hasn't already used the link

### Debug Mode
Enable debug logging by setting the log level in the Cloud Function:
```typescript
// In the Cloud Function
console.log('Debug info:', { email, tenantId, role });
```

## Best Practices

### Security
- Always validate user permissions before showing invite forms
- Use appropriate security levels for different user types
- Regularly audit pending invites and clean up expired ones

### UX
- Provide clear feedback during the invite process
- Show invite links prominently for easy copying
- Handle errors gracefully with helpful messages

### Performance
- Use the hook for state management to avoid unnecessary re-renders
- Cache invite results when appropriate
- Implement proper loading states

### Maintenance
- Monitor invite success rates
- Track user onboarding completion
- Regularly update invite templates and messages
