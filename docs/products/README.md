# Products Documentation

Reference documentation for product-related features.

## Contents

- **[OPEN_BEAUTY_FACTS_DATA_MODEL.md](./OPEN_BEAUTY_FACTS_DATA_MODEL.md)** — OBF global API: categories/tags/hierarchy, field mapping, and how DocLittle normalizes responses
- **cbd-medical-knowledge-summary.md** — CBD product types and medical uses for voice agent recommendations (sleep, pain, anxiety)
- **cbd-product-analysis.md** — Product analysis
- **PRODUCT_LIST.md** — Example product inventory (tenant-specific reference)

**Note:** PRODUCT_LIST and related files may be tenant-specific.

**Barcode / product lookup (current code):** middleware exposes `GET /api/public/beautyfacts/:barcode` (Open Beauty Facts upstream). Implementation: `middleware-platform/services/open-beauty-facts-service.js` (route registration in `server.js`).

---

**Last Updated:** April 9, 2026
