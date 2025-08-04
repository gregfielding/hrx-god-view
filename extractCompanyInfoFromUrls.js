const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');
const { getFirestore, collection, query, where, getDocs, doc, getDoc } = require('firebase/firestore');

// Firebase configuration
const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);
const db = getFirestore(app);

async function findCompaniesWithUrlsButNoNames(tenantId) {
  console.log(`🔍 Finding companies with URLs but no company names for tenant: ${tenantId}`);
  
  try {
    const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
    const q = query(
      companiesRef,
      where('companyUrl', '!=', '')
    );
    
    const snapshot = await getDocs(q);
    const companies = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      // Check if company has URL but no company name
      if (data.companyUrl && (!data.companyName || !data.companyName.trim())) {
        companies.push({
          id: doc.id,
          ...data
        });
      }
    });
    
    console.log(`📊 Found ${companies.length} companies with URLs but missing company names`);
    return companies;
    
  } catch (error) {
    console.error('❌ Error finding companies:', error);
    throw error;
  }
}

async function findSpecificCompany(companyId, tenantId) {
  console.log(`🎯 Looking for specific company: ${companyId}`);
  
  try {
    const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
    const companyDoc = await getDoc(companyRef);
    
    if (companyDoc.exists()) {
      const data = companyDoc.data();
      console.log('✅ Found company:', {
        id: companyDoc.id,
        companyName: data.companyName || 'MISSING',
        companyUrl: data.companyUrl || 'MISSING',
        hasName: !!(data.companyName && data.companyName.trim()),
        hasUrl: !!(data.companyUrl && data.companyUrl.trim())
      });
      return data;
    } else {
      console.log('❌ Company not found');
      return null;
    }
    
  } catch (error) {
    console.error('❌ Error finding specific company:', error);
    return null;
  }
}

async function extractCompanyInfo(tenantId, dryRun = true, limit = 10) {
  console.log(`🚀 Starting company info extraction...`);
  console.log(`📋 Dry Run: ${dryRun}, Limit: ${limit}`);
  
  try {
    const extractCompanyInfo = httpsCallable(functions, 'extractCompanyInfoFromUrls');
    
    const result = await extractCompanyInfo({
      tenantId: tenantId,
      dryRun: dryRun,
      limit: limit
    });
    
    console.log('✅ Extraction completed successfully!');
    return result.data;
    
  } catch (error) {
    console.error('❌ Error during extraction:', error);
    throw error;
  }
}

async function processSpecificCompany(companyId, tenantId, dryRun = true) {
  console.log(`🎯 Processing specific company: ${companyId}`);
  
  try {
    // First, find the company
    const company = await findSpecificCompany(companyId, tenantId);
    if (!company) {
      console.log('❌ Company not found, cannot process');
      return;
    }
    
    if (!company.companyUrl) {
      console.log('❌ Company has no URL, cannot extract info');
      return;
    }
    
    if (company.companyName && company.companyName.trim()) {
      console.log('ℹ️ Company already has a name, skipping');
      return;
    }
    
    console.log(`🔍 Company URL: ${company.companyUrl}`);
    console.log(`📝 Current company name: ${company.companyName || 'MISSING'}`);
    
    // Run the extraction function
    const result = await extractCompanyInfo(tenantId, dryRun, 1);
    
    console.log('📊 Extraction Results:');
    console.log(JSON.stringify(result, null, 2));
    
    return result;
    
  } catch (error) {
    console.error('❌ Error processing specific company:', error);
  }
}

async function main() {
  console.log('🏢 Company Info Extraction Script');
  console.log('==================================\n');
  
  // You'll need to replace these with actual values
  const tenantId = process.argv[2] || 'your-tenant-id-here';
  const companyId = process.argv[3] || 'Qb0Q42qtwEsPi9hUpimh';
  const dryRun = process.argv[4] !== 'false'; // Default to dry run
  
  if (tenantId === 'your-tenant-id-here') {
    console.log('❌ Please provide a tenant ID as the first argument');
    console.log('Usage: node extractCompanyInfoFromUrls.js <tenantId> [companyId] [dryRun]');
    console.log('Example: node extractCompanyInfoFromUrls.js tenant123 Qb0Q42qtwEsPi9hUpimh true');
    return;
  }
  
  console.log(`🏢 Tenant ID: ${tenantId}`);
  console.log(`🎯 Company ID: ${companyId}`);
  console.log(`📋 Dry Run: ${dryRun}\n`);
  
  try {
    // Step 1: Find all companies with URLs but no names
    console.log('Step 1: Finding companies with URLs but no names...');
    const companies = await findCompaniesWithUrlsButNoNames(tenantId);
    
    if (companies.length === 0) {
      console.log('✅ No companies found with URLs but missing company names');
      return;
    }
    
    console.log('\n📋 Companies found:');
    companies.slice(0, 5).forEach((company, index) => {
      console.log(`${index + 1}. ${company.id} - URL: ${company.companyUrl}`);
    });
    
    if (companies.length > 5) {
      console.log(`... and ${companies.length - 5} more`);
    }
    
    // Step 2: Process specific company if provided
    if (companyId && companyId !== 'Qb0Q42qtwEsPi9hUpimh') {
      console.log('\nStep 2: Processing specific company...');
      await processSpecificCompany(companyId, tenantId, dryRun);
    }
    
    // Step 3: Run bulk extraction
    console.log('\nStep 3: Running bulk extraction...');
    const extractionResult = await extractCompanyInfo(tenantId, dryRun, 10);
    
    console.log('\n📊 Final Results:');
    console.log(`Total Processed: ${extractionResult.summary?.totalProcessed || 0}`);
    console.log(`Successful: ${extractionResult.summary?.successCount || 0}`);
    console.log(`Errors: ${extractionResult.summary?.errorCount || 0}`);
    
    if (extractionResult.summary?.results) {
      console.log('\n📝 Detailed Results:');
      extractionResult.summary.results.forEach((result, index) => {
        console.log(`\n${index + 1}. Company: ${result.companyId}`);
        console.log(`   URL: ${result.companyUrl}`);
        console.log(`   Success: ${result.success}`);
        if (result.success && result.extractedData.companyName) {
          console.log(`   Extracted Name: ${result.extractedData.companyName}`);
          console.log(`   Industry: ${result.extractedData.industry || 'N/A'}`);
          console.log(`   Confidence: ${result.extractedData.confidence || 'N/A'}`);
        } else if (result.error) {
          console.log(`   Error: ${result.error}`);
        }
      });
    }
    
    console.log('\n✅ Script completed successfully!');
    
    if (dryRun) {
      console.log('\n💡 To run with actual database updates, use:');
      console.log(`node extractCompanyInfoFromUrls.js ${tenantId} ${companyId} false`);
    }
    
  } catch (error) {
    console.error('❌ Script failed:', error);
  }
}

// Run the script
main().catch(console.error); 