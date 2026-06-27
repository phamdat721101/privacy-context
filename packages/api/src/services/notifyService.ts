/**
 * notifyService — seller-side event fan-out.
 *
 * When something happens on a buyer's behalf (paid call settles, M4 message
 * arrives, async task completes), this service POSTs a structured event to
 * the agent's `notification_webhook_url` so the seller's own system gets a
 * real-time signal — no polling required.
 *
 * Delivery uses asyncTaskService.scheduleNotification(), which rides the
 * same HMAC-signed, exponential-backoff, DLQ-equipped pipeline as task
 * webhooks. No new infrastructure.
 *
 * SOLID:
 *   • SRP — one job: agent_id + event → scheduled delivery.
 *   • OCP — adding an event type is a new EventType union member; the
 *           payload schema stays open by including the event name.
 *   • DIP — depends on IAsyncTaskService, not the impl.
 */

import { pool } from '../db';
import { logger } from '../lib';
import { asyncTaskService } from './asyncTaskService';

export type AgentEvent =
  | 'paid_call.completed'
  | 'message.created'
  | 'task.completed'
  | 'task.failed';

export interface INotifyService {
  notify(agent_id: string, event: AgentEvent, data: Record<string, unknown>, event_key: string): Promise<void>;
}

class NotifyService implements INotifyService {
  /**
   * Lookup the agent's notification_webhook_url and schedule a delivery.
   * No-op when the column is NULL — sellers opt in by setting the URL.
   * Failures are logged but never thrown: the caller's primary write
   * (e.g. paidCallLedger.record) must not be coupled to notification
   * scheduling.
   */
  async notify(
    agent_id: string,
    event: AgentEvent,
    data: Record<string, unknown>,
    event_key: string,
  ): Promise<void> {
    try {
      const r = await pool.query<{ notification_webhook_url: string | null; slug: string | null }>(
        `SELECT notification_webhook_url, slug FROM agents WHERE id = $1 LIMIT 1`,
        [agent_id],
      );
      const url = r.rows[0]?.notification_webhook_url;
      if (!url) return;

      const payload = {
        event,
        agent_id,
        slug: r.rows[0]?.slug ?? null,
        timestamp: new Date().toISOString(),
        data,
      };
      await asyncTaskService.scheduleNotification(url, payload, `${event}:${event_key}`);
      logger.info({ agent_id, event, event_key }, 'notify:scheduled');
    } catch (err) {
      // Notifications must never break the primary write path.
      logger.warn({ agent_id, event, err: (err as Error).message }, 'notify:failed');
    }
  }
}

export const notifyService: INotifyService = new NotifyService();
