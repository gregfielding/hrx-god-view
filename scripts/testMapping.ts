import { mapDealToJobOrder } from '../src/mappings/dealToJobOrder';

function sampleDeal() {
  return {
    id: 'deal123',
    name: 'Sample Deal',
    companyId: 'acct1',
    companyName: 'Acme Co',
    priority: 'high',
    shiftType: 'night',
    associations: {
      locations: [{ id: 'loc1', snapshot: { name: 'HQ' } }],
    },
    stageData: {
      discovery: { jobTitles: ['Assembler'] },
      qualification: {
        expectedStartDate: '2025-10-01',
        expectedAveragePayRate: 18,
        staffPlacementTimeline: { starting: 5 },
        experienceLevel: 'entry'
      },
    },
    estimatedRevenue: 0,
    notes: '',
  } as any;
}

(function main() {
  const deal = sampleDeal();
  const mapped = mapDealToJobOrder(deal);
  console.log('Flat:', mapped.flat);
  console.log('Snapshot:', mapped.initialSnapshot);
  if (!mapped.flat.jobTitle) throw new Error('jobTitle missing');
  if (!('startDate' in mapped.flat)) throw new Error('startDate missing');
  if (mapped.flat.priority !== 'high') throw new Error('priority mapping failed');
  if (mapped.flat.shiftType !== 'night') throw new Error('shiftType mapping failed');

  // Bad value coercion
  const bad = sampleDeal();
  (bad as any).priority = 'URGENT';
  (bad as any).shiftType = 'overnight';
  const mappedBad = mapDealToJobOrder(bad);
  if (mappedBad.flat.priority !== 'low') throw new Error('priority coercion failed');
  if (mappedBad.flat.shiftType !== 'day') throw new Error('shiftType coercion failed');
  console.log('✅ Mapping test passed');
})();


