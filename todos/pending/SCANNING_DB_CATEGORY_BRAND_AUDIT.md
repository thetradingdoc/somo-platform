# Scanning DB Category/Brand Audit

Date: 2026-04-16  
Scope: brand counts + category structure for scanning feature data.

## 1) Data Sources Audited

- **Primary source for counts:** GCS OBF baseline stream  
  `gs://skinandcare-media-staging/obf/raw/full/en.openbeautyfacts.org.products.csv.gz`
- **Local index schema:** `middleware-platform/middleware-dev.db`
  - `products_obf_index`
  - `products_off_index`

Note: local `products_obf_index` is currently empty in this environment, so count-level analytics were computed from the GCS baseline stream.

## 2) Requested Brand Counts by Category

Category matching is keyword-based over product name, brands, ingredients, and category tags/hierarchy.

### Supplements

- Matched rows: **1,473**
- Unique brands (total): **1,006**
- Unique brands (excluding placeholders like `Unknown`/`Null`): **1,004**
- Total category-tag links: **1,990**
- Unique category tags: **532**

Top brands:
- Unknown (88)
- L'Oréal (49)
- Bioderma (14)
- L'OREAL NORGE AS (14)
- Henkel (13)

### Haircare

- Matched rows: **4,816**
- Unique brands (total): **1,992**
- Unique brands (excluding placeholders): **1,990**
- Total category-tag links: **8,302**
- Unique category tags: **555**

Top brands:
- L'Oréal (335)
- Unknown (284)
- Henkel (155)
- Unilever (128)
- Head & Shoulders (76)

### Body

- Matched rows: **8,315**
- Unique brands (total): **3,455**
- Unique brands (excluding placeholders): **3,452**
- Total category-tag links: **13,786**
- Unique category tags: **1,216**

Top brands:
- Unknown (397)
- Unilever (296)
- Nivea (256)
- L'Oréal (211)
- Axe (117)

## 3) DB Shape (Scanning Catalog Indexes)

`products_obf_index` and `products_off_index` share the same schema:

- `code` (TEXT, PK)
- `product_name` (TEXT)
- `brands` (TEXT)
- `brands_tags_json` (TEXT)
- `categories_tags_json` (TEXT)
- `categories_hierarchy_json` (TEXT)
- `ingredients_text` (TEXT)
- `ingredients_tags_json` (TEXT)
- `ingredients_analysis_tags_json` (TEXT)
- `states_tags_json` (TEXT)
- `image_url` (TEXT)
- `product_url` (TEXT)
- `source` (TEXT, default `baseline`)
- `source_file` (TEXT)
- `last_modified_t` (INTEGER)
- `ingested_at` (DATETIME, default `CURRENT_TIMESTAMP`)
- `updated_at` (DATETIME, default `CURRENT_TIMESTAMP`)

## 4) Category Types Used by Scanning Pipeline

Operational route types used for scanning semantic contracts:

- `cosmetic`
- `hygiene`
- `non_food`
- `supplement`
- `food`
- `meds`
- `unknown`

## 5) Baseline Route Distribution (GCS Stream Audit)

From full OBF baseline stream (64,349 rows), route counts from the existing route audit:

- `unknown`: 44,305
- `hygiene`: 8,131
- `non_food`: 5,081
- `cosmetic`: 6,669
- `supplement`: 98
- `food`: 65

## 6) Interpretation Notes

- Brand quality is noisy (`Unknown`, `Null`, merged label variants), so UI should normalize brand names before display.
- Category tags are multi-label; one product can contribute to many categories.
- Supplements/hair/body groups above are practical discovery buckets for carousel and analytics, not strict clinical taxonomy classes.
