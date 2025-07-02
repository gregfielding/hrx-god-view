const fs = require('fs');
const csv = require('csv-parser');

const skillsSet = new Set();
const jobTitlesSet = new Set();

fs.createReadStream('onet_data.csv') // <-- Change to your file name
.pipe(csv({ separator: ',' })) // Use ',' if your file is comma-separated
  .on('data', (row) => {
    if (row['Element Name']) skillsSet.add(row['Element Name']);
    if (row['Title']) jobTitlesSet.add(row['Title']);
  })
  .on('end', () => {
    // Skills JSON
    const skills = Array.from(skillsSet).map(name => ({ name, type: 'O*NET' }));
    fs.writeFileSync('onetSkills.json', JSON.stringify(skills, null, 2));
    // Job Titles JSON
    const jobTitles = Array.from(jobTitlesSet);
    fs.writeFileSync('onetJobTitles.json', JSON.stringify(jobTitles, null, 2));
    console.log('Done! Files created: onetSkills.json, onetJobTitles.json');
  });