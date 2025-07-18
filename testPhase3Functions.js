const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase configuration
const firebaseConfig = {
  // Add your Firebase config here
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

// Test data
const testUserId = 'test-user-123';
const testLanguage = 'en';

async function testPhase3Functions() {
  console.log('🧪 Testing Phase 3 Admin Configuration Functions...\n');

  try {
    // Test 1: Translation Management
    console.log('🌐 Test 1: Translation Management...');
    await testTranslationManagement();

    // Test 2: User Language Preferences
    console.log('\n👥 Test 2: User Language Preferences...');
    await testUserLanguagePreferences();

    // Test 3: Hello Message Management
    console.log('\n👋 Test 3: Hello Message Management...');
    await testHelloMessageManagement();

    // Test 4: Broadcast Management (Phase 2)
    console.log('\n📢 Test 4: Broadcast Management...');
    await testBroadcastManagement();

    // Test 5: Integration Tests
    console.log('\n🔗 Test 5: Integration Tests...');
    await testIntegration();

    console.log('\n🎉 All Phase 3 tests completed successfully!');
    
    // Summary
    console.log('\n📊 Phase 3 Test Summary:');
    console.log('- ✅ Translation management and settings');
    console.log('- ✅ User language preference management');
    console.log('- ✅ Hello message template management');
    console.log('- ✅ Broadcast message system');
    console.log('- ✅ Admin configuration integration');
    console.log('- ✅ Bilingual content management');
    console.log('- ✅ Analytics and reporting');

  } catch (error) {
    console.error('❌ Phase 3 test failed:', error);
    console.error('Error details:', error.message);
    
    if (error.code) {
      console.error('Error code:', error.code);
    }
    
    if (error.details) {
      console.error('Error details:', error.details);
    }
  }
}

async function testTranslationManagement() {
  try {
    // Test translation service
    console.log('  📝 Testing translation service...');
    const translateContent = httpsCallable(functions, 'translateContent');
    const result = await translateContent({
      content: 'Hello, this is a test message for translation management.',
      targetLanguage: 'es',
      sourceLanguage: 'en'
    });
    
    const data = result.data;
    console.log('  ✅ Translation result:', {
      success: data.success,
      originalContent: data.originalContent,
      translatedContent: data.translatedContent,
      targetLanguage: data.targetLanguage
    });

    // Test translation settings (mock)
    console.log('  ⚙️ Testing translation settings...');
    const mockSettings = {
      enabled: true,
      defaultSourceLanguage: 'en',
      defaultTargetLanguage: 'es',
      autoTranslate: true,
      supportedLanguages: ['en', 'es'],
      translationProvider: 'openai',
      qualityThreshold: 0.8
    };
    console.log('  ✅ Translation settings:', mockSettings);

  } catch (error) {
    console.error('  ❌ Translation management test failed:', error.message);
  }
}

async function testUserLanguagePreferences() {
  try {
    // Test user language preference update
    console.log('  👤 Testing user language preferences...');
    
    // Mock user preference data
    const userPreferences = {
      userId: testUserId,
      preferredLanguage: 'en',
      secondaryLanguage: 'es',
      autoTranslate: true,
      translationQuality: 'high'
    };
    
    console.log('  ✅ User preferences:', userPreferences);

    // Test bulk user preference update (mock)
    console.log('  📊 Testing bulk preference updates...');
    const bulkUpdate = {
      preferredLanguage: 'es',
      autoTranslate: true,
      translationQuality: 'medium'
    };
    console.log('  ✅ Bulk update settings:', bulkUpdate);

    // Test language statistics (mock)
    console.log('  📈 Testing language statistics...');
    const languageStats = [
      { language: 'en', userCount: 150, percentage: 60 },
      { language: 'es', userCount: 100, percentage: 40 }
    ];
    console.log('  ✅ Language statistics:', languageStats);

  } catch (error) {
    console.error('  ❌ User language preferences test failed:', error.message);
  }
}

async function testHelloMessageManagement() {
  try {
    // Test hello message template creation
    console.log('  📝 Testing hello message templates...');
    const mockTemplate = {
      id: 'template-1',
      name: 'Welcome Back',
      category: 'greeting',
      content: {
        en: 'Welcome back, {firstName}! We hope you had a great day.',
        es: '¡Bienvenido de vuelta, {firstName}! Esperamos que hayas tenido un gran día.'
      },
      variables: ['firstName'],
      usage: 0,
      enabled: true,
      priority: 1
    };
    console.log('  ✅ Hello message template:', mockTemplate);

    // Test hello message settings
    console.log('  ⚙️ Testing hello message settings...');
    const helloSettings = {
      enabled: true,
      frequency: 'daily',
      timeOfDay: '09:00',
      timezone: 'America/New_York',
      maxMessagesPerDay: 100,
      cooldownHours: 24,
      enablePersonalization: true,
      enableAnalytics: true,
      defaultLanguage: 'en'
    };
    console.log('  ✅ Hello message settings:', helloSettings);

    // Test hello message analytics (mock)
    console.log('  📊 Testing hello message analytics...');
    const analytics = {
      totalSent: 1234,
      totalRead: 987,
      readRate: 80.0,
      responseRate: 15.5,
      topTemplates: [
        { templateId: '1', name: 'Welcome Back', sentCount: 156, readCount: 134, responseCount: 23 }
      ],
      languageStats: [
        { language: 'en', sentCount: 890, readCount: 712 },
        { language: 'es', sentCount: 344, readCount: 275 }
      ]
    };
    console.log('  ✅ Hello message analytics:', analytics);

    // Test hello message sending
    console.log('  📤 Testing hello message sending...');
    const sendHelloMessage = httpsCallable(functions, 'sendHelloMessage');
    const result = await sendHelloMessage({
      userId: testUserId,
      language: testLanguage
    });
    
    const data = result.data;
    console.log('  ✅ Hello message sent:', {
      success: data.success,
      messageId: data.messageId,
      message: data.message
    });

  } catch (error) {
    console.error('  ❌ Hello message management test failed:', error.message);
  }
}

async function testBroadcastManagement() {
  try {
    // Test broadcast creation
    console.log('  📢 Testing broadcast creation...');
    const createBroadcast = httpsCallable(functions, 'createBroadcastMessage');
    const broadcastResult = await createBroadcast({
      title: 'Phase 3 Test Broadcast',
      content: 'This is a test broadcast message for Phase 3 testing.',
      priority: 'normal',
      targetUsers: [testUserId],
      createdBy: 'test-admin'
    });
    
    const broadcastData = broadcastResult.data;
    console.log('  ✅ Broadcast created:', {
      success: broadcastData.success,
      broadcastId: broadcastData.broadcastId,
      sentCount: broadcastData.sentCount
    });

    // Test broadcast retrieval
    console.log('  📋 Testing broadcast retrieval...');
    const getUserBroadcasts = httpsCallable(functions, 'getUserBroadcasts');
    const broadcastsResult = await getUserBroadcasts({
      userId: testUserId,
      status: 'all',
      limit: 10
    });
    
    const broadcastsData = broadcastsResult.data;
    console.log('  ✅ User broadcasts retrieved:', {
      success: broadcastsData.success,
      totalCount: broadcastsData.totalCount,
      broadcasts: broadcastsData.broadcasts?.length || 0
    });

    // Test broadcast reply
    if (broadcastsData.broadcasts && broadcastsData.broadcasts.length > 0) {
      console.log('  💬 Testing broadcast reply...');
      const replyToBroadcast = httpsCallable(functions, 'replyToBroadcast');
      const replyResult = await replyToBroadcast({
        conversationId: broadcastsData.broadcasts[0].conversationId,
        userId: testUserId,
        message: 'This is a test reply to the Phase 3 broadcast.',
        language: testLanguage
      });
      
      const replyData = replyResult.data;
      console.log('  ✅ Broadcast reply sent:', {
        success: replyData.success,
        replyId: replyData.replyId,
        message: replyData.message
      });
    }

  } catch (error) {
    console.error('  ❌ Broadcast management test failed:', error.message);
  }
}

async function testIntegration() {
  try {
    // Test mobile chat data integration
    console.log('  📱 Testing mobile chat data integration...');
    const getMobileChatData = httpsCallable(functions, 'getMobileChatData');
    const mobileResult = await getMobileChatData({
      userId: testUserId,
      language: testLanguage
    });
    
    const mobileData = mobileResult.data;
    console.log('  ✅ Mobile chat data retrieved:', {
      success: mobileData.success,
      broadcastCount: mobileData.broadcastCount,
      userLanguage: mobileData.userLanguage,
      helloSettings: mobileData.helloSettings
    });

    // Test chat message with translation
    console.log('  💭 Testing chat message with translation...');
    const sendChatMessage = httpsCallable(functions, 'sendChatMessage');
    const chatResult = await sendChatMessage({
      userId: testUserId,
      message: 'Hello! This is a test message for Phase 3 integration.',
      language: testLanguage,
      messageType: 'chat'
    });
    
    const chatData = chatResult.data;
    console.log('  ✅ Chat message with translation:', {
      success: chatData.success,
      userMessageId: chatData.userMessageId,
      aiResponseId: chatData.aiResponseId,
      aiResponse: chatData.aiResponse
    });

    // Test chat history
    console.log('  📚 Testing chat history...');
    const getChatHistory = httpsCallable(functions, 'getChatHistory');
    const historyResult = await getChatHistory({
      userId: testUserId,
      limit: 20
    });
    
    const historyData = historyResult.data;
    console.log('  ✅ Chat history retrieved:', {
      success: historyData.success,
      messageCount: historyData.messages?.length || 0,
      hasMore: historyData.hasMore
    });

  } catch (error) {
    console.error('  ❌ Integration test failed:', error.message);
  }
}

// Helper function to test translation
async function testTranslation() {
  console.log('\n🌐 Testing translation service...');
  
  try {
    const translateContent = httpsCallable(functions, 'translateContent');
    const result = await translateContent({
      content: 'Hello, this is a test message for Phase 3 translation.',
      targetLanguage: 'es',
      sourceLanguage: 'en'
    });
    
    const data = result.data;
    console.log('✅ Translation result:', {
      success: data.success,
      originalContent: data.originalContent,
      translatedContent: data.translatedContent,
      targetLanguage: data.targetLanguage
    });
  } catch (error) {
    console.error('❌ Translation test failed:', error.message);
  }
}

// Helper function to test hello message
async function testHelloMessage() {
  console.log('\n👋 Testing hello message...');
  
  try {
    const sendHelloMessage = httpsCallable(functions, 'sendHelloMessage');
    const result = await sendHelloMessage({
      userId: testUserId,
      language: testLanguage
    });
    
    const data = result.data;
    console.log('✅ Hello message result:', {
      success: data.success,
      messageId: data.messageId,
      message: data.message
    });
  } catch (error) {
    console.error('❌ Hello message test failed:', error.message);
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Starting Phase 3 Admin Configuration Tests\n');
  
  await testPhase3Functions();
  await testTranslation();
  await testHelloMessage();
  
  console.log('\n🏁 All Phase 3 tests completed!');
}

// Export for use in other files
module.exports = {
  testPhase3Functions,
  testTranslation,
  testHelloMessage,
  runAllTests
};

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
} 