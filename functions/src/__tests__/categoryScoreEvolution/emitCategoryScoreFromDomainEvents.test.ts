import { expect } from 'chai';
import {
  backgroundCheckJustCompleted,
  isBackgroundCheckRecordCompleted,
  rawAssignmentCompleted,
  rawAssignmentNoShow,
  assignmentJustCompleted,
  assignmentJustMarkedNoShow,
} from '../../categoryScoreEvolution/emitCategoryScoreFromDomainEvents';

describe('emitCategoryScoreFromDomainEvents', () => {
  it('detects background check completion transition', () => {
    expect(isBackgroundCheckRecordCompleted(null)).to.equal(false);
    expect(isBackgroundCheckRecordCompleted({ hrxStatus: 'in_progress' })).to.equal(false);
    expect(isBackgroundCheckRecordCompleted({ hrxStatus: 'completed' })).to.equal(true);
    expect(isBackgroundCheckRecordCompleted({ finalReportReady: true })).to.equal(true);
    expect(backgroundCheckJustCompleted(null, { hrxStatus: 'completed' })).to.equal(true);
    expect(backgroundCheckJustCompleted({ hrxStatus: 'completed' }, { hrxStatus: 'completed' })).to.equal(false);
  });

  it('parses assignment completed and no-show raw statuses', () => {
    expect(rawAssignmentCompleted('completed')).to.equal(true);
    expect(rawAssignmentCompleted('ended')).to.equal(true);
    expect(rawAssignmentCompleted('confirmed')).to.equal(false);
    expect(rawAssignmentNoShow('no-show')).to.equal(true);
    expect(rawAssignmentNoShow('no_show')).to.equal(true);
    expect(rawAssignmentNoShow('confirmed')).to.equal(false);
  });

  it('detects assignment transitions', () => {
    expect(assignmentJustCompleted(null, { status: 'completed' })).to.equal(true);
    expect(assignmentJustCompleted({ status: 'completed' }, { status: 'completed' })).to.equal(false);
    expect(assignmentJustMarkedNoShow(null, { status: 'no-show' })).to.equal(true);
    expect(assignmentJustMarkedNoShow({ status: 'no-show' }, { status: 'no-show' })).to.equal(false);
  });
});
