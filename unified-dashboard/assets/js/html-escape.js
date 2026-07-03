/**
 * Shared HTML escaping for provider/admin pages.
 * Prefer textContent for new code; use escapeHtml when building template strings.
 */
(function (root) {
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  const SomoHtml = { escapeHtml, escapeAttr, esc: escapeHtml };
  root.SomoHtml = SomoHtml;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SomoHtml;
  }
})(typeof window !== 'undefined' ? window : global);
