/**
 * Contact Extractor Service
 * 
 * Extracts phone numbers and email addresses from job posting URLs
 * Used to populate lead contact information for agent calling/emailing
 */

const axios = require('axios');
const { searchJobs } = require('./job-scraper');

/** Domains that are job boards, ATS pages, or aggregators — not clinic websites. */
const JOB_BOARD_DOMAINS = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'snagajob.com',
  'recruit.net',
  'monster.com',
  'careerbuilder.com',
  'jobs.com',
  'simplyhired.com',
  'google.com',
  'talent.com',
  'careerplug.com',
  'smartrecruiters.com',
  'icims.com',
  'myworkdayjobs.com',
  'workday.com',
  'greenhouse.io',
  'boards.greenhouse.io',
  'lever.co',
  'jobs.lever.co',
  'applytojob.com',
  'bamboohr.com',
  'paylocity.com',
  'ultipro.com',
  'adp.com',
  'jobvite.com',
  'ashbyhq.com',
  'example.com',
];

function isJobBoardUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return JOB_BOARD_DOMAINS.some((d) => lower.includes(d));
}

/**
 * Validate US phone number
 * Returns true if valid US phone number (10 digits or 11 starting with 1)
 */
function isValidUSPhone(digits) {
  if (!digits || digits.length < 10 || digits.length > 11) return false;
  if (digits.length === 11 && !digits.startsWith('1')) return false;

  // Check area code (first 3 digits) - must not be 000, 111, etc.
  const areaCode = digits.length === 11 ? digits.substring(1, 4) : digits.substring(0, 3);
  if (areaCode[0] === '0' || areaCode[0] === '1') return false; // Area code can't start with 0 or 1

  // Check exchange code (next 3 digits) - must not be 000, 111, etc.
  const exchange = digits.length === 11 ? digits.substring(4, 7) : digits.substring(3, 6);
  if (exchange[0] === '0' || exchange[0] === '1') return false; // Exchange can't start with 0 or 1

  return true;
}

/**
 * Extract phone number from text using common patterns
 * Validates that it's a proper US phone number
 */
function extractPhoneNumber(text) {
  if (!text) return null;

  // Common phone patterns
  const phonePatterns = [
    // US formats: (555) 123-4567, 555-123-4567, 555.123.4567, 5551234567
    /(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g,
    // With country code: +1 555-123-4567, 1-555-123-4567
    /(\+?1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g,
    // Toll-free: 1-800-XXX-XXXX, 800-XXX-XXXX
    /(1?[-.\s]?(800|888|877|866|855|844|833)[-.\s]?\d{3}[-.\s]?\d{4})/g
  ];

  for (const pattern of phonePatterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      // Clean up the phone number
      let phone = matches[0].trim();
      // Remove common prefixes like "Phone:", "Tel:", "Call:"
      phone = phone.replace(/^(phone|tel|call|contact)[:\s]+/i, '');

      // Extract digits only
      const digits = phone.replace(/\D/g, '');

      // Validate it's a proper US phone number
      if (!isValidUSPhone(digits)) {
        continue; // Skip invalid numbers
      }

      // Normalize to E.164 format
      if (digits.length === 10) {
        return `+1${digits}`;
      } else if (digits.length === 11 && digits.startsWith('1')) {
        return `+${digits}`;
      }

      // If it already has +, validate and return
      if (phone.startsWith('+')) {
        const plusDigits = phone.replace(/\D/g, '');
        if (isValidUSPhone(plusDigits)) {
          return phone;
        }
      }
    }
  }

  return null;
}

/**
 * Extract email address from text
 */
function extractEmail(text) {
  if (!text) return null;

  // Email regex pattern
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailPattern);

  if (matches && matches.length > 0) {
    // Filter out common false positives
    const email = matches[0].toLowerCase();
    const excludePatterns = [
      /example\.com/i,
      /test\.com/i,
      /placeholder/i,
      /your-email/i
    ];

    for (const pattern of excludePatterns) {
      if (pattern.test(email)) return null;
    }

    return email;
  }

  return null;
}

