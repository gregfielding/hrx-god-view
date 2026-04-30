/**
 * `assertEvereeWorkerIdMatch` — defense-in-depth check for Everee fetch sites.
 *
 * The original symptom (EE.1, Apr 2026) looked like a closure-in-loop bug:
 * two console blocks in the User Profile debug fetcher both labeled with
 * the same (tenant × worker) pair, but with response bodies from two
 * different workers. The actual root cause was a wrong link-doc filter,
 * but the principle stands — any future site that fans out an Everee
 * fetch over multiple `(evereeTenantId, evereeWorkerId)` pairs is one
 * sloppy refactor away from leaking the wrong worker's PII into the wrong
 * tab. This helper catches that with a console.error + stack trace at the
 * exact call site, instead of silently rendering wrong data.
 *
 * Tests below pin both branches:
 *   - server-callable echoes (`EvereeAdminGetWorkerResult.evereeWorkerId`)
 *   - raw Everee API response (`workerId` / `id`, with optional wrapping)
 * plus the W.1-mirror-style iteration regression test the EE.1 task asked
 * for: simulate two pairs, run them sequentially, assert each ends up with
 * its own data. If a future refactor introduces a closure-in-loop, this
 * test fails on the second iteration's mismatched assertion call.
 */

import { assertEvereeWorkerIdMatch } from '../assertEvereeWorkerIdMatch';

