/**
 * Policy tests for the Accept-shift headshot gate (re-armed 2026-09-06).
 * Pure `evaluateHeadshotGate` — no Firestore, no Vision.
 */
import { expect } from 'chai';
import {
  HEADSHOT_BLOCKING_REJECTION_REASONS,
  evaluateHeadshotGate,
  readWorkerPhotoUrl,
  type UserDocHeadshotFields,
} from '../../avatar/headshotAcceptGate';

const URL_A = 'https://firebasestorage.googleapis.com/v0/b/x/o/avatars%2Fu1.jpg?alt=media&token=a';
const URL_B = 'https://firebasestorage.googleapis.com/v0/b/x/o/avatars%2Fu1.jpg?alt=media&token=b';

function rejected(reason: string, sourceAvatarUrl = URL_A): UserDocHeadshotFields['avatarVerification'] {
  return { status: 'rejected', rejectionReason: reason as any, sourceAvatarUrl, verifiedBy: 'system' } as any;
}

describe('headshotAcceptGate — evaluateHeadshotGate', () => {
  describe('photo presence', () => {
    it('blocks HEADSHOT_MISSING when no photo field is set', () => {
      for (const doc of [null, undefined, {}, { avatar: '' }, { workerProfile: {} }, { avatar: '   ' }]) {
        const d = evaluateHeadshotGate(doc as any);
        expect(d.allow).to.equal(false);
        if (d.allow === false) {
          expect(d.details.code).to.equal('HEADSHOT_MISSING');
          expect(d.details.status).to.equal('missing');
        }
      }
    });

    it('finds the photo under any of the four fields (readWorkerPhotoUrl)', () => {
      expect(readWorkerPhotoUrl({ avatar: URL_A })).to.equal(URL_A);
      expect(readWorkerPhotoUrl({ workerProfile: { photoUrl: URL_A } })).to.equal(URL_A);
      expect(readWorkerPhotoUrl({ photoUrl: URL_A })).to.equal(URL_A);
      expect(readWorkerPhotoUrl({ 'workerProfile.photoUrl': URL_A })).to.equal(URL_A);
      expect(readWorkerPhotoUrl({ avatar: URL_B, workerProfile: { photoUrl: URL_A } })).to.equal(URL_B);
    });

    it('a photo that lives only under workerProfile.photoUrl is not "missing"', () => {
      const d = evaluateHeadshotGate({ workerProfile: { photoUrl: URL_A } });
      expect(d).to.deep.equal({ allow: true, reason: 'unverified' });
    });
  });

  describe('never blocks on our own pipeline', () => {
    it('no verification record → allow (unverified)', () => {
      expect(evaluateHeadshotGate({ avatar: URL_A })).to.deep.equal({ allow: true, reason: 'unverified' });
    });

    it('pending → allow; error → allow; approved → allow', () => {
      for (const [status, reason] of [
        ['pending', 'pending'],
        ['error', 'error'],
        ['approved', 'approved'],
      ] as const) {
        const d = evaluateHeadshotGate({
          avatar: URL_A,
          avatarVerification: { status, sourceAvatarUrl: URL_A } as any,
        });
        expect(d).to.deep.equal({ allow: true, reason });
      }
    });

    it('a rejection recorded against an OLDER photo does not block the current one', () => {
      const d = evaluateHeadshotGate({ avatar: URL_B, avatarVerification: rejected('no_face', URL_A) });
      expect(d).to.deep.equal({ allow: true, reason: 'stale_record' });
    });
  });

  describe('rejections', () => {
    it('blocks on the not-a-headshot reasons', () => {
      expect([...HEADSHOT_BLOCKING_REJECTION_REASONS].sort()).to.deep.equal([
        'inappropriate',
        'manual_override',
        'multiple_faces',
        'no_face',
      ]);
      for (const reason of HEADSHOT_BLOCKING_REJECTION_REASONS) {
        const d = evaluateHeadshotGate({ avatar: URL_A, avatarVerification: rejected(reason) });
        expect(d.allow, reason).to.equal(false);
        if (d.allow === false) {
          expect(d.details).to.deep.equal({ code: 'HEADSHOT_REJECTED', status: 'rejected', rejectionReason: reason });
        }
      }
    });

    it('lets quality rejections through (face_too_small / too_blurry / too_dark)', () => {
      for (const reason of ['face_too_small', 'too_blurry', 'too_dark']) {
        const d = evaluateHeadshotGate({ avatar: URL_A, avatarVerification: rejected(reason) });
        expect(d, reason).to.deep.equal({ allow: true, reason: 'quality_rejection' });
      }
    });

    it('a rejected record with no reason still blocks (conservative)', () => {
      const d = evaluateHeadshotGate({
        avatar: URL_A,
        avatarVerification: { status: 'rejected', sourceAvatarUrl: URL_A } as any,
      });
      expect(d.allow).to.equal(false);
      if (d.allow === false) expect(d.details.rejectionReason).to.equal(null);
    });

    it('a record without sourceAvatarUrl is treated as current (legacy records)', () => {
      const d = evaluateHeadshotGate({
        avatar: URL_A,
        avatarVerification: { status: 'rejected', rejectionReason: 'no_face' } as any,
      });
      expect(d.allow).to.equal(false);
    });
  });
});