/**
 * Extract contact info from HTML content
 */
function extractOpeningHours(text) {
  if (!text) return null;

  const dayPatterns = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const lines = text
    .split(/\n|\.|\r/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const hourLines = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (dayPatterns.some(day => lower.includes(day))) {
      if (/\d/.test(line)) {
        hourLines.push(line.replace(/\s{2,}/g, ' ').trim());
      }
    }
    if (hourLines.length >= 7) break;
  }

  if (hourLines.length === 0) return null;
  return hourLines.slice(0, 7).join(' | ');
}

function extractFromHTML(html) {
  if (!html) return { phone: null, email: null, openingHours: null };
  
  // Ensure html is a string
  if (typeof html !== 'string') {
    console.warn('⚠️  extractFromHTML received non-string input, converting...');
    html = String(html);
  }

  // Extract from mailto: and tel: links first (most reliable)
  const mailtoPattern = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  const telPattern = /tel:([+\d\s\-\(\)\.]+)/gi;

  let email = null;
  let phone = null;

  // Check mailto links
  const mailtoMatch = html.match(mailtoPattern);
  if (mailtoMatch && mailtoMatch.length > 0) {
    email = mailtoMatch[0].replace('mailto:', '').split('?')[0].trim();
  }

  // Check tel links
  const telMatch = html.match(telPattern);
  if (telMatch && telMatch.length > 0) {
    phone = telMatch[0].replace('tel:', '').trim();
  }

  // Remove HTML tags for text extraction
  const textOnly = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
    .replace(/<[^>]+>/g, ' ') // Remove HTML tags
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  // Extract from text if not found in links
  if (!email) {
    email = extractEmail(textOnly);
  }

  if (!phone) {
    phone = extractPhoneNumber(textOnly);
  }

  const openingHours = extractOpeningHours(textOnly);

  return { phone, email, openingHours };
}

/**
 * Find clinic website using Google search
 * @param {string} clinicName - Name of the clinic
 * @param {string} location - Location (e.g., "Queens, New York, US")
 * @returns {Promise<string|null>} - Clinic website URL or null
 */
async function findClinicWebsite(clinicName, location) {
  if (!clinicName) return null;

  try {
    const serpKey = process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY;
    let apiUrl = process.env.JOB_SEARCH_API_URL;
    let apiKey = process.env.JOB_SEARCH_API_KEY;

    if (serpKey) {
      apiUrl = 'https://serpapi.com/search.json';
      apiKey = serpKey;
    } else if (!apiUrl || !apiKey || !apiUrl.includes('serpapi.com')) {
      return null;
    }

    // Build search query: "ClinicName location" + "official website"
    const searchQuery = `"${clinicName}" ${location || ''} official website contact`;

    const response = await axios.get(apiUrl, {
      params: {
        api_key: apiKey,
        q: searchQuery,
        engine: 'google',
        num: 5 // Get top 5 results
      },
      timeout: 10000
    });

    const results = response.data?.organic_results || [];

    // Find the first result that looks like the clinic's website
    // (not a job board, not LinkedIn, not Indeed, etc.)
    const excludeDomains = JOB_BOARD_DOMAINS;

    for (const result of results) {
      const link = result.link || result.url || '';
      const title = (result.title || '').toLowerCase();
      const snippet = (result.snippet || '').toLowerCase();

      // Skip job boards
      if (excludeDomains.some(domain => link.includes(domain))) {
        continue;
      }

      // Prefer results that mention the clinic name and have "contact" or "phone"
      if (title.includes(clinicName.toLowerCase()) || snippet.includes(clinicName.toLowerCase())) {
        return link;
      }

      // If it's a .com/.org/.net and not a job board, use it
      if (link.match(/\.(com|org|net|edu|gov)/) && !excludeDomains.some(d => link.includes(d))) {
        return link;
      }
    }

    // Fallback: return first non-job-board result
    for (const result of results) {
      const link = result.link || result.url || '';
      if (!excludeDomains.some(domain => link.includes(domain))) {
        return link;
      }
    }

    return null;
  } catch (error) {
    console.warn('⚠️  Failed to find clinic website:', error.message);
    return null;
  }
}

