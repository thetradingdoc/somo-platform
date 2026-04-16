# Products Documentation

Reference documentation for product-related features.

## Contents

- **[OPEN_BEAUTY_FACTS_DATA_MODEL.md](./OPEN_BEAUTY_FACTS_DATA_MODEL.md)** — OBF global API: categories/tags/hierarchy, field mapping, and how DocLittle normalizes responses
- **cbd-medical-knowledge-summary.md** — CBD product types and medical uses for voice agent recommendations (sleep, pain, anxiety)
- **cbd-product-analysis.md** — Product analysis
- **PRODUCT_LIST.md** — Example product inventory (tenant-specific reference)

**Note:** PRODUCT_LIST and related files may be tenant-specific.

**Barcode / product lookup (current code):**

- `GET /api/public/beautyfacts/:barcode` (OBF) and `GET /api/public/foodfacts/:barcode` (OFF)
- master-first serving from local catalog indexes (`products_obf_index`, `products_off_index`)
- live upstream calls are fallback only, with successful fallback results upserted into master indexes

Canonical admin stats/KPI:

- `GET /api/admin/catalog/master-stats`
- `GET /api/admin/metrics` → `catalog_master`

---

**Last Updated:** April 14, 2026
