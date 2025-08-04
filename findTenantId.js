// Simple script to help identify tenant ID
// Run this in your browser console when logged into the CRM

console.log('🔍 Tenant ID Finder');
console.log('==================');

// Method 1: Check if tenantId is available in the current page
if (typeof window !== 'undefined') {
  // Check for tenant ID in localStorage
  const storedTenantId = localStorage.getItem('tenantId') || localStorage.getItem('activeTenantId');
  if (storedTenantId) {
    console.log('✅ Found tenant ID in localStorage:', storedTenantId);
  }
  
  // Check for tenant ID in sessionStorage
  const sessionTenantId = sessionStorage.getItem('tenantId') || sessionStorage.getItem('activeTenantId');
  if (sessionTenantId) {
    console.log('✅ Found tenant ID in sessionStorage:', sessionTenantId);
  }
  
  // Check for tenant ID in URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const urlTenantId = urlParams.get('tenantId');
  if (urlTenantId) {
    console.log('✅ Found tenant ID in URL:', urlTenantId);
  }
}

console.log('\n📋 Instructions:');
console.log('1. Open your CRM application in the browser');
console.log('2. Open Developer Tools (F12)');
console.log('3. Go to the Console tab');
console.log('4. Look for any tenant ID information in the logs');
console.log('5. Or check the Network tab for API calls that might contain tenant IDs');
console.log('6. You can also check the Application tab > Local Storage for tenant information');

console.log('\n🔧 Alternative:');
console.log('If you know your tenant ID, you can run:');
console.log('node setupInitialKPIs.js <your-tenant-id>');

console.log('\n📝 Common tenant ID patterns:');
console.log('- Usually a Firebase document ID (24 character string)');
console.log('- Might be stored in your user profile or tenant settings');
console.log('- Could be visible in the URL when accessing tenant-specific features'); 