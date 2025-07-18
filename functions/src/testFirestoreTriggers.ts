import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * 🔧 MAINTENANCE CHECKLIST FOR DEVELOPERS
 * 
 * WHEN YOU ADD/CHANGE LOGGING TRIGGERS, YOU MUST:
 * 
 * 1. ✅ Add test methods for new collections/triggers
 * 2. ✅ Update the runAllTests() method to call new test methods
 * 3. ✅ Update the getTargetTypeFromCollection() method for new collections
 * 4. ✅ Update the getEventTypeFromOperation() method if new event types are added
 * 5. ✅ Update the validateLogStructure() method if log schema changes
 * 6. ✅ Test the new triggers manually before committing
 * 7. ✅ Update this checklist if new maintenance steps are needed
 * 
 * CURRENT COLLECTIONS WITH TRIGGERS:
 * - users
 * - agencies
 * - customers  
 * - assignments
 * - conversations
 * - jobOrders
 * - campaigns
 * - motivations
 * - messages (subcollection)
 * - shifts (subcollection)
 * - userGroups
 * - locations
 * - notifications
 * - settings
 * - ai_logs (meta-logging)
 * - agencyContacts (subcollection)
 * - appAiSettings
 * - customers/{customerId}/aiSettings
 * - agencies/{agencyId}/aiSettings
 * - departments
 * - customers/{customerId}/departments
 * 
 * LAST UPDATED: [Update this date when you modify tests]
 * NEXT REVIEW: [Set a reminder for 1-2 weeks from last update]
 */

export interface TestResult {
  triggerName: string;
  success: boolean;
  error?: string;
  logId?: string;
  logData?: any;
  testData?: any;
  timestamp: string;
}

interface TestSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
  startTime: string;
  endTime: string;
  duration: number;
}

class FirestoreTriggerTester {
  private testResults: TestResult[] = [];
  private startTime: Date;

  constructor() {
    this.startTime = new Date();
  }

  async runAllTests(): Promise<TestSummary> {
    console.log('🚀 Starting Firestore Trigger Tests...');
    console.log('=====================================');

    // Test AI Settings Triggers
    await this.testGlobalAISettingsTriggers();
    await this.testCustomerAISettingsTriggers();
    await this.testAgencyAISettingsTriggers();

    // Test Department Triggers
    await this.testDepartmentTriggers();
    await this.testCustomerDepartmentTriggers();

    // Test Core Collection Triggers (already implemented)
    await this.testUserTriggers();
    await this.testAgencyTriggers();
    await this.testCustomerTriggers();
    await this.testAssignmentTriggers();
    await this.testConversationTriggers();
    await this.testJobOrderTriggers();
    await this.testCampaignTriggers();
    await this.testMotivationTriggers();
    await this.testMessageTriggers();
    await this.testShiftTriggers();
    await this.testUserGroupTriggers();
    await this.testLocationTriggers();
    await this.testNotificationTriggers();
    await this.testSettingTriggers();
    await this.testAILogTriggers();
    await this.testAgencyContactTriggers();

    const endTime = new Date();
    const duration = endTime.getTime() - this.startTime.getTime();

    const summary: TestSummary = {
      totalTests: this.testResults.length,
      passedTests: this.testResults.filter(r => r.success).length,
      failedTests: this.testResults.filter(r => !r.success).length,
      results: this.testResults,
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration
    };

    this.printSummary(summary);
    return summary;
  }

