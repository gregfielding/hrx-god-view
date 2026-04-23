import type { ReadinessSnapshotV1Requirement } from '../../shared/readinessSnapshotV1';
import {
  selectPlacementNonCertBlockerLabelsFromSnapshot,
  selectPlacementBlockerLabelsWithOptionalEngine,
} from '../placementQualificationChipsModel';

describe('placementQualificationChipsModel Phase 3 engine merge helpers', () => {
  const reqs: ReadinessSnapshotV1Requirement[] = [
    {
      key: 'background_check',
      label: 'Background check',
      category: 'screening',
      status: 'missing',
      severity: 'hard_block',
    },
    {
      key: 'cert_abc123',
      label: 'Forklift',
      category: 'certification',
      status: 'missing',
      severity: 'warning',
    },
  ];

  it('non-cert filter excludes cert_ keys', () => {
    const labels = selectPlacementNonCertBlockerLabelsFromSnapshot(reqs);
    expect(labels.some((l) => l.includes('Forklift'))).toBe(false);
    expect(labels.some((l) => l.includes('Background'))).toBe(true);
  });

  it('withOptionalEngine falls back to legacy when engine flag off', () => {
    const prev = process.env.REACT_APP_CERT_ENGINE_READINESS;
    process.env.REACT_APP_CERT_ENGINE_READINESS = 'false';
    const merged = selectPlacementBlockerLabelsWithOptionalEngine(reqs, { requiredCertificationKeySuffixes: new Set(['abc123']) }, ['Engine only']);
    expect(merged.join('|')).toContain('Background');
    process.env.REACT_APP_CERT_ENGINE_READINESS = prev;
  });
});
