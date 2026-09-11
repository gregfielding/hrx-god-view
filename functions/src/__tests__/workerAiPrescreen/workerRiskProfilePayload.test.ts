import * as admin from 'firebase-admin';
import { riskProfileFirestorePayload } from '../../workerAiPrescreen/workerRiskProfile';

// 2026-09-11: a serverTimestamp() sentinel inside topRisks[] made Firestore reject the whole user
// update in recomputeUserInterviewScoreSummary, so interview scores never reached the tier scorecard.
describe('riskProfileFirestorePayload', () => {
  const draft = {
    overallRiskScore: 40,
    topRisks: [
      { type: 'reliability', severity: 'moderate', confidence: 0.6, summary: 'Disclosed concern', source: 'prescreen' },
      { type: 'transport', severity: 'low', confidence: 0.5, summary: 'Bus commute', source: 'prescreen', sourceRef: 'q1' },
    ],
    lastGeneratedBy: 'interview_submit',
    version: 1,
    generationSignature: 'sig',
    staleness: null,
  };

  it('never puts a FieldValue sentinel inside the topRisks array', () => {
    const out = riskProfileFirestorePayload(draft as never);
    const rows = out.topRisks as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.lastUpdatedAt instanceof admin.firestore.FieldValue).toBe(false);
      expect(row.lastUpdatedAt instanceof admin.firestore.Timestamp).toBe(true);
    }
  });

  it('passes Firestore write validation', () => {
    const db = admin.firestore();
    const payload = { riskProfile: riskProfileFirestorePayload(draft as never) };
    expect(() => db.batch().update(db.doc('users/test-user'), payload)).not.toThrow();
  });
});