/**
 * Extract contact info from a URL
 * 
 * @param {string} url - Job posting URL or clinic website URL
 * @param {string} clinicName - Optional clinic name for website search fallback
 * @param {string} location - Optional location for website search fallback
 * @returns {Promise<{phone: string|null, email: string|null, openingHours: string|null}>}
 */
async function extractContactInfo(url, clinicName = null, location = null) {
  const jobPostingUrl = url && isJobBoardUrl(url) ? url : null;
  let website_url = url && !isJobBoardUrl(url) ? url : null;

  if (!url) {
    if (clinicName) {
      const website = await findClinicWebsite(clinicName, location);
      if (website) {
        website_url = website;
        return { ...(await extractContactInfo(website)), website_url: website, job_posting_url: null };
      }
    }
    return { phone: null, email: null, openingHours: null, website_url: null, job_posting_url: null };
  }

  const isJobBoard = isJobBoardUrl(url);

  if (isJobBoard && clinicName) {
    console.log(`🔍 Job board URL detected, searching for ${clinicName} website...`);

    let website = await findClinicWebsite(clinicName, location);

    if (!website && clinicName) {
      const cleanName = clinicName
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '')
        .replace(/llc|inc|pc|pllc/g, '');

      const commonDomains = ['.com', '.org', '.net'];
      for (const domain of commonDomains) {
        const testUrl = `https://${cleanName}${domain}`;
        try {
          const testResponse = await axios.get(testUrl, {
            timeout: 3000,
            validateStatus: (status) => status < 500,
          });
          if (testResponse.status === 200) {
            website = testUrl;
            console.log(`✅ Found clinic website via pattern: ${website}`);
            break;
          }
        } catch {
          // continue
        }
      }
    }

    if (website) {
      console.log(`✅ Using clinic website: ${website}`);
      url = website;
      website_url = website;
    } else {
      console.log(`⚠️  No clinic website for ${clinicName} — skipping job board scrape`);
      return {
        phone: null,
        email: null,
        openingHours: null,
        website_url: null,
        job_posting_url: jobPostingUrl,
        error: 'job_board_only',
      };
    }
  } else if (!isJobBoard) {
    website_url = url;
  }

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      maxRedirects: 5,
    });

    const html = response.data;
    const htmlString = typeof html === 'string' ? html : JSON.stringify(html);
    const parsed = extractFromHTML(htmlString);
    return {
      ...parsed,
      website_url: website_url || url,
      job_posting_url: jobPostingUrl,
    };
  } catch (error) {
    console.error('❌ Contact extraction error:', error.message);

    if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      return {
        phone: null,
        email: null,
        openingHours: null,
        website_url: website_url || null,
        job_posting_url: jobPostingUrl,
        error: 'Network error',
      };
    }

    return {
      phone: null,
      email: null,
      openingHours: null,
      website_url: website_url || null,
      job_posting_url: jobPostingUrl,
      error: error.message,
    };
  }
}

/**
 * Extract contact info from multiple URLs (batch processing)
 */
async function extractContactInfoBatch(urls, delayMs = 1000) {
  const results = [];

  for (const url of urls) {
    const result = await extractContactInfo(url);
    results.push({ url, ...result });

    // Rate limiting - wait between requests
    if (delayMs > 0 && urls.indexOf(url) < urls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

module.exports = {
  extractContactInfo,
  extractContactInfoBatch,
  extractPhoneNumber,
  extractEmail,
  extractOpeningHours,
  isJobBoardUrl,
  JOB_BOARD_DOMAINS,
};

