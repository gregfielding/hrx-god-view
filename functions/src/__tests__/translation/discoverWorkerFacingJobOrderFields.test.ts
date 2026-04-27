import { expect } from 'chai';
import {
  discoverWorkerFacingJobOrderFields,
  discoverJobOrderScalarI18nCandidates,
  staffInstructionPathToSection,
  staffInstructionPathToI18nWriteKey,
  isWorkerFacingStaffInstructionPath,
} from '../../translation/discoverWorkerFacingJobOrderFields';

describe('translation/discoverWorkerFacingJobOrderFields', () => {
  it('returns path for each section with non-empty .text', () => {
    const data = {
      staffInstructions: {
        firstDay: { text: 'Report at 8am', files: [] },
        parking: { text: 'Lot B' },
        checkIn: { text: '' },
        uniform: { text: '  \n  ' },
        other: { files: [] },
      },
    };
    const paths = discoverWorkerFacingJobOrderFields(data);
    expect(paths).to.have.members([
      'staffInstructions.firstDay.text',
      'staffInstructions.parking.text',
    ]);
    expect(paths).to.not.include('staffInstructions.checkIn.text');
    expect(paths).to.not.include('staffInstructions.uniform.text');
  });

  it('skips fields in manualFields', () => {
    const data = {
      staffInstructions: {
        firstDay: { text: 'Report at 8am' },
        parking: { text: 'Lot B' },
      },
    };
    const paths = discoverWorkerFacingJobOrderFields(data, ['staffInstructions.firstDay.text']);
    expect(paths).to.deep.equal(['staffInstructions.parking.text']);
  });

  it('returns empty when no staffInstructions', () => {
    expect(discoverWorkerFacingJobOrderFields({})).to.deep.equal([]);
    expect(discoverWorkerFacingJobOrderFields({ staffInstructions: null })).to.deep.equal([]);
  });

  it('staffInstructionPathToSection extracts section name', () => {
    expect(staffInstructionPathToSection('staffInstructions.firstDay.text')).to.equal('firstDay');
    expect(staffInstructionPathToSection('staffInstructions.parking.text')).to.equal('parking');
    expect(staffInstructionPathToSection('staffInstructions.firstDay')).to.equal(null);
    expect(staffInstructionPathToSection('other.firstDay.text')).to.equal(null);
  });

  it('staffInstructionPathToI18nWriteKey returns write key', () => {
    expect(staffInstructionPathToI18nWriteKey('staffInstructions.firstDay.text', 'es')).to.equal(
      'staffInstructions_i18n.firstDay.es'
    );
    expect(staffInstructionPathToI18nWriteKey('staffInstructions.parking.text', 'es')).to.equal(
      'staffInstructions_i18n.parking.es'
    );
    expect(staffInstructionPathToI18nWriteKey('postTitle_i18n', 'es')).to.equal(null);
  });

  it('isWorkerFacingStaffInstructionPath identifies path-like fields', () => {
    expect(isWorkerFacingStaffInstructionPath('staffInstructions.firstDay.text')).to.equal(true);
    expect(isWorkerFacingStaffInstructionPath('staffInstructions.parking.text')).to.equal(true);
    expect(isWorkerFacingStaffInstructionPath('postTitle_i18n')).to.equal(false);
  });

  describe('discoverJobOrderScalarI18nCandidates', () => {
    it('returns _i18n keys for scalar fields with non-empty legacy or .en', () => {
      const data = {
        jobTitle: 'Janitor',
        jobOrderName: 'Janitor - Parker Plastics',
        companyName: '',
        customUniformRequirements: 'custom uniform',
        jobOrderDescription: '',
      };
      const paths = discoverJobOrderScalarI18nCandidates(data);
      expect(paths).to.include('jobTitle_i18n');
      expect(paths).to.include('jobOrderName_i18n');
      expect(paths).to.include('customUniformRequirements_i18n');
      expect(paths).to.not.include('companyName_i18n');
      expect(paths).to.not.include('jobOrderDescription_i18n');
    });

    it('skips fields in manualFields', () => {
      const data = { jobTitle: 'Janitor', jobOrderName: 'Test' };
      const paths = discoverJobOrderScalarI18nCandidates(data, ['jobTitle_i18n']);
      expect(paths).to.not.include('jobTitle_i18n');
      expect(paths).to.include('jobOrderName_i18n');
    });
  });
});
