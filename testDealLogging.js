// Test script to verify deal logging is working
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, orderBy, getDocs } = require('firebase/firestore');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Initialize Firebase (you'll need to add your config)
const firebaseConfig = {
  // Add your Firebase config here
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);

async function testDealLogging() {
  console.log('🔍 Testing Deal Logging...');
  
  try {
    // Test 1: Check if AI logs are being created for deal activities
    console.log('\n📊 Checking AI logs for deal activities...');
    
    const logsRef = collection(db, 'ai_logs');
    const logsQuery = query(
      logsRef,
      where('eventType', 'in', ['deal.field_changed', 'deal.stage_advanced', 'deal.stage_data_saved']),
      orderBy('timestamp', 'desc')
    );
    
    const logsSnapshot = await getDocs(logsQuery);
    const logs = logsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    console.log(`✅ Found ${logs.length} deal-related AI logs`);
    
    if (logs.length > 0) {
      console.log('\n📋 Recent deal logs:');
      logs.slice(0, 5).forEach((log, index) => {
        console.log(`${index + 1}. ${log.eventType} - ${log.reason}`);
        console.log(`   Timestamp: ${log.timestamp?.toDate?.() || log.timestamp}`);
        console.log(`   User: ${log.userId}`);
        console.log(`   Target: ${log.targetId}`);
        console.log(`   Engines: ${log.engineTouched?.join(', ') || 'None'}`);
        console.log('');
      });
    }
    
    // Test 2: Check if CRMEngine is processing the logs
    console.log('\n🤖 Checking CRMEngine processing...');
    
    const crmLogs = logs.filter(log => 
      log.engineTouched?.includes('CRMEngine') || 
      log.contextType === 'crm'
    );
    
    console.log(`✅ Found ${crmLogs.length} logs processed by CRMEngine`);
    
    if (crmLogs.length > 0) {
      console.log('\n📋 CRMEngine processed logs:');
      crmLogs.slice(0, 3).forEach((log, index) => {
        console.log(`${index + 1}. ${log.eventType}`);
        console.log(`   Processing Results: ${log.processingResults?.length || 0} results`);
        console.log(`   Errors: ${log.errors?.length || 0} errors`);
        console.log('');
      });
    }
    
    // Test 3: Check for specific qualification field changes
    console.log('\n🎯 Checking qualification field changes...');
    
    const qualificationLogs = logs.filter(log => 
      log.eventType?.includes('qualification') || 
      log.reason?.includes('qualification')
    );
    
    console.log(`✅ Found ${qualificationLogs.length} qualification-related logs`);
    
    if (qualificationLogs.length > 0) {
      console.log('\n📋 Qualification field changes:');
      qualificationLogs.forEach((log, index) => {
        console.log(`${index + 1}. ${log.eventType}`);
        console.log(`   Reason: ${log.reason}`);
        console.log(`   AI Tags: ${log.aiTags?.join(', ')}`);
        console.log('');
      });
    }
    
    console.log('\n✅ Deal logging test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error testing deal logging:', error);
  }
}

// Run the test
testDealLogging(); 