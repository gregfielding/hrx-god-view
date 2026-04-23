import { buildWorkHistoryJobTitles } from '../workHistoryJobTitles';

describe('buildWorkHistoryJobTitles', () => {
  it('returns up to 10 titles, most recent by end date first', () => {
    const user = {
      workExperience: [
        { jobTitle: '  Old job ', employer: 'A', startDate: '2010-01-01', endDate: '2012-01-01' },
        { jobTitle: 'Newer job', employer: 'B', startDate: '2015-01-01', endDate: '2018-01-01' },
        { jobTitle: 'Current', employer: 'C', endDate: 'Present' },
      ],
    };
    expect(buildWorkHistoryJobTitles(user)).toEqual(['Current', 'Newer job', 'Old job']);
  });

  it('drops duplicate titles (case-insensitive), keeping most recent first', () => {
    const user = {
      workExperience: [
        { jobTitle: 'Warehouse Associate', endDate: '2020-01-01' },
        { jobTitle: 'General Laborer', endDate: '2021-01-01' },
        { jobTitle: 'Warehouse Associate', endDate: '2022-01-01' },
        { jobTitle: 'delivery driver', endDate: 'Present' },
        { jobTitle: 'Delivery Driver', endDate: '2019-01-01' },
      ],
    };
    expect(buildWorkHistoryJobTitles(user)).toEqual(['delivery driver', 'Warehouse Associate', 'General Laborer']);
  });

  it('reads workHistory and nested workerProfile.experience.workExperience', () => {
    expect(
      buildWorkHistoryJobTitles({
        workHistory: [{ jobTitle: 'X' }],
      }),
    ).toEqual(['X']);
    expect(
      buildWorkHistoryJobTitles({
        workerProfile: { experience: { workExperience: [{ title: 'Y' }] } },
      }),
    ).toEqual(['Y']);
  });
});
