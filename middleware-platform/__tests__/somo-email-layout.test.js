'use strict';

const SomoEmail = require('../lib/somo-email-layout');

describe('somo-email-layout', () => {
  test('layout includes logo and brand colors', () => {
    const html = SomoEmail.layout({
      title: 'Test',
      subtitle: 'Sub',
      bodyHtml: '<p>Hello</p>'
    });
    expect(html).toContain(SomoEmail.LOGO_URL);
    expect(html).toContain('#1C35EA');
    expect(html).toContain('Somo — never answer business calls again');
    expect(html).not.toContain('DocLittle');
    expect(html).not.toMatch(/class="doc"/);
  });

  test('codeBox escapes html', () => {
    const html = SomoEmail.codeBox('<script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
