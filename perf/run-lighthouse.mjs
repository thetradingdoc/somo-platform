import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';
import fs from 'fs';

const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
const outDir = process.env.LH_OUT_DIR || process.cwd();

const urls = [
  `${baseUrl}/unified-dashboard/patients/patient-login.html`,
  `${baseUrl}/unified-dashboard/patients/onboarding.html`,
  `${baseUrl}/unified-dashboard/patients/appointments.html`,
  `${baseUrl}/unified-dashboard/patients/patient-dashboard.html`
];

const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new'] });
const opts = { port: chrome.port, output: 'html', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] };

for (const url of urls) {
  const { report } = await lighthouse(url, opts);
  const safe = url.replace(/https?:\/\//, '').replace(/[^\w.-]+/g, '_');
  const file = `${outDir}/lighthouse_${safe}.html`;
  fs.writeFileSync(file, report);
  process.stdout.write(`wrote ${file}\n`);
}

await chrome.kill();

