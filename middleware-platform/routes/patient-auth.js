'use strict';

function registerPatientAuthRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requirePatientSession,
    resolvePatientIdFromSession,
    recordPatientPortalEvent,
    PatientPortalService,
    blockWalletWhenDisabled,
    blockChatWhenDisabled,
    withIdempotency,
    botGuard,
    authLimiter,
    otpSendLimiter,
    otpConfirmLimiter,
    requireAdminAuth,
    sendUploadLinkHandler,
    issuePatientDocumentDownloadUrl,
    parseBillingDocumentUpload,
    billingOk,
    billingErr,
    resolveBillingSubscription,
    requirePlusForBillingFeature,
    isPatientWalletEnabled,
    isPatientChatEnabled,
    parseBooleanFlag,
  } = deps;

app.post('/api/patient/verify/send', botGuard, authLimiter, otpSendLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address required'
      });
    }

    const result = await PatientPortalService.sendVerificationCode(email, {
      ip: req.ip || req.connection?.remoteAddress || '',
      userAgent: req.get('User-Agent') || ''
    });

    if (result.success) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('otp_send_success'); } catch (_) {}
      try {
        db.insertAuditEvent && db.insertAuditEvent({
          actor_type: 'patient',
          actor_id: null,
          patient_id: null,
          resource_type: 'session',
          resource_id: result.session_id || null,
          action: 'otp_sent',
          metadata: { ip: req.ip || null }
        });
      } catch (_) {}
      res.json({
        success: true,
        session_id: result.session_id,
        existing_patient: !!result.existing_patient,
        message: result.message || 'Verification code sent to your email'
      });
    } else {
      try { db.incrementOpsCounter && db.incrementOpsCounter('otp_send_failed'); } catch (_) {}
      res.status(400).json(result);
    }
  } catch (error) {
    try { db.incrementOpsCounter && db.incrementOpsCounter('otp_send_error'); } catch (_) {}
    console.error('❌ Error sending verification code:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/patient/verify/confirm', botGuard, authLimiter, otpConfirmLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: 'Email and verification code required'
      });
    }

    const result = PatientPortalService.verifyCode(email, code);

    if (result.success) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('otp_confirm_success'); } catch (_) {}
      try {
        db.insertAuditEvent && db.insertAuditEvent({
          actor_type: 'patient',
          actor_id: null,
          patient_id: result.patient_id || null,
          resource_type: 'session',
          resource_id: result.session_id || null,
          action: 'login_success',
          metadata: { ip: req.ip || null }
        });
      } catch (_) {}
      // Optional: cookie-based session storage (mvp-59). Frontend may still use x-session-id header.
      const isSecure = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
      res.cookie('patient_session_id', result.session_id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecure,
        maxAge: 24 * 60 * 60 * 1000 // 24h absolute, inactivity handled server-side
      });
      issueCsrfCookie(res);
      // Determine onboarding completeness to drive web redirect
      let onboarding_profile_complete = false;
      let onboarding_step3_complete = false;
      let missing_fields = ['first_name', 'last_name', 'dob', 'phone', 'country', 'city'];
      try {
        const row = (result.patient_id && db.getFHIRPatient) ? db.getFHIRPatient(result.patient_id) : null;
        const resource = row?.resource_data
          ? (typeof row.resource_data === 'string' ? JSON.parse(row.resource_data) : row.resource_data)
          : null;
        if (resource && PatientIntakeService?.canonicalFromPatientResource) {
          const canonical = PatientIntakeService.canonicalFromPatientResource(resource);
          const status = PatientIntakeService.onboardingStatusFromCanonical(canonical);
          onboarding_profile_complete = !!status.onboarding_complete;
          missing_fields = status.missing_fields || missing_fields;
        }
      } catch (_) {}
      const step3 = getPatientStep3Status({ sessionId: result.session_id, patientId: result.patient_id || null });
      onboarding_step3_complete = !!step3.completed;
      const onboarding_complete = onboarding_profile_complete && onboarding_step3_complete;
      res.json({
        success: true,
        session_id: result.session_id,
        patient_id: result.patient_id,
        email: result.email,
        created_patient: !!result.created_patient,
        onboarding_profile_complete,
        onboarding_step3_complete,
        onboarding_step3_reason: step3.reason || null,
        onboarding_complete,
        missing_fields
      });
    } else {
      try { db.incrementOpsCounter && db.incrementOpsCounter('otp_confirm_failed'); } catch (_) {}
      res.status(400).json(result);
    }
  } catch (error) {
    try { db.incrementOpsCounter && db.incrementOpsCounter('otp_confirm_error'); } catch (_) {}
    console.error('❌ Error verifying code:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/patient/logout', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.body?.session_id;
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID required'
      });
    }

    try {
      if (db.deletePatientSession) {
        db.deletePatientSession(sessionId);
      }
    } catch (_) {
      // ignore delete errors for logout
    }

    try {
      // Also delete any legacy patient_portal_sessions row
      db.db.prepare(`DELETE FROM patient_portal_sessions WHERE id = ?`).run(sessionId);
    } catch (_) {}

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error logging out patient session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
}

module.exports = { registerPatientAuthRoutes };
