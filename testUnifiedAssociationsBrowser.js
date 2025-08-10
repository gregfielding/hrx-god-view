// Browser-based test for Unified Association Service
// Run this in the browser console on the Deal Details page

async function testUnifiedAssociations() {
  const tenantId = 'BCiP2bQ9CgVOCTfV6MhD';
  const dealId = '1xEcA2JdEdr20kjBSnKa';
  
  console.log('🔍 Testing Unified Association Service');
  console.log('Tenant ID:', tenantId);
  console.log('Deal ID:', dealId);
  
  try {
    // Import the unified association service
    const { createUnifiedAssociationService } = await import('./src/utils/unifiedAssociationService.ts');
    
    // Get the current user ID (assuming we're on a page with auth context)
    const userId = 'TWXMM1mOJHepmk80Qsx128w9AiS2'; // Current user ID
    
    console.log('📊 Creating unified association service...');
    const associationService = createUnifiedAssociationService(tenantId, userId);
    
    console.log('📊 Getting entity associations...');
    const result = await associationService.getEntityAssociations('deal', dealId);
    
    console.log('✅ Unified association result:', result);
    console.log('📊 Summary:', result.summary);
    console.log('📊 Companies:', result.entities.companies);
    console.log('📊 Contacts:', result.entities.contacts);
    console.log('📊 Salespeople:', result.entities.salespeople);
    console.log('📊 Deals:', result.entities.deals);
    
    // Test specific associations
    console.log('\n🔍 Testing specific associations:');
    
    // Check if Jim Parker is in contacts
    const jimParker = result.entities.contacts.find(c => 
      c.id === '91dVd6VmsG9FeictRMr3' || 
      c.firstName === 'Jim' || 
      c.lastName === 'Parker' ||
      c.fullName?.includes('Jim') ||
      c.fullName?.includes('Parker')
    );
    console.log('📊 Jim Parker found:', jimParker);
    
    // Check if Greg Fielding is in salespeople
    const gregFielding = result.entities.salespeople.find(s => 
      s.id === 'zazCFZdVZMTX3AJZsVmrYzHmb6Q2' || 
      s.firstName === 'Greg' || 
      s.lastName === 'Fielding' ||
      s.displayName?.includes('Greg') ||
      s.displayName?.includes('Fielding')
    );
    console.log('📊 Greg Fielding found:', gregFielding);
    
    // Check if Donna Persson is in salespeople
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
    throw error;
  }
}

// Export for use in browser console
window.testUnifiedAssociations = testUnifiedAssociations;

// Auto-run if called directly
if (typeof window !== 'undefined') {
  console.log('🔍 Unified Association Test ready. Run: testUnifiedAssociations()');
} 