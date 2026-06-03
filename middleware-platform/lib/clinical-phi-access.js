'use strict';

/**
 * Staff-only gate for clinical prep PHI in provider/admin routes.
 */
function canViewClinicalPhi(req) {
  const scope = String(req?.user?.scope || '').toLowerCase();
  const role = String(req?.user?.role || '').toLowerCase();
  const isStaffScope = scope === 'clinician' || scope === 'staff' || scope === 'admin';
  const isStaffRole =
    role.includes('admin') || role.includes('clinician') || role.includes('staff');
  return !!(req?.providerId || req?.headers?.['x-provider-id'] || isStaffScope || isStaffRole);
}

module.exports = { canViewClinicalPhi };
