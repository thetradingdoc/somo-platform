# Contact Extraction System

## ✅ What's Built

### 1. **Contact Extractor Service** (`services/contact-extractor.js`)
- Extracts phone numbers from job posting pages
- Extracts email addresses from job posting pages
- Handles various phone formats (US, international)
- Extracts from `mailto:` and `tel:` links
- Falls back to regex extraction from page text

### 2. **Automatic Extraction on Save**
- When saving a lead with `source_url`, automatically extracts contacts
- Only overwrites if contact info is missing
- Non-blocking (continues even if extraction fails)

### 3. **Manual Extraction Endpoints**
- `POST /api/admin/jobs/:id/extract-contact` - Extract for single lead
- `POST /api/admin/jobs/extract-contacts-batch` - Batch extract for multiple leads

### 4. **Admin UI Updates**
- Shows contact status (✅ Phone & Email, ✅ Phone, ✅ Email, ⚠️ No contact info)
- "Extract Contact" button for leads with source_url but no contacts
- "Call Clinic" button (only shows if phone available)
- "Email Clinic" button (only shows if email available)
- Displays call usage stats (X / 250 calls remaining)

## 📋 How It Works

1. **Job Search** → Returns jobs with `source_url` (job posting page)
2. **Save Lead** → Automatically extracts phone/email from `source_url`
3. **Manual Extract** → Can re-extract if needed
4. **Call/Email** → Agent can now call or email the clinic

## 🔍 Extraction Process

1. Fetches the job posting page HTML
2. Looks for `mailto:` and `tel:` links first (most reliable)
3. Falls back to regex extraction from page text
4. Normalizes phone numbers to E.164 format when possible
5. Filters out false positives (example.com, test emails, etc.)

## ⚠️ Limitations

- Some job sites may block scraping (rate limiting, CAPTCHA)
- Contact info may not always be on the job posting page
- Some sites use JavaScript to load contact info (won't work without headless browser)
- Extraction success rate depends on how the job site structures their pages

## 🚀 Next Steps

1. **Test extraction** with real job postings
2. **Add retry logic** for failed extractions
3. **Consider headless browser** (Puppeteer) for JavaScript-heavy sites
4. **Add extraction logging** to track success rates
