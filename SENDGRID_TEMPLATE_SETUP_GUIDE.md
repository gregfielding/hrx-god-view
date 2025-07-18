# SendGrid Dynamic Template Setup Guide for Worker Invitations

## Overview

This guide will help you set up a dynamic SendGrid template for worker invitations that includes comprehensive branding and tenant information. The template will automatically pull data from your tenant's branding settings and display personalized content for each invitation.

## What's Included

### 🎨 **Dynamic Branding Elements**
- **Company Logo**: Displays tenant's uploaded logo or initials fallback
- **Accent Color**: Uses tenant's custom accent color throughout the email
- **Company Name**: Dynamic tenant name in header and content
- **Sender Name**: Customizable "From" name from branding settings

### 📋 **Personalized Content**
- **Worker Details**: Name, position, department, access level
- **Invitation Details**: Who sent the invite, expiration date
- **Company Information**: Website, HR contact, legal footer
- **Features Overview**: What the worker will get access to

### 🔧 **Technical Features**
- **Responsive Design**: Works on desktop and mobile
- **Fallback Content**: Graceful handling of missing data
- **Professional Layout**: Clean, modern design with proper spacing
- **Accessibility**: Proper contrast ratios and readable fonts

## Setup Instructions

### Step 1: Create SendGrid Template

1. **Log into SendGrid Dashboard**
   - Go to [SendGrid Dashboard](https://app.sendgrid.com)
   - Navigate to **Email API** → **Dynamic Templates**

2. **Create New Template**
   - Click **"Create Template"**
   - Name it: `Worker Invitation Template`
   - Version: `1.0`

3. **Upload HTML Template**
   - Copy the HTML from `sendgrid-worker-invitation-template.html`
   - Paste into the SendGrid template editor
   - Click **"Save"**

### Step 2: Configure Dynamic Variables

The template uses these dynamic variables (automatically populated by your Firebase function):

```javascript
{
  // Tenant Information
  tenant_name: "Acme Staffing Agency",
  tenant_type: "Agency", 
  tenant_logo: "https://...",
  tenant_initials: "AS",
  tenant_accent_color: "#0057B8",
  tenant_website: "https://acme.com",
  tenant_hr_email: "hr@acme.com",
  tenant_sender_name: "Acme HR",
  tenant_legal_footer: "Custom legal text...",
  
  // Worker Information
  worker_first_name: "John",
  worker_last_name: "Doe",
  worker_job_title: "Warehouse Associate",
  worker_department: "Operations",
  worker_security_level: "Worker",
  
  // Invitation Details
  invited_by_name: "Jane Smith",
  invitation_link: "https://app.hrxone.com/setup-password?oobCode=...",
  expiration_date: "Friday, July 22, 2025"
}
```

### Step 3: Update Firebase Function

1. **Get Template ID**
   - In SendGrid, copy your template ID (starts with `d-`)
   - Example: `d-abc123def456`

2. **Update Firebase Function**
   - Open `functions/src/index.ts`
   - Find the line: `templateId: 'd-your-sendgrid-template-id-here'`
   - Replace with your actual template ID

3. **Deploy Functions**
   ```bash
   cd functions
   npm run deploy
   ```

### Step 4: Test the Template

1. **Send Test Invitation**
   - Go to your HRX admin panel
   - Invite a test worker
   - Check the email received

2. **Verify Dynamic Content**
   - Company logo appears correctly
   - Accent color is applied
   - Worker details are populated
   - Links work properly

## Template Features

### 🎯 **Header Section**
- **Logo Display**: Shows tenant logo with fallback to initials
- **Company Name**: Large, prominent display
- **Organization Type**: Agency, Customer, etc.
- **Branded Colors**: Uses tenant's accent color

### 📝 **Content Section**
- **Personalized Greeting**: Uses worker's first name
- **Invitation Details Card**: Shows all relevant information
- **Clear Call-to-Action**: Prominent "Accept Invitation" button
- **Expiration Notice**: Important reminder about deadline

### 🚀 **Features Overview**
- **Mobile App Access**: Highlight mobile capabilities
- **Work Schedules**: Mention assignment management
- **Team Communication**: Emphasize collaboration features
- **Performance Tracking**: Show work history benefits

### 📞 **Footer Section**
- **HR Contact**: Direct link to HR email
- **Support Links**: Help and privacy policy
- **Legal Footer**: Customizable legal text
- **Brand Attribution**: "Powered by HRX"

## Customization Options

### Branding Customization
- **Logo**: Upload in tenant branding settings
- **Accent Color**: Set in branding settings
- **Sender Name**: Customize "From" name
- **Legal Footer**: Add custom legal text

### Content Customization
- **Company Website**: Add in branding settings
- **HR Email**: Set contact email
- **Features List**: Modify in template HTML
- **Expiration Period**: Change in Firebase function

### Template Styling
- **Colors**: Modify CSS variables
- **Layout**: Adjust grid and spacing
- **Typography**: Change fonts and sizes
- **Responsive**: Mobile-first design

## Troubleshooting

### Common Issues

1. **Template Not Loading**
   - Verify template ID is correct
   - Check SendGrid API key
   - Ensure template is published

2. **Dynamic Variables Not Populating**
   - Check Firebase function logs
   - Verify tenant data exists
   - Test with fallback HTML

3. **Styling Issues**
   - Test in different email clients
   - Check responsive design
   - Verify CSS compatibility

### Debug Steps

1. **Check Firebase Logs**
   ```bash
   firebase functions:log --only inviteUserV2
   ```

2. **Test Template Variables**
   - Use SendGrid's test feature
   - Send to yourself first
   - Verify all data is present

3. **Validate HTML**
   - Use SendGrid's HTML validator
   - Check for broken links
   - Test image loading

## Best Practices

### Email Deliverability
- **Sender Authentication**: Verify your domain
- **Consistent Sending**: Use same "From" address
- **Clean Lists**: Remove bounced emails
- **Engagement**: Monitor open/click rates

### Template Design
- **Mobile First**: 60% of emails opened on mobile
- **Clear Hierarchy**: Important info at top
- **Accessible**: Good contrast ratios
- **Fast Loading**: Optimize images

### Content Strategy
- **Personalization**: Use recipient's name
- **Clear CTAs**: One primary action
- **Urgency**: Include expiration dates
- **Trust**: Show company branding

## Support

### SendGrid Support
- **Documentation**: [SendGrid Dynamic Templates](https://sendgrid.com/docs/ui/sending-email/how-to-send-an-email-with-dynamic-transactional-templates/)
- **API Reference**: [SendGrid API Docs](https://sendgrid.com/docs/api-reference/)
- **Help Center**: [SendGrid Help](https://support.sendgrid.com/)

### HRX Support
- **Technical Issues**: Check Firebase logs
- **Template Questions**: Review this guide
- **Customization**: Modify template HTML
- **Deployment**: Use Firebase CLI

## Next Steps

1. **Set up template in SendGrid**
2. **Update Firebase function with template ID**
3. **Test with a real invitation**
4. **Customize branding for your tenants**
5. **Monitor email performance**

Your dynamic worker invitation emails are now ready to provide a professional, branded experience for new team members! 