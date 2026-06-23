function enabled(name, defaultValue = true) {
  const raw = process.env[name];
  if (raw == null) return !!defaultValue;
  const v = String(raw).toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function visionFlags() {
  return {
    triggering: enabled('VISION_FLAG_TRIGGERING', true),
    roi: enabled('VISION_FLAG_ROI', true),
    quality: enabled('VISION_FLAG_QUALITY', true),
    providerReview: enabled('VISION_FLAG_PROVIDER_REVIEW', true)
  };
}

module.exports = {
  visionFlags
};
