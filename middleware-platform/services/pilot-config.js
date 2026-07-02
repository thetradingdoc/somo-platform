'use strict';

function isPilotInviteOnly() {
  const v = String(process.env.PILOT_INVITE_ONLY || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function getPublicPilotConfig() {
  return {
    pilot_invite_only: isPilotInviteOnly(),
    waitlist_url: '/waitlist.html',
    invite_url: '/invite.html'
  };
}

module.exports = {
  isPilotInviteOnly,
  getPublicPilotConfig
};
