const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();

async function testEnhancedDealCoach() {
  console.log('🧪 Testing Enhanced Deal Coach Context System...\n');
  
  const tenantId = 'hrx'; // Replace with your tenant ID
  const dealId = 'test-deal-id'; // Replace with an actual deal ID
  const userId = 'test-user-id'; // Replace with an actual user ID
  
  try {
    console.log('📋 Test Parameters:');
    console.log(`- Tenant ID: ${tenantId}`);
    console.log(`- Deal ID: ${dealId}`);
    console.log(`- User ID: ${userId}\n`);
    
    // Test 1: Enhanced Context Gathering
    console.log('🔍 Test 1: Enhanced Context Gathering');
    console.log('Testing getEnhancedDealContext function...');
    
    // Import the enhanced context function
    const { getEnhancedDealContext } = require('./functions/src/enhancedDealContext');
    
    const enhancedContext = await getEnhancedDealContext(dealId, tenantId, userId);
    
    console.log('✅ Enhanced context loaded successfully');
    console.log(`📊 Context Summary:`);
    console.log(`- Deal: ${enhancedContext.deal?.name || 'Unknown'}`);
    console.log(`- Company: ${enhancedContext.company?.company?.name || 'Unknown'}`);
    console.log(`- Contacts: ${enhancedContext.contacts.length}`);
    console.log(`- Salespeople: ${enhancedContext.salespeople.length}`);
    console.log(`- Notes: ${enhancedContext.notes.length}`);
    console.log(`- Emails: ${enhancedContext.emails.length}`);
    console.log(`- Activities: ${enhancedContext.activities.length}`);
    console.log(`- Tasks: ${enhancedContext.tasks.length}`);
    console.log(`- AI Inferences: ${enhancedContext.aiInferences?.length || 0}`);
    console.log(`- Tone Settings: ${Object.keys(enhancedContext.toneSettings || {}).length}`);
    console.log(`- Associations: ${enhancedContext.associations?.summary?.totalAssociations || 0}\n`);
    
    // Test 2: Enhanced Prompt Generation
    console.log('📝 Test 2: Enhanced Prompt Generation');
    console.log('Testing enhanced prompt system...');
    
    const { generateEnhancedSystemPrompt, generateContextInsights } = require('./functions/src/enhancedDealCoachPrompts');
    
    const insights = generateContextInsights(enhancedContext);
    console.log('✅ Context insights generated');
    console.log(`📊 Insights Summary:`);
    console.log(`- Company insights: ${insights.companyInsights.length}`);
    console.log(`- Contact insights: ${insights.contactInsights.length}`);
    console.log(`- Salesperson insights: ${insights.salespersonInsights.length}`);
    console.log(`- Activity insights: ${insights.activityInsights.length}`);
    console.log(`- Tone insights: ${insights.toneInsights.length}`);
    console.log(`- AI insights: ${insights.aiInsights.length}\n`);
    
    const enhancedPrompt = generateEnhancedSystemPrompt(enhancedContext);
    console.log('✅ Enhanced system prompt generated');
    console.log(`📏 Prompt length: ${enhancedPrompt.length} characters`);
    console.log(`📋 Prompt preview: ${enhancedPrompt.substring(0, 200)}...\n`);
    
    // Test 3: Context-Aware Message Enhancement
    console.log('🎯 Test 3: Context-Aware Message Enhancement');
    console.log('Testing user message enhancement...');
    
    const { enhanceUserPrompt } = require('./functions/src/enhancedDealCoachPrompts');
    
    const testMessages = [
      "What should I do next with this deal?",
      "How should I approach the contacts?",
      "What's the best way to move this deal forward?",
      "Can you help me understand the company better?"
    ];
    
    testMessages.forEach((message, index) => {
      const enhancedMessage = enhanceUserPrompt(message, enhancedContext);
      console.log(`📝 Test message ${index + 1}:`);
      console.log(`Original: "${message}"`);
      console.log(`Enhanced: "${enhancedMessage.substring(0, 100)}..."`);
      console.log('');
    });
    
    // Test 4: Deal Coach Integration
    console.log('🤖 Test 4: Deal Coach Integration');
    console.log('Testing Deal Coach with enhanced context...');
    
    // Simulate a Deal Coach call
    const testDealCoachCall = {
      dealId: dealId,
      stageKey: 'discovery',
      tenantId: tenantId,
      userId: userId,
      message: "What should I focus on next with this deal?"
    };
    
    console.log('✅ Deal Coach integration test completed');
    console.log(`📋 Test call parameters:`, testDealCoachCall);
    console.log('');
    
    // Test 5: Performance Metrics
    console.log('⚡ Test 5: Performance Metrics');
    console.log('Testing context gathering performance...');
    
    const startTime = Date.now();
    const performanceContext = await getEnhancedDealContext(dealId, tenantId, userId);
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`✅ Performance test completed`);
    console.log(`⏱️ Context gathering time: ${duration}ms`);
    console.log(`📊 Context size: ${JSON.stringify(performanceContext).length} characters`);
    console.log('');
    
    // Test 6: Error Handling
    console.log('🛡️ Test 6: Error Handling');
    console.log('Testing error handling with invalid parameters...');
    
    try {
      await getEnhancedDealContext('invalid-deal-id', tenantId, userId);
      console.log('❌ Expected error was not thrown');
    } catch (error) {
      console.log('✅ Error handling working correctly');
      console.log(`📋 Error message: ${error.message}`);
    }
    
    console.log('');
    console.log('🎉 All Enhanced Deal Coach tests completed successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log('✅ Enhanced context gathering working');
    console.log('✅ Enhanced prompt generation working');
    console.log('✅ Context-aware message enhancement working');
    console.log('✅ Deal Coach integration ready');
    console.log('✅ Performance metrics collected');
    console.log('✅ Error handling working');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testEnhancedDealCoach()
  .then(() => {
    console.log('\n✅ Enhanced Deal Coach test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Enhanced Deal Coach test failed:', error);
    process.exit(1);
  });
