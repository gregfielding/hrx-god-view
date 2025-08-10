// Copy and paste this into the browser console on the Deal Details page
// This will test the unified association service

async function testUnifiedAssociationsInBrowser() {
  console.log('🔍 Testing Unified Association Service in Browser');
  
  try {
    // Get the current deal ID from the URL
    const urlParams = new URLSearchParams(window.location.search);
    const dealId = window.location.pathname.split('/').pop();
    console.log('📊 Deal ID from URL:', dealId);
    
    // Get tenant ID and user ID from the page context
    // You might need to adjust these based on your app's structure
    const tenantId = 'BCiP2bQ9CgVOCTfV6MhD'; // Hardcoded for testing
    const userId = 'TWXMM1mOJHepmk80Qsx128w9AiS2'; // Hardcoded for testing
    
    console.log('📊 Tenant ID:', tenantId);
    console.log('📊 User ID:', userId);
    
    // Test the unified association service
    console.log('📊 Testing unified association service...');
    
    // Import and test the service
    const { createUnifiedAssociationService } = await import('./src/utils/unifiedAssociationService.ts');
    const associationService = createUnifiedAssociationService(tenantId, userId);
    
    console.log('📊 Getting entity associations...');
    const result = await associationService.getEntityAssociations('deal', dealId);
    
    console.log('✅ Unified association result:', result);
    console.log('📊 Summary:', result.summary);
    console.log('📊 Companies:', result.entities.companies);
    console.log('📊 Contacts:', result.entities.contacts);
    console.log('📊 Salespeople:', result.entities.salespeople);
    
    // Test specific data we expect
    console.log('\n🔍 Testing expected data:');
    
    // Check for Jim Parker (contact ID: 91dVd6VmsG9FeictRMr3)
    const jimParker = result.entities.contacts.find(c => 
      c.id === '91dVd6VmsG9FeictRMr3' || 
      c.firstName === 'Jim' || 
      c.lastName === 'Parker' ||
      c.fullName?.includes('Jim') ||
      c.fullName?.includes('Parker')
    );
    console.log('📊 Jim Parker found:', jimParker);
    
    // Check for Greg Fielding (salesperson ID: zazCFZdVZMTX3AJZsVmrYzHmb6Q2)
    const gregFielding = result.entities.salespeople.find(s => 
      s.id === 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2' || 
      s.firstName === 'Greg' || 
      s.lastName === 'Fielding' ||
      s.displayName?.includes('Greg') ||
      s.displayName?.includes('Fielding')
    );
    console.log('📊 Greg Fielding found:', gregFielding);
    
    // Check for Donna Persson
    const donnaPersson = result.entities.salespeople.find(s => 
      s.firstName === 'Donna' || 
      s.lastName === 'Persson' ||
      s.displayName?.includes('Donna') ||
      s.displayName?.includes('Persson')
    );
    console.log('📊 Donna Persson found:', donnaPersson);
    
    console.log('\n✅ Test completed successfully!');
    
    return result;
    
  } catch (error) {
    console.error('❌ Error during test:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    throw error;
  }
}

// Run the test
console.log('🔍 Starting Unified Association Test...');
testUnifiedAssociationsInBrowser().then(result => {
  console.log('✅ Test completed with result:', result);
}).catch(error => {
  console.error('❌ Test failed:', error);
});

// Also make it available globally
window.testUnifiedAssociationsInBrowser = testUnifiedAssociationsInBrowser; 