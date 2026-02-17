/**
 * Regression: when --collection=job_postings (or --collection job_postings),
 * the script must NOT run job_orders logic (jobOrdersEnBackfill), which can
 * crash with "trim is not a function" on job_posting-shaped data.
 */

import { expect } from 'chai';
import {
  parseArgs,
  getCollectionsToRun,
  shouldRunJobOrdersEnBackfill,
} from '../../scripts/backfillTranslationsArgs';

describe('backfillTranslations collection gate', () => {
  describe('parseArgs', () => {
    it('parses --collection=job_postings', () => {
      const args = parseArgs(['--collection=job_postings', '--dryRun=true']);
      expect(args.collection).to.equal('job_postings');
    });

    it('parses --collection job_postings (space-separated)', () => {
      const args = parseArgs(['--collection', 'job_postings', '--dryRun=true']);
      expect(args.collection).to.equal('job_postings');
    });

    it('parses --collection=job_orders', () => {
      const args = parseArgs(['--collection=job_orders']);
      expect(args.collection).to.equal('job_orders');
    });

    it('defaults collection to all when not provided', () => {
      const args = parseArgs(['--limit=5']);
      expect(args.collection).to.equal('all');
    });

    it('parses --holdSeconds=120 and --holdSeconds 120', () => {
      expect(parseArgs(['--holdSeconds=120']).holdSeconds).to.equal(120);
      expect(parseArgs(['--holdSeconds', '120']).holdSeconds).to.equal(120);
      expect(parseArgs([]).holdSeconds).to.equal(0);
    });
  });

  describe('getCollectionsToRun', () => {
    it('returns only job_postings when collection is job_postings', () => {
      const run = getCollectionsToRun('job_postings');
      expect(run).to.deep.equal(['job_postings']);
      expect(run).to.not.include('job_orders');
    });

    it('returns job_orders when collection is job_orders', () => {
      const run = getCollectionsToRun('job_orders');
      expect(run).to.deep.equal(['job_orders']);
    });

    it('returns all collections when collection is all', () => {
      const run = getCollectionsToRun('all');
      expect(run).to.include('job_postings');
      expect(run).to.include('job_orders');
    });
  });

  describe('shouldRunJobOrdersEnBackfill', () => {
    it('returns false for collection=job_postings (must not run job_orders backfill)', () => {
      expect(shouldRunJobOrdersEnBackfill('job_postings')).to.equal(false);
    });

    it('returns false for collection=shifts', () => {
      expect(shouldRunJobOrdersEnBackfill('shifts')).to.equal(false);
    });

    it('returns true for collection=job_orders', () => {
      expect(shouldRunJobOrdersEnBackfill('job_orders')).to.equal(true);
    });

    it('returns true for collection=all', () => {
      expect(shouldRunJobOrdersEnBackfill('all')).to.equal(true);
    });
  });

  it('full flow: collection=job_postings does not include job_orders in run list', () => {
    const args = parseArgs(['--collection', 'job_postings']);
    const collectionsToRun = getCollectionsToRun(args.collection);
    expect(collectionsToRun).to.not.include('job_orders');
    expect(collectionsToRun).to.include('job_postings');
    expect(shouldRunJobOrdersEnBackfill(args.collection)).to.equal(false);
  });
});
