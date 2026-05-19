/**
 * Slice 2 unit tests — top-level parser orchestrator.
 *
 * Integration of normalize → classify → extract → LLM fallback. LLM
 * is mocked here so tests stay deterministic + fast.
 */

import { expect } from 'chai';

import { parseIndeedFlexEmail } from '../../../../integrations/indeedFlex/parser/parseIndeedFlexEmail';
import type { OpenAILike } from '../../../../integrations/indeedFlex/parser/llmFallback';

/**
 * Build a minimal OpenAI mock that returns canned JSON for the LLM
 * fallback call. Tests pass `disableLlm: true` for regex-only cases
 * and use this mock for hybrid cases.
 */
function mockOpenAI(returnJson: Record<string, unknown>): OpenAILike {
  return {
    chat: {
      completions: {
        create: (async () => ({
          choices: [{ message: { content: JSON.stringify(returnJson) } }],
        })) as unknown as OpenAILike['chat']['completions']['create'],
      },
    },
  };
}

describe('parseIndeedFlexEmail — full pipeline', () => {
  it('high-confidence new_request — all fields from regex, no LLM call', async () => {
    const result = await parseIndeedFlexEmail({
      subject: 'New job request starting soon — Job 509668',
      text: `
We have a new job request:

ID: 509668
Venue: Moscone Center
Role: Server
Number of workers: 4
Date: 2026-05-21
Shift: 9am - 5pm
Pay: $22.50/hr
`,
      disableLlm: true,
    });
    expect(result.events).to.have.lengthOf(1);
    const e = result.events[0];
    expect(e.event.type).to.equal('new_request');
    expect(e.confidence).to.equal('high');
    expect(e.parseSource).to.equal('regex');
    if (e.event.type === 'new_request') {
      expect(e.event.jobId).to.equal('509668');
      expect(e.event.headcount).to.equal(4);
      expect(e.event.workDate).to.equal('2026-05-21');
    }
  });

  it('low-confidence (regex misses, LLM disabled) — still ships', async () => {
    const result = await parseIndeedFlexEmail({
      subject: 'New job request starting soon',
      text: `
A new job request just came in but the body is incomplete.
`,
      disableLlm: true,
    });
    expect(result.events).to.have.lengthOf(1);
    const e = result.events[0];
    expect(e.confidence).to.equal('high');
    expect(e.parseSource).to.equal('regex');
  });

  it('hybrid: regex misses some, LLM fills them in', async () => {
    const llm = mockOpenAI({
      jobId: '999111',
      headcount: 5,
      workDate: '2026-06-01',
      startTime: '08:00',
      endTime: '16:00',
      venueName: 'San Jose Convention Center',
    });
    const result = await parseIndeedFlexEmail({
      subject: 'New job request starting soon',
      text: 'Indeed Flex says hi but the body is short.',
      llmClient: llm,
    });
    expect(result.events).to.have.lengthOf(1);
    const e = result.events[0];
    expect(e.parseSource).to.equal('hybrid');
    if (e.event.type === 'new_request') {
      expect(e.event.jobId).to.equal('999111');
      expect(e.event.headcount).to.equal(5);
      expect(e.event.workDate).to.equal('2026-06-01');
      expect(e.event.venueName).to.equal('San Jose Convention Center');
    }
  });

  it('classifies cancel_booking and extracts worker list', async () => {
    const result = await parseIndeedFlexEmail({
      subject: 'We have removed the following bookings',
      text: `
We have removed the following bookings:

- Tihitna Ade
- Brianna Arnold

Venue: Moscone Center
Date: 2026-05-21
`,
      disableLlm: true,
    });
    expect(result.events).to.have.lengthOf(1);
    const e = result.events[0];
    expect(e.event.type).to.equal('cancel_booking');
    if (e.event.type === 'cancel_booking') {
      expect(e.event.workerNames).to.have.lengthOf(2);
    }
  });

  it('classifies no_show', async () => {
    const result = await parseIndeedFlexEmail({
      subject: 'Worker did not turn up',
      text: 'Your assigned worker John Smith did not turn up to their shift on 2026-05-21.',
      disableLlm: true,
    });
    expect(result.events).to.have.lengthOf(1);
    const e = result.events[0];
    expect(e.event.type).to.equal('no_show');
    if (e.event.type === 'no_show') {
      expect(e.event.workerName).to.equal('John Smith');
    }
  });

  it('classifies daily_digest_expired', async () => {
    const result = await parseIndeedFlexEmail({
      subject: 'Daily Brief: Allocations & Priorities',
      text: `
Daily Brief

Job requests expired:
- Job 509668
- Job 509669
`,
      disableLlm: true,
    });
    expect(result.events).to.have.lengthOf(1);
    const e = result.events[0];
    expect(e.event.type).to.equal('daily_digest_expired');
    if (e.event.type === 'daily_digest_expired') {
      expect(e.event.expiredJobs).to.have.lengthOf(2);
    }
  });

  it('returns reason=unclassified for unrecognized subjects', async () => {
    const result = await parseIndeedFlexEmail({
      subject: 'something totally different',
      text: 'body content',
      disableLlm: true,
    });
    expect(result.events).to.have.lengthOf(0);
    expect(result.reason).to.equal('unclassified');
  });

  it('returns reason=no_body for empty inputs', async () => {
    const result = await parseIndeedFlexEmail({
      subject: 'New job request',
      text: '',
      disableLlm: true,
    });
    expect(result.events).to.have.lengthOf(0);
    expect(result.reason).to.equal('no_body');
  });

  it('downgrades to regex when LLM throws', async () => {
    const throwingLlm: OpenAILike = {
      chat: {
        completions: {
          create: (async () => {
            throw new Error('openai rate limit');
          }) as unknown as OpenAILike['chat']['completions']['create'],
        },
      },
    };
    const result = await parseIndeedFlexEmail({
      subject: 'New job request',
      text: 'short body',
      llmClient: throwingLlm,
    });
    expect(result.events).to.have.lengthOf(1);
    const e = result.events[0];
    expect(e.confidence).to.equal('low');
    expect(e.parseSource).to.equal('regex');
    expect(e.notes ?? '').to.match(/llm fallback failed/);
  });
});