describe('assertEvereeWorkerIdMatch', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('server echo branch', () => {
    it('passes when server-echoed evereeWorkerId matches the request', () => {
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: 'a39debb3-1234-4ab1-9cde-aaaaaaaaaaaa',
        serverEchoEvereeWorkerId: 'a39debb3-1234-4ab1-9cde-aaaaaaaaaaaa',
        context: { site: 'unit-test' },
      });
      expect(result).toEqual({ ok: true, reason: 'match' });
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('fails loudly when server echo disagrees with request', () => {
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: 'a39debb3-1234-4ab1-9cde-aaaaaaaaaaaa',
        serverEchoEvereeWorkerId: '1bd8a4e4-9999-4ab1-9cde-bbbbbbbbbbbb',
        context: { site: 'unit-test', evereeTenantId: '3133' },
      });
      expect(result).toEqual({ ok: false, reason: 'server_echo_mismatch' });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [msg, ctx] = errorSpy.mock.calls[0];
      expect(msg).toMatch(/server echo/);
      expect(ctx).toMatchObject({
        site: 'unit-test',
        evereeTenantId: '3133',
        expectedEvereeWorkerId: 'a39debb3-1234-4ab1-9cde-aaaaaaaaaaaa',
        serverEchoEvereeWorkerId: '1bd8a4e4-9999-4ab1-9cde-bbbbbbbbbbbb',
      });
    });

    it('trims whitespace before comparing server echo', () => {
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: '  a39debb3-1234  ',
        serverEchoEvereeWorkerId: 'a39debb3-1234',
        context: { site: 'unit-test' },
      });
      expect(result).toEqual({ ok: true, reason: 'match' });
    });

    it('skips server-echo check when echo is undefined / empty', () => {
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: 'a39debb3-1234',
        serverEchoEvereeWorkerId: undefined,
        context: { site: 'unit-test' },
      });
      expect(result).toEqual({ ok: true, reason: 'match' });
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('response body branch', () => {
    it('passes when response body workerId matches', () => {
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: 'a39debb3-1234',
        responseBody: {
          workerId: 'a39debb3-1234',
          employmentType: 'EMPLOYEE',
        },
        context: { site: 'unit-test' },
      });
      expect(result).toEqual({ ok: true, reason: 'match' });
    });

    it('passes when response body id matches (no workerId field)', () => {
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: 'a39debb3-1234',
        responseBody: {
          id: 'a39debb3-1234',
          employmentType: 'EMPLOYEE',
        },
        context: { site: 'unit-test' },
      });
      expect(result).toEqual({ ok: true, reason: 'match' });
    });

    it('passes when wrapped under .worker (Everee envelope variant)', () => {
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: 'a39debb3-1234',
        responseBody: {
          worker: {
            workerId: 'a39debb3-1234',
            employmentType: 'EMPLOYEE',
          },
        },
        context: { site: 'unit-test' },
      });
      expect(result).toEqual({ ok: true, reason: 'match' });
    });

    it('passes when wrapped under .data (Everee envelope variant)', () => {
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: 'a39debb3-1234',
        responseBody: {
          data: {
            id: 'a39debb3-1234',
          },
        },
        context: { site: 'unit-test' },
      });
      expect(result).toEqual({ ok: true, reason: 'match' });
    });

    it('fails loudly when response body workerId disagrees with request', () => {
      // Pinned EE.1 reproduction: requested a39de.../C1 Select, response
      // body claims 1bd8.../C1 Events. This is exactly the leak we want
      // surfaced — even with a clean closure (sequential await, immutable
      // local consts), if the upstream returned the wrong worker we
      // refuse to silently render it.
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: 'a39debb3-1234',
        responseBody: {
          workerId: '1bd8a4e4-9999',
          employmentType: 'CONTRACTOR',
        },
        context: { site: 'unit-test', evereeTenantId: '3133' },
      });
      expect(result).toEqual({ ok: false, reason: 'response_body_mismatch' });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [msg, ctx] = errorSpy.mock.calls[0];
      expect(msg).toMatch(/Everee API response body disagrees/);
      expect(ctx).toMatchObject({
        site: 'unit-test',
        evereeTenantId: '3133',
        expectedEvereeWorkerId: 'a39debb3-1234',
        responseWorkerId: '1bd8a4e4-9999',
      });
    });

    it('treats null/undefined responseBody as nothing-to-check', () => {
      const r1 = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: 'a39debb3-1234',
        responseBody: null,
        context: { site: 'unit-test' },
      });
      const r2 = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: 'a39debb3-1234',
        responseBody: undefined,
        context: { site: 'unit-test' },
      });
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('returns no_response when neither echo nor body workerId present', () => {
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: 'a39debb3-1234',
        responseBody: { onboardingStatus: 'COMPLETE' },
        context: { site: 'unit-test' },
      });
      expect(result).toEqual({ ok: true, reason: 'no_response' });
    });
  });

  describe('expected-missing branch', () => {
    it('flags an empty expected workerId as a programmer error', () => {
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: '',
        serverEchoEvereeWorkerId: 'whatever',
        context: { site: 'unit-test' },
      });
      expect(result).toEqual({ ok: false, reason: 'expected_missing' });
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('treats whitespace-only expected workerId as missing', () => {
      const result = assertEvereeWorkerIdMatch({
        expectedEvereeWorkerId: '   ',
        serverEchoEvereeWorkerId: 'whatever',
        context: { site: 'unit-test' },
      });
      expect(result).toEqual({ ok: false, reason: 'expected_missing' });
    });
  });

  describe('per-pair iteration regression (EE.1 — pin this forever)', () => {
    /**
     * Models the EE.1 hypothesis: iterate over `users.evereeWorkerIds`,
     * call the Everee API for each, run the assertion. If a future
     * refactor introduces a closure-in-loop (or any other mispairing —
     * wrong link-doc filter, stale state in EmployeePayrollSection),
     * the assertion fires on the iteration that received the wrong
     * data.
     */
    it('pairs each iteration with its own response (correct case)', async () => {
      const fakeApiResponses: Record<
        string,
        { evereeWorkerId: string; response: { workerId: string; employmentType: string } }
      > = {
        'a39debb3-1234': {
          evereeWorkerId: 'a39debb3-1234',
          response: { workerId: 'a39debb3-1234', employmentType: 'EMPLOYEE' },
        },
        '1bd8a4e4-9999': {
          evereeWorkerId: '1bd8a4e4-9999',
          response: { workerId: '1bd8a4e4-9999', employmentType: 'CONTRACTOR' },
        },
      };

      const fakeFetch = async (workerId: string) =>
        Promise.resolve(fakeApiResponses[workerId]);

      const userEvereeWorkerIds: Record<string, string> = {
        '3133': 'a39debb3-1234',
        '3138': '1bd8a4e4-9999',
      };

      const results: Array<{
        evereeTenantId: string;
        evereeWorkerId: string;
        ok: boolean;
      }> = [];

      for (const [evereeTenantId, evereeWorkerId] of Object.entries(userEvereeWorkerIds)) {
        const data = await fakeFetch(evereeWorkerId);
        const check = assertEvereeWorkerIdMatch({
          expectedEvereeWorkerId: evereeWorkerId,
          serverEchoEvereeWorkerId: data.evereeWorkerId,
          responseBody: data.response,
          context: { site: 'iteration-test', evereeTenantId },
        });
        results.push({ evereeTenantId, evereeWorkerId, ok: check.ok });
      }

      expect(results).toEqual([
        { evereeTenantId: '3133', evereeWorkerId: 'a39debb3-1234', ok: true },
        { evereeTenantId: '3138', evereeWorkerId: '1bd8a4e4-9999', ok: true },
      ]);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('catches the EE.1 leak: second iteration receives first iteration\'s data', async () => {
      // Simulates a buggy fetcher that, due to closure-over-loop or stale
      // state, hands the second iteration a response from the first.
      // The assertion must reject the second call.
      const buggyFetch = async (_workerId: string) =>
        Promise.resolve({
          // Server echo + body both report the FIRST worker's id, regardless
          // of what was requested. This is exactly what the original EE.1
          // symptom looked like.
          evereeWorkerId: 'a39debb3-1234',
          response: { workerId: 'a39debb3-1234', employmentType: 'EMPLOYEE' },
        });

      const userEvereeWorkerIds: Record<string, string> = {
        '3133': 'a39debb3-1234',
        '3138': '1bd8a4e4-9999',
      };

      const checks: Array<{
        evereeTenantId: string;
        ok: boolean;
        reason: string;
      }> = [];

      for (const [evereeTenantId, evereeWorkerId] of Object.entries(userEvereeWorkerIds)) {
        const data = await buggyFetch(evereeWorkerId);
        const check = assertEvereeWorkerIdMatch({
          expectedEvereeWorkerId: evereeWorkerId,
          serverEchoEvereeWorkerId: data.evereeWorkerId,
          responseBody: data.response,
          context: { site: 'buggy-iteration-test', evereeTenantId },
        });
        checks.push({ evereeTenantId, ok: check.ok, reason: check.reason });
      }

      // First iteration matches (asked for a39de.../got a39de...).
      expect(checks[0]).toEqual({
        evereeTenantId: '3133',
        ok: true,
        reason: 'match',
      });
      // Second iteration: asked for 1bd8.../got a39de... — must fail.
      expect(checks[1]).toEqual({
        evereeTenantId: '3138',
        ok: false,
        reason: 'server_echo_mismatch',
      });
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
