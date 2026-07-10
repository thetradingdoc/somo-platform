'use strict';

const {
  extractRssItems,
  extractPostingId,
  normalizeCraigslistJob,
  _clearCacheForTests
} = require('../services/craigslist-scraper');

const FIXTURE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Dental Front Desk - Downtown Office</title>
      <link>https://newyork.craigslist.org/mnh/ofc/d/new-york-dental-front-desk/7681234567.html</link>
      <description>Busy dental office needs receptionist. Call 212-555-0199 or email hire@example.com</description>
      <dc:date>2026-06-01T12:00:00Z</dc:date>
    </item>
  </channel>
</rss>`;

describe('craigslist-scraper', () => {
  beforeEach(() => {
    _clearCacheForTests();
  });

  test('extractRssItems parses posting link and title', () => {
    const items = extractRssItems(FIXTURE_RSS);
    expect(items).toHaveLength(1);
    expect(items[0].link).toContain('7681234567.html');
    expect(items[0].title).toContain('Dental Front Desk');
  });

  test('extractPostingId from URL', () => {
    expect(extractPostingId('https://newyork.craigslist.org/mnh/ofc/d/x/7681234567.html')).toBe('7681234567');
  });

  test('normalizeCraigslistJob dedupes with craigslist-region-id', () => {
    const item = extractRssItems(FIXTURE_RSS)[0];
    const job = normalizeCraigslistJob(item, 'newyork', 'Phone 212-555-0199');
    expect(job.external_id).toBe('craigslist-newyork-7681234567');
    expect(job.source).toBe('craigslist');
    expect(job.clinic_phone).toBeTruthy();
  });
});
