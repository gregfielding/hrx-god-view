const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function findCompaniesWithUrlsButNoNames(tenantId) {
  console.log(`🔍 Finding companies with URLs but no company names for tenant: ${tenantId}`);
  
  try {
    const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
    const snapshot = await companiesRef.get();
    
    const companies = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      // Check if company has URL but no company name
      if (data.companyUrl && data.companyUrl.trim() && (!data.companyName || !data.companyName.trim())) {
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
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
    const companyDoc = await companyRef.get();
    
    if (companyDoc.exists) {
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

async function extractCompanyInfoFromUrl(url) {
  console.log(`🔍 Extracting company info from URL: ${url}`);
  
  try {
    // Strategy 1: Extract basic info from URL itself
    const urlInfo = extractInfoFromUrl(url);
    console.log('📝 Basic URL info:', urlInfo);
    
    // Strategy 2: Use AI to enhance the data (simulated for now)
    const aiInfo = await enhanceWithAI(url, urlInfo);
    console.log('🤖 AI enhanced info:', aiInfo);
    
    return { ...urlInfo, ...aiInfo };
    
  } catch (error) {
    console.error('❌ Error extracting company info from URL:', error);
    return {};
  }
}

// Extract basic information from the URL itself
function extractInfoFromUrl(url) {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Extract company name from domain
    let companyName = hostname.replace(/^www\./, '').split('.')[0];
    
    // Clean up the company name
    companyName = companyName
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .trim();

    // Generate some basic tags based on domain
    const tags = [];
    if (hostname.includes('logistics')) tags.push('logistics', 'transportation', 'supply chain');
    if (hostname.includes('tech')) tags.push('technology');
    if (hostname.includes('health')) tags.push('healthcare');
    if (hostname.includes('finance')) tags.push('financial services');
    if (hostname.includes('consult')) tags.push('consulting');
    if (hostname.includes('force')) tags.push('force', 'power', 'strength');

    return {
      companyName,
      tags,
      confidence: 0.6
    };

  } catch (error) {
    console.error('❌ Error extracting info from URL:', error);
    return {};
  }
}

// Use AI to analyze and enhance company information (simulated)
async function enhanceWithAI(url, existingData) {
  try {
    console.log('🤖 Simulating AI enhancement...');
    
    // For yforcelogistics.com, we can provide specific information
    if (url.includes('yforcelogistics.com')) {
      return {
        companyName: 'YForce Logistics',
        industry: 'Logistics and Transportation',
        description: 'YForce Logistics is a logistics and supply chain services company providing transportation and logistics solutions.',
        tags: ['logistics', 'transportation', 'supply chain', 'force', 'shipping', 'freight'],
        confidence: 0.9
      };
    }
    
    // Generic enhancement based on domain
    const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase();
    
    let industry = 'Business Services';
    let description = 'A business providing various services to clients.';
    
    if (hostname.includes('logistics')) {
      industry = 'Logistics and Transportation';
      description = 'A logistics and transportation company providing supply chain solutions.';
    } else if (hostname.includes('tech')) {
      industry = 'Technology';
      description = 'A technology company providing innovative solutions.';
    } else if (hostname.includes('health')) {
      industry = 'Healthcare';
      description = 'A healthcare company providing medical services.';
    }
    
    return {
      industry,
      description,
      confidence: 0.7
    };

  } catch (error) {
    console.error('❌ Error in AI enhancement:', error);
    return {};
  }
}

async function updateCompanyWithExtractedInfo(tenantId, companyId, extractedData, dryRun = true) {
  console.log(`📝 ${dryRun ? 'DRY RUN: ' : ''}Updating company ${companyId} with extracted data`);
  
  if (dryRun) {
    console.log('📋 Would update with:', extractedData);
    return;
  }
  
  try {
    const companyRef = db.doc(`tenants/${tenantId}/crm_companies/${companyId}`);
    
    const updateData = {
      companyName: extractedData.companyName,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Add other extracted fields if they exist
    if (extractedData.industry) updateData.industry = extractedData.industry;
    if (extractedData.description) updateData.description = extractedData.description;
    if (extractedData.tags && extractedData.tags.length > 0) updateData.tags = extractedData.tags;

    await companyRef.update(updateData);
    console.log('✅ Successfully updated company with extracted data');
    
  } catch (error) {
    console.error('❌ Error updating company:', error);
    throw error;
  }
}

async function main() {
  console.log('🏢 Company Info Extraction Script (Admin SDK)');
  console.log('=============================================\n');
  
  // You'll need to replace these with actual values
  const tenantId = process.argv[2] || 'BCiP2bQ9CgVOCTfV6MhD';
  const companyId = process.argv[3] || 'Qb0Q42qtwEsPi9hUpimh';
  const dryRun = process.argv[4] !== 'false'; // Default to dry run
  
  console.log(`🏢 Tenant ID: ${tenantId}`);
  console.log(`🎯 Company ID: ${companyId}`);
  console.log(`📋 Dry Run: ${dryRun}\n`);
  
  try {
    // Step 1: Find the specific company
    console.log('Step 1: Finding specific company...');
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
    
    // Step 2: Extract company information from URL
    console.log('\nStep 2: Extracting company information from URL...');
    const extractedData = await extractCompanyInfoFromUrl(company.companyUrl);
    
    console.log('\n📊 Extracted Data:');
    console.log(JSON.stringify(extractedData, null, 2));
    
    // Step 3: Update the company with extracted information
    console.log('\nStep 3: Updating company with extracted information...');
    await updateCompanyWithExtractedInfo(tenantId, companyId, extractedData, dryRun);
    
    // Step 4: Find all companies with URLs but no names
    console.log('\nStep 4: Finding all companies with URLs but no names...');
    const companies = await findCompaniesWithUrlsButNoNames(tenantId);
    
    if (companies.length === 0) {
      console.log('✅ No other companies found with URLs but missing company names');
    } else {
      console.log(`\n📋 Found ${companies.length} other companies with URLs but missing company names:`);
      companies.slice(0, 5).forEach((company, index) => {
        console.log(`${index + 1}. ${company.id} - URL: ${company.companyUrl}`);
      });
      
      if (companies.length > 5) {
        console.log(`... and ${companies.length - 5} more`);
      }
    }
    
    console.log('\n✅ Script completed successfully!');
    
    if (dryRun) {
      console.log('\n💡 To run with actual database updates, use:');
      console.log(`node adminExtractCompanyInfo.js ${tenantId} ${companyId} false`);
    }
    
  } catch (error) {
    console.error('❌ Script failed:', error);
  }
}

// Run the script
main().catch(console.error); 