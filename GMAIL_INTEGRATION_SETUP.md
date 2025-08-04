# 📧 Gmail Integration Setup Guide

## 🔧 **Current Status**

The Gmail integration is **partially implemented** and ready for use, but requires OAuth configuration to be fully functional.

### ✅ **What's Working:**
- Task creation with email capabilities
- Gmail sync functions (emails → tasks, calendar → tasks)
- Email sending via Gmail API
- Settings UI and configuration management

### ⚠️ **What Needs Setup:**
- Google OAuth 2.0 credentials
- Firebase Functions configuration

## 🚀 **Setup Instructions**

### **Step 1: Create Google Cloud Project (if not already done)**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing project
3. Enable the Gmail API:
   ```bash
   gcloud services enable gmail.googleapis.com
   ```

### **Step 2: Create OAuth 2.0 Credentials**

1. In Google Cloud Console, go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth 2.0 Client IDs**
3. Choose **Web application**
4. Set the following:
   - **Name**: `HRX Gmail Integration`
   - **Authorized redirect URIs**: 
     - `https://us-central1-hrx1-d3beb.cloudfunctions.net/gmailOAuthCallback`
     - `http://localhost:3000` (for development)
5. Click **Create**
6. **Save the Client ID and Client Secret** (you'll need these)

### **Step 3: Configure Firebase Functions**

Run these commands in your project directory:

```bash
# Set Gmail OAuth configuration
firebase functions:config:set gmail.client_id="YOUR_CLIENT_ID"
firebase functions:config:set gmail.client_secret="YOUR_CLIENT_SECRET"
firebase functions:config:set gmail.redirect_uri="https://us-central1-hrx1-d3beb.cloudfunctions.net/gmailOAuthCallback"

# Deploy the updated functions
firebase deploy --only functions
```

### **Step 4: Test the Integration**

1. Go to your CRM → Settings → Gmail Integration
2. Click **Connect Gmail**
3. Complete the OAuth flow
4. Test email sync and task creation

## 🔍 **Troubleshooting**

### **Error: "Gmail OAuth configuration is missing"**

This means the Firebase Functions config isn't set up. Follow Step 3 above.

### **Error: "Failed to authenticate Gmail: INTERNAL"**

1. Check that your OAuth credentials are correct
2. Verify the redirect URI matches exactly
3. Ensure the Gmail API is enabled in Google Cloud Console

### **Error: "Authorization code not provided"**

This usually means the OAuth callback URL isn't configured correctly. Double-check the redirect URI in your OAuth credentials.

## 📋 **Configuration Options**

### **Gmail Settings Available:**

- **Auto-sync emails**: Automatically sync emails every 15 minutes
- **Enable deal intelligence**: Use AI to analyze emails for deal insights
- **Sync interval**: How often to check for new emails (default: 15 minutes)

### **Email Automation Features:**

- **Email → Task conversion**: Creates tasks from important emails
- **Calendar → Task sync**: Converts calendar events to tasks
- **Auto-send emails**: Send email tasks directly via Gmail
- **Contact linking**: Automatically link emails to CRM contacts

## 🔐 **Security Notes**

- OAuth tokens are stored securely in Firestore
- Only authorized users can access Gmail integration
- All email operations are logged for audit purposes
- Tokens are automatically refreshed when needed

## 📞 **Support**

If you encounter issues:

1. Check the browser console for detailed error messages
2. Verify all configuration steps are completed
3. Ensure your Google Cloud project has billing enabled
4. Contact support with specific error messages

## 🎯 **Next Steps After Setup**

Once Gmail integration is working:

1. **Test Email Sync**: Click "Sync Emails" to test the connection
2. **Create Email Tasks**: Try creating tasks with email content
3. **Test Calendar Sync**: Sync your Gmail calendar events
4. **Configure Automation**: Set up auto-sync and deal intelligence

---

**Need Help?** The Gmail integration will show helpful error messages and setup instructions if something isn't configured correctly. 