const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./firebase copy.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkEmailLogs() {
  try {
    // Get all tenants
    const tenantsSnapshot = await db.collection('tenants').get();
    
    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantId = tenantDoc.id;
      console.log(`\n=== Checking Tenant: ${tenantId} ===`);
      
      // Check email_logs collection
      const emailLogsSnapshot = await db.collection('tenants').doc(tenantId).collection('email_logs').get();
      console.log(`Email logs found: ${emailLogsSnapshot.size}`);
      
      if (emailLogsSnapshot.size > 0) {
        console.log('Sample email logs:');
        emailLogsSnapshot.docs.slice(0, 3).forEach(doc => {
          const data = doc.data();
          console.log(`- ${data.subject} | From: ${data.from} | To: ${data.to} | Date: ${data.date}`);
        });
      }
      
      // Check gmail_imports collection
      const gmailImportsSnapshot = await db.collection('tenants').doc(tenantId).collection('gmail_imports').get();
      console.log(`Gmail imports found: ${gmailImportsSnapshot.size}`);
      
      if (gmailImportsSnapshot.size > 0) {
        console.log('Recent Gmail imports:');
        gmailImportsSnapshot.docs.slice(0, 3).forEach(doc => {
          const data = doc.data();
          console.log(`- Status: ${data.status} | Total Users: ${data.totalUsers} | Completed: ${data.completedUsers || 0}`);
          if (data.results) {
            Object.entries(data.results).forEach(([userId, result]) => {
              console.log(`  User ${userId}: ${result.emailsImported} emails, ${result.contactsFound} contacts`);
            });
          }
        });
      }
      
      // Check crm_contacts collection
      const contactsSnapshot = await db.collection('tenants').doc(tenantId).collection('crm_contacts').get();
      console.log(`CRM contacts found: ${contactsSnapshot.size}`);
    }
    
  } catch (error) {
    console.error('Error checking email logs:', error);
  }
}

checkEmailLogs().then(() => {
  console.log('\nCheck complete');
  process.exit(0);
});