  private async testGlobalAISettingsTriggers() {
    console.log('\n📋 Testing Global AI Settings Triggers...');
    
    const testData = {
      name: 'Test Global Setting',
      type: 'tone',
      value: 'professional',
      description: 'Test setting for trigger validation',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Test Creation
    await this.testTrigger('Global AI Settings Creation', 'appAiSettings', testData, 'create');
    
    // Test Update
    const updateData = { ...testData, value: 'casual', updatedBy: 'test-user' };
    await this.testTrigger('Global AI Settings Update', 'appAiSettings', updateData, 'update');
    
    // Test Deletion
    await this.testTrigger('Global AI Settings Deletion', 'appAiSettings', testData, 'delete');
  }

  private async testCustomerAISettingsTriggers() {
    console.log('\n📋 Testing Customer AI Settings Triggers...');
    
    const customerId = 'test-customer-123';
    const testData = {
      name: 'Customer Tone Setting',
      type: 'tone',
      value: 'friendly',
      description: 'Test customer setting',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Customer AI Settings Creation', `customers/${customerId}/aiSettings`, testData, 'create');
    
    const updateData = { ...testData, value: 'formal', updatedBy: 'test-user' };
    await this.testTrigger('Customer AI Settings Update', `customers/${customerId}/aiSettings`, updateData, 'update');
    
    await this.testTrigger('Customer AI Settings Deletion', `customers/${customerId}/aiSettings`, testData, 'delete');
  }

  private async testAgencyAISettingsTriggers() {
    console.log('\n📋 Testing Agency AI Settings Triggers...');
    
    const agencyId = 'test-agency-123';
    const testData = {
      name: 'Agency Communication Setting',
      type: 'communication',
      value: 'direct',
      description: 'Test agency setting',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Agency AI Settings Creation', `agencies/${agencyId}/aiSettings`, testData, 'create');
    
    const updateData = { ...testData, value: 'indirect', updatedBy: 'test-user' };
    await this.testTrigger('Agency AI Settings Update', `agencies/${agencyId}/aiSettings`, updateData, 'update');
    
    await this.testTrigger('Agency AI Settings Deletion', `agencies/${agencyId}/aiSettings`, testData, 'delete');
  }

  private async testDepartmentTriggers() {
    console.log('\n📋 Testing Department Triggers...');
    
    const testData = {
      name: 'Test Department',
      description: 'Test department for trigger validation',
      customerId: 'test-customer-123',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Department Creation', 'departments', testData, 'create');
    
    const updateData = { ...testData, name: 'Updated Test Department', updatedBy: 'test-user' };
    await this.testTrigger('Department Update', 'departments', updateData, 'update');
    
    await this.testTrigger('Department Deletion', 'departments', testData, 'delete');
  }

  private async testCustomerDepartmentTriggers() {
    console.log('\n📋 Testing Customer Department Triggers...');
    
    const customerId = 'test-customer-123';
    const testData = {
      name: 'Customer Test Department',
      description: 'Test customer department',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Customer Department Creation', `customers/${customerId}/departments`, testData, 'create');
    
    const updateData = { ...testData, name: 'Updated Customer Department', updatedBy: 'test-user' };
    await this.testTrigger('Customer Department Update', `customers/${customerId}/departments`, updateData, 'update');
    
    await this.testTrigger('Customer Department Deletion', `customers/${customerId}/departments`, testData, 'delete');
  }

  private async testUserTriggers() {
    console.log('\n📋 Testing User Triggers...');
    
    const testData = {
      email: 'test@example.com',
      displayName: 'Test User',
      role: 'Worker',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('User Creation', 'users', testData, 'create');
    
    const updateData = { ...testData, displayName: 'Updated Test User', updatedBy: 'test-user' };
    await this.testTrigger('User Update', 'users', updateData, 'update');
    
    await this.testTrigger('User Deletion', 'users', testData, 'delete');
  }

  private async testAgencyTriggers() {
    console.log('\n📋 Testing Agency Triggers...');
    
    const testData = {
      name: 'Test Agency',
      description: 'Test agency for trigger validation',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Agency Creation', 'agencies', testData, 'create');
    
    const updateData = { ...testData, name: 'Updated Test Agency', updatedBy: 'test-user' };
    await this.testTrigger('Agency Update', 'agencies', updateData, 'update');
    
    await this.testTrigger('Agency Deletion', 'agencies', testData, 'delete');
  }

  private async testCustomerTriggers() {
    console.log('\n📋 Testing Customer Triggers...');
    
    const testData = {
      name: 'Test Customer',
      description: 'Test customer for trigger validation',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Customer Creation', 'customers', testData, 'create');
    
    const updateData = { ...testData, name: 'Updated Test Customer', updatedBy: 'test-user' };
    await this.testTrigger('Customer Update', 'customers', updateData, 'update');
    
    await this.testTrigger('Customer Deletion', 'customers', testData, 'delete');
  }

  private async testAssignmentTriggers() {
    console.log('\n📋 Testing Assignment Triggers...');
    
    const testData = {
      workerId: 'test-worker-123',
      customerId: 'test-customer-123',
      status: 'pending',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Assignment Creation', 'assignments', testData, 'create');
    
    const updateData = { ...testData, status: 'active', updatedBy: 'test-user' };
    await this.testTrigger('Assignment Update', 'assignments', updateData, 'update');
    
    await this.testTrigger('Assignment Deletion', 'assignments', testData, 'delete');
  }

  private async testConversationTriggers() {
    console.log('\n📋 Testing Conversation Triggers...');
    
    const testData = {
      workerId: 'test-worker-123',
      customerId: 'test-customer-123',
      type: 'general',
      status: 'active',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Conversation Creation', 'conversations', testData, 'create');
    
    const updateData = { ...testData, status: 'closed', updatedBy: 'test-user' };
    await this.testTrigger('Conversation Update', 'conversations', updateData, 'update');
    
    await this.testTrigger('Conversation Deletion', 'conversations', testData, 'delete');
  }

  private async testJobOrderTriggers() {
    console.log('\n📋 Testing Job Order Triggers...');
    
    const testData = {
      title: 'Test Job Order',
      customerId: 'test-customer-123',
      status: 'draft',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Job Order Creation', 'jobOrders', testData, 'create');
    
    const updateData = { ...testData, status: 'active', updatedBy: 'test-user' };
    await this.testTrigger('Job Order Update', 'jobOrders', updateData, 'update');
    
    await this.testTrigger('Job Order Deletion', 'jobOrders', testData, 'delete');
  }

  private async testCampaignTriggers() {
    console.log('\n📋 Testing Campaign Triggers...');
    
    const testData = {
      title: 'Test Campaign',
      objective: 'Test objective',
      status: 'draft',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Campaign Creation', 'campaigns', testData, 'create');
    
    const updateData = { ...testData, status: 'active', updatedBy: 'test-user' };
    await this.testTrigger('Campaign Update', 'campaigns', updateData, 'update');
    
    await this.testTrigger('Campaign Deletion', 'campaigns', testData, 'delete');
  }

  private async testMotivationTriggers() {
    console.log('\n📋 Testing Motivation Triggers...');
    
    const testData = {
      title: 'Test Motivation',
      content: 'Test motivation content',
      type: 'general',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Motivation Creation', 'motivations', testData, 'create');
    
    const updateData = { ...testData, content: 'Updated motivation content', updatedBy: 'test-user' };
    await this.testTrigger('Motivation Update', 'motivations', updateData, 'update');
    
    await this.testTrigger('Motivation Deletion', 'motivations', testData, 'delete');
  }

  private async testMessageTriggers() {
    console.log('\n📋 Testing Message Triggers...');
    
    const conversationId = 'test-conversation-123';
    const testData = {
      content: 'Test message content',
      senderId: 'test-user',
      type: 'text',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Message Creation', `conversations/${conversationId}/messages`, testData, 'create');
    
    const updateData = { ...testData, content: 'Updated message content', updatedBy: 'test-user' };
    await this.testTrigger('Message Update', `conversations/${conversationId}/messages`, updateData, 'update');
    
    await this.testTrigger('Message Deletion', `conversations/${conversationId}/messages`, testData, 'delete');
  }

  private async testShiftTriggers() {
    console.log('\n📋 Testing Shift Triggers...');
    
    const jobOrderId = 'test-job-order-123';
    const testData = {
      title: 'Test Shift',
      startTime: new Date(),
      endTime: new Date(),
      status: 'scheduled',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Shift Creation', `jobOrders/${jobOrderId}/shifts`, testData, 'create');
    
    const updateData = { ...testData, status: 'in-progress', updatedBy: 'test-user' };
    await this.testTrigger('Shift Update', `jobOrders/${jobOrderId}/shifts`, updateData, 'update');
    
    await this.testTrigger('Shift Deletion', `jobOrders/${jobOrderId}/shifts`, testData, 'delete');
  }

  private async testUserGroupTriggers() {
    console.log('\n📋 Testing User Group Triggers...');
    
    const testData = {
      name: 'Test User Group',
      description: 'Test user group',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('User Group Creation', 'userGroups', testData, 'create');
    
    const updateData = { ...testData, name: 'Updated Test User Group', updatedBy: 'test-user' };
    await this.testTrigger('User Group Update', 'userGroups', updateData, 'update');
    
    await this.testTrigger('User Group Deletion', 'userGroups', testData, 'delete');
  }

  private async testLocationTriggers() {
    console.log('\n📋 Testing Location Triggers...');
    
    const testData = {
      name: 'Test Location',
      address: '123 Test St',
      city: 'Test City',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Location Creation', 'locations', testData, 'create');
    
    const updateData = { ...testData, name: 'Updated Test Location', updatedBy: 'test-user' };
    await this.testTrigger('Location Update', 'locations', updateData, 'update');
    
    await this.testTrigger('Location Deletion', 'locations', testData, 'delete');
  }

  private async testNotificationTriggers() {
    console.log('\n📋 Testing Notification Triggers...');
    
    const testData = {
      title: 'Test Notification',
      message: 'Test notification message',
      recipientId: 'test-user',
      type: 'general',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Notification Creation', 'notifications', testData, 'create');
    
    const updateData = { ...testData, status: 'read', updatedBy: 'test-user' };
    await this.testTrigger('Notification Update', 'notifications', updateData, 'update');
    
    await this.testTrigger('Notification Deletion', 'notifications', testData, 'delete');
  }

  private async testSettingTriggers() {
    console.log('\n📋 Testing Setting Triggers...');
    
    const testData = {
      name: 'Test Setting',
      value: 'test-value',
      type: 'string',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Setting Creation', 'settings', testData, 'create');
    
    const updateData = { ...testData, value: 'updated-test-value', updatedBy: 'test-user' };
    await this.testTrigger('Setting Update', 'settings', updateData, 'update');
    
    await this.testTrigger('Setting Deletion', 'settings', testData, 'delete');
  }

  private async testAILogTriggers() {
    console.log('\n📋 Testing AI Log Triggers...');
    
    const testData = {
      actionType: 'test_action',
      sourceModule: 'TestModule',
      success: true,
      userId: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('AI Log Creation', 'ai_logs', testData, 'create');
    
    const updateData = { ...testData, processed: true, updatedBy: 'test-user' };
    await this.testTrigger('AI Log Update', 'ai_logs', updateData, 'update');
    
    await this.testTrigger('AI Log Deletion', 'ai_logs', testData, 'delete');
  }

  private async testAgencyContactTriggers() {
    console.log('\n📋 Testing Agency Contact Triggers...');
    
    const agencyId = 'test-agency-123';
    const testData = {
      name: 'Test Contact',
      email: 'contact@test.com',
      role: 'Manager',
      createdBy: 'test-user',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.testTrigger('Agency Contact Creation', `agencies/${agencyId}/contacts`, testData, 'create');
    
    const updateData = { ...testData, role: 'Director', updatedBy: 'test-user' };
    await this.testTrigger('Agency Contact Update', `agencies/${agencyId}/contacts`, updateData, 'update');
    
    await this.testTrigger('Agency Contact Deletion', `agencies/${agencyId}/contacts`, testData, 'delete');
  }

  private async testTrigger(triggerName: string, collectionPath: string, testData: any, operation: 'create' | 'update' | 'delete'): Promise<void> {
    try {
      console.log(`  Testing: ${triggerName}...`);
      
      const docId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const docRef = db.collection(collectionPath).doc(docId);
      
      let logId: string | undefined;
      let logData: any;

      // Perform the operation
      if (operation === 'create') {
        await docRef.set(testData);
      } else if (operation === 'update') {
        await docRef.set(testData);
        await docRef.update({ updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      } else if (operation === 'delete') {
        await docRef.set(testData);
        await docRef.delete();
      }

      // Wait a moment for the trigger to fire
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check for the corresponding AI log
      const targetType = this.getTargetTypeFromCollection(collectionPath);
      const eventType = this.getEventTypeFromCollection(collectionPath, operation);
      
      console.log(`      Looking for logs with targetType: "${targetType}", eventType: "${eventType}"`);
      
      const logsQuery = await db.collection('ai_logs')
        .where('targetType', '==', targetType)
        .where('eventType', '==', eventType)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (!logsQuery.empty) {
        const logDoc = logsQuery.docs[0];
        logId = logDoc.id;
        logData = logDoc.data();
        
        // Verify log structure
        const isValid = this.validateLogStructure(logData, operation, collectionPath);
        
        if (isValid) {
          this.testResults.push({
            triggerName,
            success: true,
            logId,
            logData,
            testData,
            timestamp: new Date().toISOString()
          });
          console.log(`    ✅ ${triggerName} - PASSED`);
        } else {
          this.testResults.push({
            triggerName,
            success: false,
            error: 'Log structure validation failed',
            logId,
            logData,
            testData,
            timestamp: new Date().toISOString()
          });
          console.log(`    ❌ ${triggerName} - FAILED (Invalid log structure)`);
        }
      } else {
        this.testResults.push({
          triggerName,
          success: false,
          error: 'No AI log found for trigger',
          testData,
          timestamp: new Date().toISOString()
        });
        console.log(`    ❌ ${triggerName} - FAILED (No log found)`);
      }

      // Clean up test document if it still exists
      try {
        await docRef.delete();
      } catch (e) {
        // Document might already be deleted
      }

    } catch (error: any) {
      this.testResults.push({
        triggerName,
        success: false,
        error: error.message,
        testData,
        timestamp: new Date().toISOString()
      });
      console.log(`    ❌ ${triggerName} - FAILED (${error.message})`);
    }
  }

  private getTargetTypeFromCollection(collectionPath: string): string {
    const parts = collectionPath.split('/');
    let collectionName: string;
    
    if (parts.length === 1) {
      collectionName = parts[0];
    } else if (parts.length === 3) {
      collectionName = parts[2]; // Subcollection
    } else {
      return 'unknown';
    }
    
    // Special mappings for collections that don't follow simple pluralization rules
    const targetTypeMap: { [key: string]: string } = {
      'agencies': 'agency',
      'jobOrders': 'job_order',
      'userGroups': 'user_group',
      'agencyContacts': 'contact',
      'appAiSettings': 'ai_settings',
      'aiSettings': 'ai_settings'
    };
    
    if (targetTypeMap[collectionName]) {
      return targetTypeMap[collectionName];
    }
    
    // Default: remove 's' from end
    return collectionName.replace(/s$/, '');
  }

  private getEventTypeFromCollection(collectionPath: string, operation: string): string {
    const parts = collectionPath.split('/');
    let collectionName: string;
    
    if (parts.length === 1) {
      collectionName = parts[0];
    } else if (parts.length === 3) {
      collectionName = parts[2]; // Subcollection
    } else {
      return 'unknown.created';
    }
    
    // Special mappings for event types that don't follow simple patterns
    const eventTypeMap: { [key: string]: string } = {
      'agencyContacts': 'agency_contact',
      'contacts': 'agency_contact',
      'appAiSettings': 'ai_settings',
      'aiSettings': 'ai_settings'
    };
    
    // Use the event type mapping if available, otherwise use target type
    const baseType = eventTypeMap[collectionName] || this.getTargetTypeFromCollection(collectionPath);
    console.log(`      DEBUG: collectionName="${collectionName}", eventTypeMap[collectionName]="${eventTypeMap[collectionName]}", baseType="${baseType}"`);
    return `${baseType}.${operation}d`;
  }



  private validateLogStructure(logData: any, operation: string, collectionPath: string): boolean {
    const requiredFields = [
      'timestamp',
      'actionType',
      'sourceModule',
      'success',
      'eventType',
      'targetType',
      'targetId',
      'aiRelevant',
      'contextType',
      'urgencyScore',
      'reason',
      'versionTag'
    ];

    // Check required fields
    for (const field of requiredFields) {
      if (!(field in logData)) {
        console.log(`      Missing required field: ${field}`);
        return false;
      }
    }

    // Check specific validations
    if (logData.sourceModule !== 'FirestoreTrigger') {
      console.log(`      Invalid sourceModule: ${logData.sourceModule}`);
      return false;
    }

    if (typeof logData.success !== 'boolean') {
      console.log(`      Invalid success field: ${logData.success}`);
      return false;
    }

    if (typeof logData.aiRelevant !== 'boolean') {
      console.log(`      Invalid aiRelevant field: ${logData.aiRelevant}`);
      return false;
    }

    if (typeof logData.urgencyScore !== 'number' || logData.urgencyScore < 1 || logData.urgencyScore > 10) {
      console.log(`      Invalid urgencyScore: ${logData.urgencyScore}`);
      return false;
    }

    return true;
  }

  private printSummary(summary: TestSummary) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 FIRESTORE TRIGGER TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${summary.totalTests}`);
    console.log(`Passed: ${summary.passedTests} ✅`);
    console.log(`Failed: ${summary.failedTests} ❌`);
    console.log(`Success Rate: ${((summary.passedTests / summary.totalTests) * 100).toFixed(1)}%`);
    console.log(`Duration: ${summary.duration}ms`);
    console.log(`Start Time: ${summary.startTime}`);
    console.log(`End Time: ${summary.endTime}`);

    if (summary.failedTests > 0) {
      console.log('\n❌ FAILED TESTS:');
      summary.results.filter(r => !r.success).forEach(result => {
        console.log(`  - ${result.triggerName}: ${result.error}`);
      });
    }

    console.log('\n' + '='.repeat(60));
  }
}

// Export the tester class and a convenience function
export { FirestoreTriggerTester };

export async function runFirestoreTriggerTests(): Promise<TestSummary> {
  const tester = new FirestoreTriggerTester();
  return await tester.runAllTests();
}

/**
 * 🔍 COVERAGE DETECTION FUNCTION
 * 
 * This function helps identify missing test coverage by comparing
 * the triggers defined in index.ts with the tests in this file.
 * 
 * Run this before adding new triggers to see what's missing!
 */
export async function checkTestCoverage(): Promise<{
  missingTests: string[];
  extraTests: string[];
  recommendations: string[];
}> {
  console.log('🔍 Checking test coverage...');
  
  // Define all collections that should have triggers (from index.ts)
  const expectedCollections = [
    'users',
    'agencies', 
    'customers',
    'assignments',
    'conversations',
    'jobOrders',
    'campaigns',
    'motivations',
    'userGroups',
    'locations',
    'notifications',
    'settings',
    'ai_logs',
    'appAiSettings',
    'departments'
  ];

  // Define all subcollections that should have triggers
  const expectedSubcollections = [
    'messages',
    'shifts', 
    'agencyContacts',
    'aiSettings', // for both customers and agencies
    'departments' // for customers
  ];

  // Define all test methods currently implemented
  const implementedTests = [
    'testUserTriggers',
    'testAgencyTriggers',
    'testCustomerTriggers', 
    'testAssignmentTriggers',
    'testConversationTriggers',
    'testJobOrderTriggers',
    'testCampaignTriggers',
    'testMotivationTriggers',
    'testMessageTriggers',
    'testShiftTriggers',
    'testUserGroupTriggers',
    'testLocationTriggers',
    'testNotificationTriggers',
    'testSettingTriggers',
    'testAILogTriggers',
    'testAgencyContactTriggers',
    'testGlobalAISettingsTriggers',
    'testCustomerAISettingsTriggers',
    'testAgencyAISettingsTriggers',
    'testDepartmentTriggers',
    'testCustomerDepartmentTriggers'
  ];

  // Check for missing tests
  const missingTests: string[] = [];
  const extraTests: string[] = [];

  // Check main collections
  for (const collection of expectedCollections) {
    const testMethod = `test${collection.charAt(0).toUpperCase() + collection.slice(1).replace(/s$/, '')}Triggers`;
    if (!implementedTests.includes(testMethod)) {
      missingTests.push(`${collection} collection (${testMethod})`);
    }
  }

  // Check subcollections
  for (const subcollection of expectedSubcollections) {
    const testMethod = `test${subcollection.charAt(0).toUpperCase() + subcollection.slice(1).replace(/s$/, '')}Triggers`;
    if (!implementedTests.includes(testMethod)) {
      missingTests.push(`${subcollection} subcollection (${testMethod})`);
    }
  }

  // Check for extra tests (tests that don't correspond to expected collections)
  for (const test of implementedTests) {
    const collectionName = test.replace('test', '').replace('Triggers', '').toLowerCase();
    if (!expectedCollections.includes(collectionName) && 
        !expectedSubcollections.includes(collectionName)) {
      extraTests.push(test);
    }
  }

  const recommendations: string[] = [];

  if (missingTests.length > 0) {
    recommendations.push('Add missing test methods for: ' + missingTests.join(', '));
  }

  if (extraTests.length > 0) {
    recommendations.push('Review extra test methods: ' + extraTests.join(', '));
  }

  if (missingTests.length === 0 && extraTests.length === 0) {
    recommendations.push('✅ All expected collections have test coverage!');
  }

  const coverage = {
    missingTests,
    extraTests,
    recommendations
  };

  console.log('📊 Coverage Report:');
  console.log('Missing Tests:', missingTests.length);
  console.log('Extra Tests:', extraTests.length);
  console.log('Recommendations:', recommendations);

  return coverage;
}

// If running directly
if (require.main === module) {
  runFirestoreTriggerTests()
    .then(summary => {
      console.log('Test run completed!');
      process.exit(summary.failedTests > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('Test run failed:', error);
      process.exit(1);
    });
} 