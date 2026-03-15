/**
 * REMINDER SCHEDULER
 * Sends appointment reminders 1 hour before appointments
 * Runs every 5 minutes to check for upcoming appointments
 */

const db = require('../database');
const EmailService = require('./email-service');
let SMSService;
try {
  SMSService = require('./sms-service');
} catch (_) {
  SMSService = null;
}

class ReminderScheduler {
  static intervalId = null;
  static isRunning = false;

  /**
   * Start the reminder scheduler
   * Checks every 5 minutes for appointments needing reminders
   */
  static start() {
    if (this.isRunning) {
      console.log('⚠️  Reminder scheduler already running');
      return;
    }

    console.log('⏰ Starting reminder scheduler...');
    this.isRunning = true;

    // Run immediately on start
    this.checkAndSendReminders();

    // Then check every 5 minutes
    this.intervalId = setInterval(() => {
      this.checkAndSendReminders();
    }, 5 * 60 * 1000); // 5 minutes

    console.log('✅ Reminder scheduler started (checks every 5 minutes)');
  }

  /**
   * Stop the reminder scheduler
   */
  static stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('⏹️  Reminder scheduler stopped');
  }

  /**
   * Check for appointments needing reminders and send them (Task 52: 24h + 1h, optional SMS)
   */
  static async checkAndSendReminders() {
    try {
      const now = new Date();
      console.log(`\n⏰ Reminder Scheduler Check: ${now.toISOString()}`);

      const allAppointments = db.getAllAppointments({});
      console.log(`📋 Total appointments in database: ${allAppointments.length}`);

      // 24h reminders
      const needs24h = allAppointments.filter(appt => {
        if (!appt.status || !['scheduled', 'confirmed'].includes(appt.status)) return false;
        if (!appt.patient_email) return false;
        if (appt.reminder_24h_sent) return false;
        if (!appt.start_time) return false;
        const startTime = new Date(appt.start_time);
        const timeUntil = startTime.getTime() - now.getTime();
        const hoursUntil = timeUntil / (60 * 60 * 1000);
        return hoursUntil >= 23.5 && hoursUntil <= 24.5;
      });

      for (const appt of needs24h) {
        try {
          console.log(`📧 Sending 24h reminder for ${appt.id} (${appt.patient_name})`);
          const result = await EmailService.sendAppointmentReminder24h(appt);
          if (result.success) {
            if (db.markReminder24hSent) db.markReminder24hSent(appt.id);
            console.log(`✅ 24h reminder sent to ${appt.patient_email}`);
            if (SMSService && appt.patient_phone) {
              const tz = appt.timezone || 'America/New_York';
              const dt = new Date(appt.start_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
              const smsResult = await SMSService.sendSMS(appt.patient_phone, `DocLittle: Your appointment is tomorrow at ${dt}. Reply CANCEL to cancel.`);
              if (smsResult && smsResult.success) console.log(`   📱 SMS 24h reminder sent`);
            }
          } else {
            console.error(`❌ 24h reminder failed: ${result.error}`);
          }
        } catch (err) {
          console.error(`❌ 24h reminder error for ${appt.id}:`, err.message);
        }
      }

      // 1h reminders
      const appointmentsNeedingReminders = allAppointments.filter(appt => {
        if (!appt.status || !['scheduled', 'confirmed'].includes(appt.status)) return false;
        if (!appt.patient_email) return false;
        if (appt.reminder_sent) return false;
        if (!appt.start_time) return false;
        const startTime = new Date(appt.start_time);
        const timeUntil = startTime.getTime() - now.getTime();
        const minutesUntil = Math.floor(timeUntil / (60 * 1000));
        const needsReminder = timeUntil >= 55 * 60 * 1000 && timeUntil <= 65 * 60 * 1000;
        if (needsReminder) {
          console.log(`   📅 Found 1h: ${appt.patient_name} - ${appt.date} at ${appt.time} (${minutesUntil} min away)`);
        }
        return needsReminder;
      });

      console.log(`📧 1h Reminder Check: Found ${appointmentsNeedingReminders.length} appointments`);

      for (const appt of appointmentsNeedingReminders) {
        try {
          console.log(`📧 Sending 1h reminder for appointment ${appt.id} (${appt.patient_name})`);
          const result = await EmailService.sendAppointmentReminder(appt);

          if (result.success) {
            db.markReminderSent(appt.id);
            console.log(`✅ Reminder sent to ${appt.patient_email} for ${appt.date} at ${appt.time}`);
            if (SMSService && appt.patient_phone) {
              const tz = appt.timezone || 'America/New_York';
              const dt = new Date(appt.start_time).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
              await SMSService.sendSMS(appt.patient_phone, `DocLittle: Appointment reminder - you have an appointment at ${dt} today.`);
            }
          } else {
            console.error(`❌ Failed to send reminder to ${appt.patient_email}: ${result.error}`);
          }
        } catch (error) {
          console.error(`❌ Error sending reminder for ${appt.id}:`, error.message);
        }
      }

      if (needs24h.length === 0 && appointmentsNeedingReminders.length === 0) {
        console.log('   ℹ️  No appointments needing reminders at this time');
      }

    } catch (error) {
      console.error('❌ Error in reminder scheduler:', error);
    }
  }

  /**
   * Check for scheduled emails/calls and process them
   */
  static async checkAndSendScheduledActivities() {
    try {
      const now = new Date();
      console.log(`\n📅 Scheduled Activities Check: ${now.toISOString()}`);

      // Get all lead activities and filter for scheduled ones
      // We need to parse JSON metadata, so we'll filter in JavaScript
      const allActivities = db.db.prepare(`
        SELECT * FROM lead_activities 
        WHERE metadata IS NOT NULL
        ORDER BY activity_date ASC
      `).all();

      // Filter for scheduled activities by parsing JSON
      const scheduledActivities = allActivities.filter(activity => {
        try {
          const metadata = JSON.parse(activity.metadata || '{}');
          return metadata.status === 'scheduled' && metadata.scheduled_date;
        } catch {
          return false;
        }
      });

      console.log(`📋 Found ${scheduledActivities.length} scheduled activities`);

      const activitiesToProcess = scheduledActivities.filter(activity => {
        try {
          const metadata = JSON.parse(activity.metadata || '{}');
          if (metadata.status !== 'scheduled' || !metadata.scheduled_date) {
            return false;
          }

          const scheduledDate = new Date(metadata.scheduled_date);
          const timeUntil = scheduledDate.getTime() - now.getTime();
          
          // Process if scheduled date is in the past or within the next 2 minutes
          // (2-minute window to account for scheduler timing)
          return timeUntil <= 2 * 60 * 1000;
        } catch (error) {
          console.error(`❌ Error parsing metadata for activity ${activity.id}:`, error.message);
          return false;
        }
      });

      console.log(`📧 Found ${activitiesToProcess.length} activities ready to process`);

      for (const activity of activitiesToProcess) {
        try {
          const metadata = JSON.parse(activity.metadata || '{}');
          const leadId = activity.lead_id;
          const activityType = activity.activity_type;

          // Get lead details
          const lead = db.getLead(leadId);
          if (!lead) {
            console.warn(`⚠️  Lead ${leadId} not found for activity ${activity.id}`);
            continue;
          }

          if (activityType === 'email') {
            await this.processScheduledEmail(activity, lead, metadata);
          } else if (activityType === 'call') {
            await this.processScheduledCall(activity, lead, metadata);
          } else if (activityType === 'sms') {
            await this.processScheduledSMS(activity, lead, metadata);
          }

        } catch (error) {
          console.error(`❌ Error processing scheduled activity ${activity.id}:`, error.message);
        }
      }

      if (activitiesToProcess.length === 0) {
        console.log('   ℹ️  No scheduled activities ready to process at this time');
      }

    } catch (error) {
      console.error('❌ Error in scheduled activities check:', error);
    }
  }

  /**
   * Process a scheduled email
   */
  static async processScheduledEmail(activity, lead, metadata) {
    try {
      if (!lead.clinic_email) {
        console.warn(`⚠️  Lead ${lead.id} has no email address`);
        // Update activity status to failed
        db.db.prepare(`
          UPDATE lead_activities 
          SET metadata = ?
          WHERE id = ?
        `).run(
          JSON.stringify({
            ...metadata,
            status: 'failed',
            error: 'No email address'
          }),
          activity.id
        );
        return;
      }

      const subject = metadata.subject || activity.activity_subject || 'Email from DocLittle';
      const content = metadata.content || activity.activity_description || '';

      console.log(`📧 Sending scheduled email to ${lead.clinic_email} (Lead: ${lead.clinic_name})`);

      const emailResult = await EmailService.sendEmail({
        to: lead.clinic_email,
        subject: subject,
        html: content,
        text: content.replace(/<[^>]*>/g, '') // Strip HTML for text version
      });

      if (emailResult.success) {
        // Update activity status to sent
        db.db.prepare(`
          UPDATE lead_activities 
          SET metadata = ?,
              activity_date = datetime('now')
          WHERE id = ?
        `).run(
          JSON.stringify({
            ...metadata,
            status: 'sent',
            sent_at: new Date().toISOString(),
            email_provider: emailResult.provider,
            message_id: emailResult.message_id
          }),
          activity.id
        );

        console.log(`✅ Scheduled email sent to ${lead.clinic_email}`);
      } else {
        // Update activity status to failed
        db.db.prepare(`
          UPDATE lead_activities 
          SET metadata = ?
          WHERE id = ?
        `).run(
          JSON.stringify({
            ...metadata,
            status: 'failed',
            error: emailResult.error || 'Unknown error'
          }),
          activity.id
        );

        console.error(`❌ Failed to send scheduled email: ${emailResult.error}`);
      }

    } catch (error) {
      console.error(`❌ Error processing scheduled email:`, error.message);
      // Update activity status to failed
      db.db.prepare(`
        UPDATE lead_activities 
        SET metadata = ?
        WHERE id = ?
      `).run(
        JSON.stringify({
          ...metadata,
          status: 'failed',
          error: error.message
        }),
        activity.id
      );
    }
  }

  /**
   * Process a scheduled call (placeholder - can be implemented later)
   */
  static async processScheduledCall(activity, lead, metadata) {
    console.log(`📞 Scheduled call processing not yet implemented for lead ${lead.id}`);
    // TODO: Implement scheduled call processing
    // This would use RetellService.createOutboundCall
  }

  /**
   * Process a scheduled SMS (placeholder - can be implemented later)
   */
  static async processScheduledSMS(activity, lead, metadata) {
    console.log(`💬 Scheduled SMS processing not yet implemented for lead ${lead.id}`);
    // TODO: Implement scheduled SMS processing
    // This would use Twilio SMS API
  }

  /**
   * Start checking for scheduled activities
   * Runs every 2 minutes
   */
  static startScheduledActivities() {
    console.log('⏰ Starting scheduled activities processor...');

    // Run immediately on start
    this.checkAndSendScheduledActivities();

    // Then check every 2 minutes
    setInterval(() => {
      this.checkAndSendScheduledActivities();
    }, 2 * 60 * 1000); // 2 minutes

    console.log('✅ Scheduled activities processor started (checks every 2 minutes)');
  }

  /**
   * Manually trigger reminder check (for testing)
   */
  static async manualCheck() {
    console.log('🔍 Manual reminder check triggered');
    await this.checkAndSendReminders();
  }

  /**
   * Manually trigger scheduled activities check (for testing)
   */
  static async manualScheduledCheck() {
    console.log('🔍 Manual scheduled activities check triggered');
    await this.checkAndSendScheduledActivities();
  }
}

module.exports = ReminderScheduler;

