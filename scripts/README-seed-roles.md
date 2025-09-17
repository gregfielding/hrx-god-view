# Tenant Role Seeding Script

This script helps you set up tenant roles for test users using Firebase custom claims.

## Setup

1. **Create `.env.local` file** in the project root:
```bash
# Your Firebase project ID
FIREBASE_PROJECT_ID=your-project-id

# Path to your Firebase service account JSON file
FIREBASE_SERVICE_ACCOUNT_PATH=./path/to/your/service-account-key.json
```

2. **Get Service Account Key**:
   - Go to Firebase Console > Project Settings > Service Accounts
   - Click "Generate new private key"
   - Save the JSON file to your project directory
   - Update `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env.local`

3. **Install dependencies** (if not already installed):
```bash
npm install ts-node dotenv firebase-admin
```

## Usage

### Dry Run (Default - Safe)
```bash
npm run seed-roles
```
This shows what changes would be made without actually applying them.

### Execute Changes
```bash
npm run seed-roles:execute
```
This actually applies the role changes to user claims.

## Configuration

Edit the `TENANT_ROLE_SEEDS` array in `scripts/seed-tenant-roles.ts`:

```typescript
const TENANT_ROLE_SEEDS: TenantRoleSeed[] = [
  {
    uid: 'your-test-user-uid',
    tenantId: 'TENANT_A',
    role: 'Admin',
    securityLevel: '5'
  },
  {
    uid: 'another-user-uid',
    tenantId: 'TENANT_A',
    role: 'Recruiter',
    securityLevel: '4'
  },
  // HRX platform user
  {
    uid: 'hrx-user-uid',
    tenantId: 'TENANT_A',
    role: 'Admin',
    securityLevel: '5',
    hrx: true
  }
];
```

## Role Types

- **Admin**: Full access to tenant
- **Recruiter**: Can manage applications and job orders
- **Manager**: Can manage applications
- **Worker**: Basic worker access
- **Customer**: Customer access

## Security Levels

- **5**: Highest (Admin level)
- **4**: High (Manager level)
- **3**: Medium (Worker level)
- **2**: Low (Basic access)
- **1**: Lowest (Limited access)

## Features

- ✅ **Dry run mode** by default (safe)
- ✅ **Preserves existing claims** (merges, doesn't overwrite)
- ✅ **Multi-tenant support** (same user can have different roles in different tenants)
- ✅ **HRX flag support** (platform-wide access)
- ✅ **Validation** (checks for duplicate assignments)
- ✅ **Detailed logging** (shows before/after claims)
- ✅ **Error handling** (continues processing other users if one fails)

## Example Output

```
🚀 Starting Tenant Role Seeding Process
📊 Processing 3 role assignments

🔍 Validating seed data...
   Found 2 unique users
   Found 3 role assignments
✅ Seed data validation passed

✅ Firebase Admin SDK initialized for project: hrx1-d3beb

📋 Processing user: test-admin-uid-1
   Tenant: TENANT_A
   Role: Admin (Level 5)
   Current claims: {}
   New claims: {
     "roles": {
       "TENANT_A": {
         "role": "Admin",
         "securityLevel": "5"
       }
     },
     "ver": 1
   }
✅ Claims updated for user: test-admin-uid-1

📊 Summary:
   ✅ Successful: 3
   ❌ Failed: 0
   📋 Total: 3

🎉 Tenant role seeding completed!
```

## Troubleshooting

### "User not found" error
- Make sure the UIDs in your seed data are correct
- Users must exist in Firebase Auth before you can set their claims

### "Service account file not found"
- Check that `FIREBASE_SERVICE_ACCOUNT_PATH` points to the correct file
- Make sure the file exists and is readable

### "Permission denied"
- Make sure your service account has the "Firebase Admin" role
- Check that the service account key is valid and not expired

## Security Notes

- This script is for **development/testing only**
- Never commit service account keys to version control
- Use `.env.local` (which should be in `.gitignore`)
- The script preserves existing claims and only adds/updates specified roles
