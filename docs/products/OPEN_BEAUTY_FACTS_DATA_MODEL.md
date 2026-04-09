# Open Beauty Facts (global) — API data model & categorization

**Scope:** How [Open Beauty Facts](https://world.openbeautyfacts.org/) (OBF) stores and exposes product data in the **same Product Opener JSON** shape as [Open Food Facts](https://world.openfoodfacts.org/) (OFF). OBF is the cosmetics / personal-care instance; field names and taxonomy rules are shared.

**Last updated:** April 9, 2026

---

## 1. Endpoint your stack uses

**Upstream (Product Opener, not DocLittle):** the public read contract is documented in the [Open Food Facts Server API](https://openfoodfacts.github.io/openfoodfacts-server/api/) (OBF uses the same shape on `world.openbeautyfacts.org`).

| Layer | URL / role |
|--------|-----|
| **Official read API** | `GET {host}/api/v2/product/{barcode}` with `Accept: application/json` |
| **OBF host (default)** | `https://world.openbeautyfacts.org` (override with `OPEN_BEAUTY_FACTS_BASE_URL`) |

**DocLittle integration (internal only — not part of the upstream API):**

| Piece | Role |
|--------|------|
| **`open-beauty-facts-service.js`** | In-process HTTP **client** to OBF: same path as above, `GET` + `Accept: application/json`. |
| **`GET /api/public/beautyfacts/:barcode`** | Middleware **route** that calls `fetchBeautyFactsByBarcode` and returns the normalized product JSON to your apps. |

Response shape (simplified):

```json
{
  "code": "3574669909594",
  "status": 1,
  "status_verbose": "product found",
  "product": { "...": "see below" }
}
```

- **`status`**: `1` = found, `0` = not found (barcode known to API but no product, or invalid).
- **`product`**: Full document; size varies (often tens of KB with images metadata).

---

## 2. How products are *categorised* in the API (taxonomy mapping)

OBF does **not** use a single numeric “category id” only. Classification is done with **parallel representations** of the same information:

| Field | Role |
|--------|------|
| **`categories`** | Human-editable string (often comma-separated), as entered on the website / app. **Not** stable for code or analytics. |
| **`categories_tags`** | **Normalized** tags: identifiers such as `en:shower-gels`, `en:body-creams`. This is the **machine** list used for search and facets. **Use `categories_tags` for logic, filters, and analytics**; do not rely on raw `categories` for those. |
| **`categories_hierarchy`** | Same tags ordered **from broad → specific** (parent chain). Useful for trees / “where in the taxonomy” logic. |
| **`categories_lc`** | **Language code** for category display (e.g. `fr`), not a duplicate of hierarchy. |
| **`categories_fr`** / **`main_category_fr`** (etc.) | Locale-specific **display** fields when present (pattern repeats per locale). |
| **`compared_to_category`** | Internal comparison bucket; on beauty products you may see values such as `en:open-beauty-facts` (non-food / beauty context). |
| **`main_category`** / **`main_category_en`** (when present) | A single primary category (export / simplified views; not always present in every JSON). |

**`_tags` fields in JSON:** In API **JSON** responses, fields like `categories_tags`, `states_tags`, etc. are typically **arrays of strings**. Comma-separated lists appear in other contexts (e.g. some **CSV** exports or **request** parameters using `fields=…` — note the plural **`fields`**, not `field`). See [data-fields.txt](https://static.openfoodfacts.org/data/data-fields.txt) and the [full JSON example](https://wiki.openfoodfacts.org/API/Full_JSON_example) on the OFF wiki.

**Ingredients / labels / allergens** use the same pattern:

| Cluster | Free-ish input | Normalized tags | Hierarchy |
|---------|------------------|-----------------|-----------|
| Ingredients | `ingredients_text`, parsed structure | `ingredients_tags` | `ingredients_hierarchy` |
| Labels (certifications) | `labels` | `labels_tags` | `labels_hierarchy` |
| Allergens | `allergens` | `allergens_tags` | `allergens_hierarchy` |
| Countries | `countries` | `countries_tags` | `countries_hierarchy` |

So the **mapping** you care about for “how is it categorised” is:

```text
categories (text)  →  parser / taxonomy  →  categories_tags  +  categories_hierarchy
```

The **canonical ids** for automation are the **`categories_tags`** (and hierarchy order), not the raw `categories` string.

---

## 3. Product type (and food vs non-food context)

The **`product_type`** field **may** appear on some Product Opener documents. Official API documentation does **not** define a fixed, stable enum for cosmetics (or guarantee a particular string). Treat any value as **opaque**: verify behavior against **live payloads in your own environment** if you depend on it.

DocLittle **passes through** **`product_type`** as a string when present, without interpreting it as a known enum.

Nutrition-related fields (e.g. `nutriments`, Nutri-Score) are often **empty** or **not applicable** for cosmetics; the API may still include `nutriscore_grade: "not-applicable"` etc.

---

## 4. Other high-signal fields (storage model)

From the shared [data-fields](https://static.openfoodfacts.org/data/data-fields.txt) conventions and live OBF JSON:

| Area | Fields |
|------|--------|
| Identity | `code`, `url`, `product_name`, `product_name_en`, `brands`, `brands_tags`, `quantity` |
| Media | `image_url`, `image_front_url`, `images` (revisioned) |
| Geography | `countries`, `countries_tags`, `origins`, `origins_tags`, `manufacturing_places`, `stores` |
| Composition | `ingredients_text`, `ingredients` (array with `id`, `text`, `percent_*`), `ingredients_analysis_tags` |
| Completion | `states`, `states_tags`, `states_hierarchy` (e.g. photos completed, categories to be completed) |
| Meta | `created_t`, `last_modified_t`, `creator`, `editors_tags` |

**Timestamps:** Fields ending in `_t` are **Unix seconds**; `_datetime` fields are ISO 8601 when present (per data-fields.txt).

---

## 5. How DocLittle maps this (normalized subset)

`middleware-platform/services/open-beauty-facts-service.js` builds a **normalized object** for `GET /api/public/beautyfacts/:barcode` and internal callers:

| OBF / `product` source | DocLittle `normalized` field |
|-------------------------|------------------------------|
| `code` / `product.code` | `barcode` |
| `status` | `found` (boolean: status === 1) |
| `product_name`, `product_name_en`, `product_name_fr` | `product_name` (first match) |
| `brands` | `brands` (split list) |
| `ingredients_text_with_allergens` → `ingredients_text_en` → `ingredients_text` | `ingredients_text` |
| `product.ingredients[]` | `ingredients`: `{ id?, text, percent_estimate? }[]` (capped at 80 rows); canonical **`id`** preserved when present |
| `allergens` | `allergens` (split list) |
| `labels` | `labels` (split list) |
| **`categories`** | **`categories`** (split list) — **display / human string**; same source OBF stores |
| **`categories_tags`** | `string[]` — **Use `categories_tags` for logic, filters, and analytics** |
| **`categories_hierarchy`** | **`categories_hierarchy`** (`string[]`) |
| **`ingredients_analysis_tags`** | **`ingredients_analysis_tags`** (`string[]`) |
| **`states_tags`** | **`states_tags`** (`string[]`) — completeness / quality hints |
| **`product_type`** | **`product_type`** (`string \| null`) — opaque pass-through if upstream sends it; not a documented fixed enum |
| `image_front_url` / `image_url` | `image_url` |
| `url` | `product_url` |

**Internal grading (not OBF):** `middleware-platform/services/product-grade-resolver.js` combines **labels**, **categories** (display), **`categories_tags`**, **`ingredients_analysis_tags`**, **`states_tags`**, **ingredient lines**, and **name** text into a **`grade_class`** (`MEDICAL_RX`, `OTC_DRUG`, `PROFESSIONAL`, `COSMECEUTICAL_MARKETING`, `GENERAL_COSMETIC`). That is **DocLittle logic**, not an OBF field.

**Caching / load:** The client does not cache responses today. For production, **cache by barcode** (e.g. TTL 24h+) and deduplicate concurrent lookups to protect upstream and latency.

---

## 6. Where to read more (official)

- **Field list (CSV export; same field names as JSON):** [data-fields.txt](https://static.openfoodfacts.org/data/data-fields.txt)
- **Product Opener / server API docs:** [Open Food Facts Server API](https://openfoodfacts.github.io/openfoodfacts-server/api/) (OBF uses the same read API on a different host)
- **OBF web:** [world.openbeautyfacts.org](https://world.openbeautyfacts.org/)

---

## 7. Summary

1. **Categorisation** in OBF is stored as **raw `categories` text** plus **normalized `categories_tags`** and **`categories_hierarchy`**. **Use `categories_tags` for logic, filters, and analytics**; keep **`categories`** for display.
2. The **remote** OBF index is a **large, growing** crowdsourced dataset; your SQLite mirror only stores products you have looked up or imported.
3. **DocLittle** exposes taxonomy tags, analysis tags, state tags, and structured ingredients on the normalized product from the internal beautyfacts route; **`product_type`** is included only as an **opaque** pass-through when the upstream payload provides it.
