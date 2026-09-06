/**
 * Slack alerts via chat.postMessage with a bot token (same mechanism as
 * functions/src/slack/sendSlackChannelMessage.ts). Optional: with no token or
 * channel configured every call is a logged no-op, so the worker runs fine
 * on a laptop without Slack. `alertOnce` dedupes repeating conditions
 * (login wall, no credentials) so a stuck session does not spam the channel.
 */
import type { WorkerConfig } from './config.ts';
import { log, redact } from './logger.ts';

export class SlackNotifier {
  private readonly enabled: boolean;
  private readonly recent = new Map<string, number>();

  constructor(private readonly config: WorkerConfig) {
    this.enabled = Boolean(config.slack.botToken && config.slack.channelId);
    redact(config.slack.botToken);
  }

  async notify(text: string): Promise<void> {
    if (!this.enabled) {
      log.info('slack (not configured)', { text });
      return;
    }
    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.slack.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: this.config.slack.channelId, text }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!body.ok) log.warn('slack post failed', { error: body.error });
    } catch (err) {
      log.warn('slack post threw', { err });
    }
  }

  /** Post at most once per `ttlMs` for the same key. */
  async alertOnce(key: string, text: string, ttlMs = 60 * 60_000): Promise<void> {
    const last = this.recent.get(key) ?? 0;
    if (Date.now() - last < ttlMs) return;
    this.recent.set(key, Date.now());
    await this.notify(text);
  }

  /** Clear a dedupe key when the condition resolves so the next occurrence alerts again. */
  clear(key: string): void {
    this.recent.delete(key);
  }
}
