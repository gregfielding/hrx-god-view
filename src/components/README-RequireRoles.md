# RequireRoles HOC - Route Protection Guide

The `RequireRoles` Higher-Order Component provides a clean, declarative way to protect routes and components based on the new claims-based role system.

## Quick Start

```tsx
import { RequireRoles, RequireAdmin, RequireRecruiter } from '../components/RequireRoles';

// Protect a component with Admin role
<RequireAdmin>
  <AdminPanel />
</RequireAdmin>

// Protect with multiple roles (user needs ANY of these)
<RequireRoles roles={['Recruiter', 'Manager']}>
  <RecruiterDashboard />
</RequireRoles>

// Protect with ALL roles (user needs ALL of these)
<RequireRoles roles={['Admin', 'Recruiter']} requireAll={true}>
  <SuperAdminPanel />
</RequireRoles>
```

## Available Components

### Main Component
- **`RequireRoles`** - Main HOC with full configuration options

### Convenience Components
- **`RequireAdmin`** - Requires Admin role
- **`RequireRecruiter`** - Requires Recruiter role  
- **`RequireManager`** - Requires Manager role
- **`RequireRecruiterOrManager`** - Requires Recruiter OR Manager role

### Hook
- **`useRequireRoles`** - Hook for conditional rendering

## Props

### RequireRoles Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `React.ReactNode` | - | Content to protect |
| `roles` | `ClaimsRole[]` | - | Required roles |
| `tenantId` | `string?` | `activeTenantId` | Specific tenant to check |
| `fallback` | `React.ReactNode?` | Default access denied | Custom fallback component |
| `showRefreshButton` | `boolean` | `true` | Show refresh claims button |
| `requireAll` | `boolean` | `false` | Require ALL roles vs ANY role |

### ClaimsRole Type
```typescript
type ClaimsRole = 'Admin' | 'Recruiter' | 'Manager' | 'Worker' | 'Customer';
```

## Usage Examples

### 1. Basic Role Protection

```tsx
// Admin-only content
<RequireAdmin>
  <AdminSettings />
</RequireAdmin>

// Recruiter-only content
<RequireRecruiter>
  <JobOrdersList />
</RequireRecruiter>
```

### 2. Multiple Roles (ANY)

```tsx
// User needs Recruiter OR Manager role
<RequireRoles roles={['Recruiter', 'Manager']}>
  <ApplicationsDashboard />
</RequireRoles>

// Using convenience component
<RequireRecruiterOrManager>
  <ApplicationsDashboard />
</RequireRecruiterOrManager>
```

### 3. Multiple Roles (ALL)

```tsx
// User needs BOTH Admin AND Recruiter roles
<RequireRoles roles={['Admin', 'Recruiter']} requireAll={true}>
  <SuperAdminPanel />
</RequireRoles>
```

### 4. Tenant-Specific Protection

```tsx
// Check role in specific tenant
<RequireRoles roles={['Admin']} tenantId="TENANT_A">
  <TenantASettings />
</RequireRoles>
```

### 5. Custom Fallback

```tsx
<RequireRoles 
  roles={['Admin']} 
  fallback={<CustomAccessDenied />}
>
  <AdminContent />
</RequireRoles>
```

### 6. Using the Hook

```tsx
const MyComponent = () => {
  const { hasAccess, loading } = useRequireRoles(['Admin', 'Recruiter']);
  
  if (loading) return <div>Loading...</div>;
  
  return (
    <div>
      {hasAccess ? (
        <AdminContent />
      ) : (
        <div>Access denied</div>
      )}
    </div>
  );
};
```

## Route Protection

### Using ProtectedRoute Component

```tsx
import { ProtectedRoute } from '../utils/routeProtection';

// In your router
<Routes>
  <Route 
    path="/admin" 
    element={
      <ProtectedRoute roles={['Admin']}>
        <AdminDashboard />
      </ProtectedRoute>
    } 
  />
</Routes>
```

### Using HOC Approach

```tsx
import { RouteProtection } from '../utils/routeProtection';

// Protect entire component
const ProtectedAdminDashboard = RouteProtection.admin(AdminDashboard);

// Custom role requirements
const CustomProtectedComponent = RouteProtection.custom(
  MyComponent,
  ['Admin', 'Recruiter'],
  { requireAll: true }
);
```

## Access Denied Screen

When a user doesn't have the required roles, they see a detailed access denied screen:

- **Lock icon** and clear messaging
- **Required roles** list with visual indicators
- **Missing roles** highlighted in red
- **Current user info** (role, security level, tenant)
- **HRX status** if applicable
- **Refresh claims button** to retry after role changes

## Special Cases

### HRX Users
HRX users (with `hrx: true` in claims) have access to all protected content automatically.

### Loading States
The HOC automatically handles loading states while authentication is being determined.

### No Tenant Selected
If no tenant is selected and `tenantId` is not provided, access is denied with appropriate messaging.

## Best Practices

### 1. Use Specific Roles
```tsx
// Good - specific role
<RequireAdmin>
  <AdminPanel />
</RequireAdmin>

// Avoid - too broad
<RequireRoles roles={['Admin', 'Recruiter', 'Manager', 'Worker', 'Customer']}>
  <SomeContent />
</RequireRoles>
```

### 2. Provide Custom Fallbacks
```tsx
// Good - custom fallback
<RequireRoles 
  roles={['Admin']} 
  fallback={<UpgradePrompt />}
>
  <PremiumFeature />
</RequireRoles>
```

### 3. Use Hooks for Conditional Rendering
```tsx
// Good - hook for conditional logic
const { hasAccess } = useRequireRoles(['Admin']);
return (
  <div>
    <PublicContent />
    {hasAccess && <AdminContent />}
  </div>
);
```

### 4. Combine with Route Protection
```tsx
// Good - protect at route level
<Route 
  path="/admin" 
  element={
    <ProtectedRoute roles={['Admin']}>
      <AdminDashboard />
    </ProtectedRoute>
  } 
/>
```

## Error Handling

The HOC handles various error states:

- **User not authenticated** - Shows appropriate message
- **No tenant selected** - Shows tenant selection prompt
- **Missing roles** - Shows detailed role requirements
- **Claims refresh failure** - Logs error and allows retry

## Performance Considerations

- **Claims are cached** in AuthContext, so role checks are fast
- **No Firestore reads** for authorization checks
- **Automatic token refresh** when needed
- **Minimal re-renders** with optimized state management

## Testing

```tsx
// Mock the auth context for testing
const mockAuthContext = {
  user: { uid: 'test-user' },
  isHRX: false,
  currentClaimsRole: 'Admin',
  // ... other auth properties
};

// Test component with different roles
<AuthContext.Provider value={mockAuthContext}>
  <RequireAdmin>
    <TestComponent />
  </RequireAdmin>
</AuthContext.Provider>
```

## Migration from Legacy System

If you're migrating from the old role system:

1. **Replace legacy role checks** with RequireRoles HOC
2. **Update role names** to match new ClaimsRole type
3. **Test with different user roles** using the seed script
4. **Verify HRX users** still have access to everything

## Troubleshooting

### "Access Denied" for HRX Users
- Check that `isHRX` is properly set in AuthContext
- Verify claims have `hrx: true` flag

### Role Not Updating After Change
- Use the "Refresh Claims" button
- Check that `setTenantRole` function was called successfully
- Verify token refresh is working

### "No tenant selected" Error
- Ensure user has an active tenant
- Check that `activeTenantId` is set in AuthContext
- Provide explicit `tenantId` prop if needed
