/**
 * Durable notification queue worker (mvp-74)
 * - DB-backed jobs with retry + dead-letter
 * - Multi-instance safe via claim/lock update
 */

const crypto = require('crypto');
const db = require('../database');
const EmailService = require('./email-service');

function safeJsonParse(str) {
  try { return JSON.parse(str || '{}'); } catch (_) { return {}; }
}

function workerId() {
  const pid = process.pid;
  const rand = crypto.randomBytes(4).toString('hex');
  return `${pid}-${rand}`;
}

function computeBackoffMs(attempt) {
  // Exponential with cap: 5s, 15s, 45s, 2m, 5m, 10m
  const base = 5000 * Math.pow(3, Math.max(0, attempt - 1));
  return Math.min(base, 10 * 60 * 1000);
}

async function deliverEmail(job) {
  const payload = safeJsonParse(job.payload_json);
  const type = job.type;

  // Patient portal notification types we currently support
  if (type === 'patient_appt_rescheduled') {
    return EmailService.sendAppointmentRescheduled(payload.appointment, payload.details || {});
  }
  if (type === 'patient_appt_canceled') {
    return EmailService.sendAppointmentCanceled(payload.appointment);
  }
  if (type === 'patient_post_visit_summary_ready') {
    return EmailService.sendPostVisitSummaryReady(payload.appointment);
  }
  if (type === 'reminder_24h') {
    return EmailService.sendAppointmentReminder24h(payload.appointment, payload.options || {});
  }
  if (type === 'reminder_1h') {
    return EmailService.sendAppointmentReminder(payload.appointment, payload.options || {});
  }

  return { success: false, error: `Unknown notification type: ${type}` };
}

class NotificationQueue {
  static intervalId = null;
  static running = false;
  static wid = workerId();

  static start() {
    if (this.running) return;
    this.running = true;
    const pollMs = parseInt(process.env.NOTIFICATION_QUEUE_POLL_MS || '1500', 10);
    this.intervalId = setInterval(() => this.tick(), pollMs);
    // also tick immediately
    this.tick();
  }

  static stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.running = false;
  }

  static async tick() {
    if (!this.running) return;
    const job = db.claimNextNotificationJob(this.wid);
    if (!job) return;

    try {
      let result = null;
      if (job.channel === 'email') {
        result = await deliverEmail(job);
      } else {
        result = { success: false, error: `Unsupported channel: ${job.channel}` };
      }

      if (result && result.success) {
        db.completeNotificationJobSuccess(job.id, result.message_id || null);
        db.incrementOpsCounter('notification_sent');
        // Post-delivery side effects: mark reminder flags (only after successful delivery)
        try {
          if (job.type === 'reminder_24h' && job.appointment_id && db.markReminder24hSent) {
            db.markReminder24hSent(job.appointment_id);
          }
          if (job.type === 'reminder_1h' && job.appointment_id && db.markReminderSent) {
            db.markReminderSent(job.appointment_id);
          }
        } catch (_) {}
        return;
      }

      const err = (result && result.error) ? result.error : 'Delivery failed';
      const nextMs = computeBackoffMs((job.attempts || 0) + 1);
      const nextRunAt = new Date(Date.now() + nextMs).toISOString();
      const willBeDead = ((job.attempts || 0) + 1) >= (job.max_attempts || 6);
      db.completeNotificationJobFailure(job.id, err, nextRunAt, willBeDead);
      db.incrementOpsCounter(willBeDead ? 'notification_dead' : 'notification_failed');
    } catch (e) {
      const nextMs = computeBackoffMs((job.attempts || 0) + 1);
      const nextRunAt = new Date(Date.now() + nextMs).toISOString();
      const willBeDead = ((job.attempts || 0) + 1) >= (job.max_attempts || 6);
      db.completeNotificationJobFailure(job.id, e.message || 'Worker error', nextRunAt, willBeDead);
      db.incrementOpsCounter(willBeDead ? 'notification_dead' : 'notification_failed');
    }
  }
}

module.exports = NotificationQueue;

