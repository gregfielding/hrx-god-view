const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./firebase copy.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function simpleCalendarDebug() {
  console.log('🔍 Simple Google Calendar Sync Diagnostic...\n');

  try {
    // 1. Check environment variables
    console.log('1️⃣ Checking Environment Variables:');
    console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✅ Set' : '❌ Missing');
    console.log('GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? '✅ Set' : '❌ Missing');
    console.log('GOOGLE_REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI ? '✅ Set' : '❌ Missing');
    console.log('');

    // 2. Check user calendar tokens
    console.log('2️⃣ Checking User Calendar Tokens:');
    const usersSnapshot = await db.collection('users').limit(5).get();
    
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      console.log(`User: ${userDoc.id}`);
      console.log(`  - Calendar Connected: ${userData.calendarConnected || false}`);
      console.log(`  - Has Calendar Tokens: ${!!userData.calendarTokens?.access_token}`);
      console.log(`  - Token Expiry: ${userData.calendarTokens?.expiry_date ? new Date(userData.calendarTokens.expiry_date) : 'N/A'}`);
      console.log(`  - Gmail Connected: ${userData.gmailConnected || false}`);
      console.log(`  - Has Gmail Tokens: ${!!userData.gmailTokens?.access_token}`);
      console.log('');
    }

    // 3. Check recent tasks with appointment classification
    console.log('3️⃣ Checking Recent Appointment Tasks:');
    const tasksSnapshot = await db.collectionGroup('tasks')
      .where('classification', '==', 'appointment')
      .where('createdAt', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Last 7 days
      .limit(10)
      .get();

    console.log(`Found ${tasksSnapshot.docs.length} recent appointment tasks:`);
    
    for (const taskDoc of tasksSnapshot.docs) {
      const taskData = taskDoc.data();
      console.log(`Task: ${taskDoc.id} - ${taskData.title}`);
      console.log(`  - Classification: ${taskData.classification}`);
      console.log(`  - Start Time: ${taskData.startTime || 'Missing'}`);
      console.log(`  - Duration: ${taskData.duration || 'Missing'}`);
      console.log(`  - Google Calendar Event ID: ${taskData.googleCalendarEventId || 'Not synced'}`);
      console.log(`  - Sync Status: ${taskData.syncStatus || 'Unknown'}`);
      console.log(`  - Last Google Sync: ${taskData.lastGoogleSync || 'Never'}`);
      console.log(`  - Tenant: ${taskData.tenantId}`);
      console.log(`  - Assigned To: ${taskData.assignedTo}`);
      console.log('');
    }

    // 4. Check for sync errors
    console.log('4️⃣ Checking for Recent Sync Errors:');
    const errorTasks = await db.collectionGroup('tasks')
      .where('syncStatus', '==', 'failed')
      .limit(5)
      .get();

    console.log(`Found ${errorTasks.docs.length} tasks with failed sync status:`);
    for (const taskDoc of errorTasks.docs) {
      const taskData = taskDoc.data();
      console.log(`Task: ${taskDoc.id} - ${taskData.title}`);
      console.log(`  - Last Sync: ${taskData.lastGoogleSync || 'Never'}`);
      console.log(`  - Tenant: ${taskData.tenantId}`);
      console.log(`  - Assigned To: ${taskData.assignedTo}`);
      console.log('');
    }

    // 5. Check Firebase config
    console.log('5️⃣ Checking Firebase Config:');
    try {
      const config = await admin.functions().config();
      console.log('Firebase config available:', !!config);
      if (config.google) {
        console.log('Google config found:', Object.keys(config.google));
      } else {
        console.log('❌ No Google config found in Firebase');
      }
    } catch (error) {
      console.log('❌ Error accessing Firebase config:', error.message);
    }

    console.log('✅ Diagnostic complete!');

  } catch (error) {
    console.error('❌ Diagnostic failed:', error);
  }
}

// Run the diagnostic
simpleCalendarDebug().then(() => {
  console.log('🏁 Diagnostic finished');
  process.exit(0);
}).catch(error => {
  console.error('💥 Diagnostic crashed:', error);
  process.exit(1);
});
