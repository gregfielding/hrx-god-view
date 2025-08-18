const admin = require('firebase-admin');
const { google } = require('googleapis');
const { defineString } = require('firebase-functions/params');

// Initialize Firebase Admin
const serviceAccount = require('./firebase copy.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Test calendar sync functionality
async function testCalendarSync() {
  console.log('🧪 Testing Google Calendar Sync Functionality...\n');

  try {
    // 1. Find a user with calendar tokens
    console.log('1️⃣ Finding user with calendar tokens...');
    const usersSnapshot = await db.collection('users').limit(10).get();
    
    let testUser = null;
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      if (userData.calendarTokens?.access_token) {
        testUser = { id: userDoc.id, ...userData };
        break;
      }
    }

    if (!testUser) {
      console.log('❌ No users with calendar tokens found. Cannot test sync.');
      return;
    }

    console.log(`✅ Found test user: ${testUser.id}`);
    console.log(`   - Calendar connected: ${testUser.calendarConnected}`);
    console.log(`   - Token expiry: ${testUser.calendarTokens.expiry_date ? new Date(testUser.calendarTokens.expiry_date) : 'N/A'}`);
    console.log('');

    // 2. Test OAuth client setup
    console.log('2️⃣ Testing OAuth client setup...');
    const clientId = defineString('GOOGLE_CLIENT_ID');
    const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
    const redirectUri = defineString('GOOGLE_REDIRECT_URI');

    const oauth2Client = new google.auth.OAuth2(
      clientId.value(),
      clientSecret.value(),
      redirectUri.value()
    );

    oauth2Client.setCredentials(testUser.calendarTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Test calendar access
    const calendarList = await calendar.calendarList.list();
    console.log(`✅ Calendar API access successful. Found ${calendarList.data.items?.length || 0} calendars`);
    console.log('');

    // 3. Create a test task
    console.log('3️⃣ Creating test appointment task...');
    const testTenantId = 'test-tenant'; // You'll need to replace with actual tenant ID
    const testTaskData = {
      title: 'Test Calendar Sync Appointment',
      description: 'This is a test appointment to verify calendar sync functionality',
      type: 'scheduled_meeting_virtual',
      priority: 'medium',
      status: 'scheduled',
      classification: 'appointment',
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
      duration: 60, // 1 hour
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
      scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      assignedTo: testUser.id,
      createdBy: testUser.id,
      tenantId: testTenantId,
      category: 'business_generating',
      quotaCategory: 'business_generating',
      associations: {},
      meetingAttendees: [
        {
          email: 'test@example.com',
          displayName: 'Test Attendee'
        }
      ]
    };

    // Create task in Firestore
    const taskRef = await db.collection('tenants').doc(testTenantId).collection('tasks').add({
      ...testTaskData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Test task created: ${taskRef.id}`);
    console.log('');

    // 4. Test calendar sync
    console.log('4️⃣ Testing calendar sync...');
    
    // Import the sync function
    const { syncTaskToCalendar } = require('./functions/lib/calendarSyncService');
    
    const syncResult = await syncTaskToCalendar(
      testUser.id,
      testTenantId,
      taskRef.id,
      testTaskData
    );

    console.log('Sync result:', syncResult);
    console.log('');

    // 5. Verify the task was updated
    console.log('5️⃣ Verifying task update...');
    const updatedTask = await db.collection('tenants').doc(testTenantId).collection('tasks').doc(taskRef.id).get();
    const updatedTaskData = updatedTask.data();
    
    console.log('Updated task data:');
    console.log(`  - Google Calendar Event ID: ${updatedTaskData.googleCalendarEventId || 'Not set'}`);
    console.log(`  - Sync Status: ${updatedTaskData.syncStatus || 'Unknown'}`);
    console.log(`  - Last Google Sync: ${updatedTaskData.lastGoogleSync || 'Never'}`);
    console.log(`  - Google Meet Link: ${updatedTaskData.googleMeetLink || 'Not set'}`);
    console.log('');

    // 6. Verify calendar event was created
    if (updatedTaskData.googleCalendarEventId) {
      console.log('6️⃣ Verifying calendar event...');
      try {
        const event = await calendar.events.get({
          calendarId: 'primary',
          eventId: updatedTaskData.googleCalendarEventId
        });
        
        console.log('✅ Calendar event found:');
        console.log(`  - Summary: ${event.data.summary}`);
        console.log(`  - Start: ${event.data.start?.dateTime}`);
        console.log(`  - End: ${event.data.end?.dateTime}`);
        console.log(`  - Meet Link: ${event.data.hangoutLink || 'Not set'}`);
        console.log('');
      } catch (error) {
        console.log('❌ Failed to retrieve calendar event:', error.message);
      }
    }

    // 7. Clean up test data
    console.log('7️⃣ Cleaning up test data...');
    try {
      // Delete calendar event if it was created
      if (updatedTaskData.googleCalendarEventId) {
        await calendar.events.delete({
          calendarId: 'primary',
          eventId: updatedTaskData.googleCalendarEventId
        });
        console.log('✅ Calendar event deleted');
      }
      
      // Delete test task
      await db.collection('tenants').doc(testTenantId).collection('tasks').doc(taskRef.id).delete();
      console.log('✅ Test task deleted');
    } catch (error) {
      console.log('⚠️ Cleanup failed:', error.message);
    }

    console.log('✅ Calendar sync test completed successfully!');

  } catch (error) {
    console.error('❌ Calendar sync test failed:', error);
  }
}

// Run the test
testCalendarSync().then(() => {
  console.log('🏁 Test finished');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test crashed:', error);
  process.exit(1);
});
