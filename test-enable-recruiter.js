const { enableRecruiterModule } = require('./enableRecruiterModule');

// Replace with your actual tenant ID
const tenantId = 'TgDJ4sIaC7x2n5cPs3rW'; // This appears to be the HRX tenant ID

console.log('Enabling recruiter module...');
enableRecruiterModule(tenantId)
  .then(() => {
    console.log('✅ Recruiter module enabled!');
    console.log('Now go to http://localhost:3000/modules to see it enabled');
    console.log('Then navigate to http://localhost:3000/recruiter to see the dashboard');
  })
  .catch((error) => {
    console.error('❌ Error:', error);
  });
