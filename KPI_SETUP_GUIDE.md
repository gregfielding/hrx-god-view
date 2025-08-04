# KPI System Setup Guide

## ✅ Completed Steps

1. **✅ Firebase Config Updated**: Both setup scripts now have your correct Firebase configuration
2. **✅ Firestore Security Rules Deployed**: KPI security rules are now active in your Firebase project
3. **✅ CRM Integration Complete**: KPI Management and Dashboard components are integrated into your CRM

## 🚀 Next Steps to Complete Setup

### Step 1: Find Your Tenant ID

You need to identify your tenant ID to set up KPIs. Here are several ways to find it:

#### Option A: Browser Console Method
1. Open your CRM application in the browser
2. Open Developer Tools (F12)
3. Go to the Console tab
4. Run this code:
```javascript
// Check for tenant ID in various places
console.log('Local Storage tenantId:', localStorage.getItem('tenantId'));
console.log('Local Storage activeTenantId:', localStorage.getItem('activeTenantId'));
console.log('Session Storage tenantId:', sessionStorage.getItem('tenantId'));
console.log('URL tenantId:', new URLSearchParams(window.location.search).get('tenantId'));
```

#### Option B: Network Tab Method
1. Open Developer Tools (F12)
2. Go to the Network tab
3. Navigate through your CRM (click on different sections)
4. Look for API calls that contain tenant IDs in the request/response

#### Option C: Application Tab Method
1. Open Developer Tools (F12)
2. Go to the Application tab
3. Check Local Storage and Session Storage for tenant information

### Step 2: Set Up KPIs

Once you have your tenant ID, run one of these commands:

#### Option A: Setup for Specific Tenant
```bash
node setupKPIsWithAuth.js <your-email> <your-password> <tenant-id>
```

#### Option B: Setup for All Your Tenants
```bash
node setupKPIsWithAuth.js <your-email> <your-password> --all
```

#### Option C: Discover Your Tenants First
```bash
node setupKPIsWithAuth.js <your-email> <your-password>
```
This will show you all available tenants and then you can choose which one to set up.

### Step 3: Test the System

After setting up KPIs, test the system:

```bash
node testKPISystem.js <tenant-id>
```

## 📋 Example Commands

Replace the placeholders with your actual information:

```bash
# Example 1: Setup for a specific tenant
node setupKPIsWithAuth.js gregpfielding@gmail.com your-password abc123def456

# Example 2: Setup for all tenants
node setupKPIsWithAuth.js gregpfielding@gmail.com your-password --all

# Example 3: Test the system
node testKPISystem.js abc123def456
```

## 🔍 What the Setup Script Does

The setup script will:

1. **Authenticate** with your Firebase account
2. **Create 5 Sample KPIs**:
   - Daily Sales Calls (30/day)
   - Daily Sales Emails (50/day)
   - Weekly Meetings (8/week)
   - Monthly Revenue ($50K/month)
   - Lead Conversion Rate (15%)

3. **Find Salespeople** in your tenant (or create a sample one if none exist)

4. **Assign KPIs** to each salesperson

5. **Create Tracking Records** for progress monitoring

6. **Generate AI Task Suggestions** to help meet KPIs

## 🎯 After Setup

Once the setup is complete:

1. **For Administrators**: Go to your CRM → "KPIs" tab to manage KPIs and assignments
2. **For Salespeople**: Go to your CRM → "My KPIs" tab to view dashboard and log activities

## 🔧 Troubleshooting

### If you get authentication errors:
- Make sure you're using the correct email and password
- Ensure your account has access to the Firebase project

### If you get permission errors:
- The Firestore security rules have been deployed, so this should work
- Make sure you're using an account that has access to the tenant

### If no tenants are found:
- The script will create a sample salesperson for testing
- You can then manually create more salespeople through the CRM

## 📞 Need Help?

If you encounter any issues:

1. Check the console output for specific error messages
2. Verify your Firebase project settings
3. Ensure you're using the correct tenant ID
4. Check that the Firestore security rules are properly deployed

## 🎉 Success Indicators

You'll know the setup is successful when you see:
- ✅ "KPI setup completed successfully!"
- ✅ Messages about created KPIs, assignments, and tracking records
- ✅ The ability to see KPIs in your CRM tabs

Once complete, your sales team will have a fully functional KPI system with AI-powered task suggestions! 