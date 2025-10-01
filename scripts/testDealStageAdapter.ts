import { getValue, setValue, getPrimaryCompanyId, getPrimaryLocation } from '../src/forms/dealStageAdapter';

function sampleDeal() {
  return {
    id: 'deal1',
    companyId: 'acct1',
    associations: {
      companies: [{ id: 'acct1' }],
      locations: [{ id: 'loc1', snapshot: { name: 'HQ' } }]
    },
    stageData: {
      discovery: { jobTitles: ['Assembler'] },
      qualification: {
        experienceLevel: 'entry',
        expectedStartDate: '2025-10-01',
        expectedAveragePayRate: 18
      }
    }
  } as any;
}

(function main() {
  const deal = sampleDeal();
  console.log('jobTitle:', getValue('jobTitle', deal));
  console.log('experienceLevel:', getValue('experienceLevel', deal));
  console.log('startDate:', getValue('startDate', deal));
  console.log('payRate:', getValue('payRate', deal));
  console.log('primaryCompanyId:', getPrimaryCompanyId(deal));
  console.log('primaryLocation:', getPrimaryLocation(deal));

  const draft = JSON.parse(JSON.stringify(deal));
  setValue('experienceLevel', 'advanced', draft);
  if (getValue('experienceLevel', draft) !== 'advanced') throw new Error('setValue failed');
  console.log('✅ Adapter test passed');
})();


