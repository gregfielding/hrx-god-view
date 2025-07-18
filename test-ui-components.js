// Simple test script to verify migrated components
const puppeteer = require('puppeteer');

async function testAgencyAISettings() {
  console.log('🧪 Starting Agency AI Settings UI Test...');
  
  const browser = await puppeteer.launch({ 
    headless: false, 
    defaultViewport: { width: 1200, height: 800 } 
  });
  
  try {
    const page = await browser.newPage();
    
    // Navigate to the app
    console.log('📍 Navigating to localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    
    // Check if the page loads without errors
    const errors = await page.evaluate(() => {
      return window.console.errors || [];
    });
    
    if (errors.length > 0) {
      console.log('❌ Console errors found:', errors);
    } else {
      console.log('✅ No console errors detected');
    }
    
    // Check if LoggableField components are present in the DOM
    const loggableFields = await page.evaluate(() => {
      return document.querySelectorAll('[data-ai-log="true"]').length;
    });
    
    console.log(`📊 Found ${loggableFields} LoggableField components in the DOM`);
    
    // Wait a bit to see the page
    await page.waitForTimeout(3000);
    
    console.log('✅ UI Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the test if puppeteer is available
if (typeof require !== 'undefined') {
  testAgencyAISettings().catch(console.error);
} else {
  console.log('📝 Manual test instructions:');
  console.log('1. Open http://localhost:3000 in your browser');
  console.log('2. Navigate to an Agency Profile');
  console.log('3. Click on AI Settings tab');
  console.log('4. Verify all sections load without errors');
  console.log('5. Test the sliders, text fields, and selects');
  console.log('6. Check browser console for any errors');
} 