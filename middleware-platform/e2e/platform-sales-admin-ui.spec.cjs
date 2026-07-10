'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.describe('admin pipeline + lead UI (platform sales)', () => {
  test('pipeline.html includes source filter for inbound_platform', async () => {
    const html = fs.readFileSync(
      path.join(__dirname, '../../unified-dashboard/admin/pipeline.html'),
      'utf8'
    );
    expect(html).toContain('id="sourceSelect"');
    expect(html).toContain('inbound_platform');
    expect(html).toContain("params.set('source', currentSource)");
  });

  test('lead.html transcript labels agent as Kelly', async () => {
    const html = fs.readFileSync(
      path.join(__dirname, '../../unified-dashboard/admin/lead.html'),
      'utf8'
    );
    expect(html).toContain("'Kelly'");
    expect(html).not.toContain("'Alex'");
    expect(html).toContain('363 inbound');
  });
});
