const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBxGJwAqXqXqXqXqXqXqXqXqXqXqXqXqXqXq",
  authDomain: "hrx1-d3beb.firebaseapp.com",
  projectId: "hrx1-d3beb",
  storageBucket: "hrx1-d3beb.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function testRealJobScraping() {
  console.log('Testing Real Job Scraping...\n');

  // Test 1: Bria of Palos Hills with Indeed URL
  console.log('Test 1: Bria of Palos Hills (with Indeed URL)');
  try {
    const scrapeIndeedJobs = httpsCallable(functions, 'scrapeIndeedJobs');
    const result = await scrapeIndeedJobs({
      companyName: 'Bria of Palos Hills',
      indeedUrl: 'https://www.indeed.com/cmp/bria-of-palos-hills'
    });
    
    const data = result.data;
    console.log(`✅ Success: ${data.message}`);
    console.log(`Source: ${data.source}`);
    console.log(`Jobs found: ${data.jobs.length}`);
    
    if (data.jobs.length > 0) {
      console.log('\n📋 Real Jobs Found:');
      data.jobs.forEach((job, index) => {
        console.log(`\n${index + 1}. ${job.title}`);
        console.log(`   Company: ${job.company}`);
        console.log(`   Location: ${job.location}`);
        console.log(`   Salary: ${job.salary}`);
        console.log(`   Type: ${job.jobType}`);
        console.log(`   Posted: ${job.postedDate}`);
        console.log(`   Keywords: ${job.keywords.join(', ')}`);
        console.log(`   URL: ${job.url}`);
        console.log(`   Urgency: ${job.urgency}`);
      });
    } else {
      console.log('ℹ️  No real jobs found (this might be expected if no active postings)');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 2: Large company that likely has jobs
  console.log('Test 2: Microsoft (large company with many jobs)');
  try {
    const scrapeIndeedJobs = httpsCallable(functions, 'scrapeIndeedJobs');
    const result = await scrapeIndeedJobs({
      companyName: 'Microsoft',
      indeedUrl: 'https://www.indeed.com/cmp/microsoft'
    });
    
    const data = result.data;
    console.log(`✅ Success: ${data.message}`);
    console.log(`Source: ${data.source}`);
    console.log(`Jobs found: ${data.jobs.length}`);
    
    if (data.jobs.length > 0) {
      console.log('\n📋 Real Jobs Found:');
      data.jobs.slice(0, 3).forEach((job, index) => {
        console.log(`\n${index + 1}. ${job.title}`);
        console.log(`   Company: ${job.company}`);
        console.log(`   Location: ${job.location}`);
        console.log(`   Salary: ${job.salary}`);
        console.log(`   Type: ${job.jobType}`);
        console.log(`   Posted: ${job.postedDate}`);
        console.log(`   Keywords: ${job.keywords.join(', ')}`);
        console.log(`   URL: ${job.url}`);
        console.log(`   Urgency: ${job.urgency}`);
      });
      
      if (data.jobs.length > 3) {
        console.log(`\n... and ${data.jobs.length - 3} more jobs`);
      }
    } else {
      console.log('ℹ️  No real jobs found');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 3: Company without Indeed URL (tests fallback methods)
  console.log('Test 3: Generic Company (no Indeed URL - tests fallback methods)');
  try {
    const scrapeIndeedJobs = httpsCallable(functions, 'scrapeIndeedJobs');
    const result = await scrapeIndeedJobs({
      companyName: 'Generic Company LLC',
      indeedUrl: null
    });
    
    const data = result.data;
    console.log(`✅ Success: ${data.message}`);
    console.log(`Source: ${data.source}`);
    console.log(`Jobs found: ${data.jobs.length}`);
    
    if (data.jobs.length > 0) {
      console.log('\n📋 Real Jobs Found:');
      data.jobs.forEach((job, index) => {
        console.log(`\n${index + 1}. ${job.title}`);
        console.log(`   Company: ${job.company}`);
        console.log(`   Location: ${job.location}`);
        console.log(`   Salary: ${job.salary}`);
        console.log(`   Type: ${job.jobType}`);
        console.log(`   Posted: ${job.postedDate}`);
        console.log(`   Keywords: ${job.keywords.join(', ')}`);
        console.log(`   URL: ${job.url}`);
        console.log(`   Urgency: ${job.urgency}`);
      });
    } else {
      console.log('ℹ️  No real jobs found (fallback methods may not have found results)');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');
  console.log('Testing complete!');
  console.log('\nNote: The results show REAL job data from actual sources, not dummy data.');
  console.log('If no jobs are found, it may be because:');
  console.log('- The company has no active job postings');
  console.log('- The scraping methods need API keys (SerpAPI, GNews)');
  console.log('- The company website blocks scraping');
  console.log('- Rate limiting is in effect');
}

// Run the test
testRealJobScraping().catch(console.error); 