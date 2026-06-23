/**
 * Job Scraper Service
 *
 * Purpose:
 * - Provide a single `searchJobs` function the rest of the system can call.
 * - Hide the details of the external search provider (e.g. SerpAPI).
 * - Return a normalized job format suitable for the admin UI + call workflows.
 *
 * NOTE:
 * - This service is intentionally provider-agnostic. Configure the provider
 *   via environment variables so we can change vendors without code changes.
 */

const axios = require('axios');

/**
 * Normalize raw provider job data into our internal shape.
 *
 * Internal Job Shape:
 * {
 *   external_id: string,
 *   title: string,
 *   clinic_name: string,
 *   clinic_phone: string | null,
 *   clinic_email: string | null,
 *   location: string | null,
 *   source_url: string | null,
 *   pay_rate: string | null,
 *   charge_rate: string | null,
 *   posted_at: string | null,
 *   source: string
 * }
 */
function normalizeJobsFromProvider(rawJobs = [], source = 'unknown') {
  return rawJobs.map((job, index) => {
    const isGoogleJobs = source === 'google_jobs';
    const isJSearch = source === 'jsearch';

    // When using JSearch API
    if (isJSearch) {
      const title = job.job_title || 'Medical Receptionist';
      const clinicName = job.employer_name || 'Unknown Clinic';

      // Build location string from JSearch fields
      let location = null;
      if (job.job_city && job.job_state) {
        location = `${job.job_city}, ${job.job_state}`;
        if (job.job_country) {
          location += `, ${job.job_country}`;
        }
      } else if (job.job_location) {
        location = job.job_location;
      } else if (job.job_country) {
        location = job.job_country;
      }

      // Format salary if available
      let payRate = null;
      if (job.job_salary) {
        payRate = job.job_salary;
      } else if (job.job_min_salary && job.job_max_salary) {
        payRate = `$${job.job_min_salary.toLocaleString()}-${job.job_max_salary.toLocaleString()}`;
        if (job.job_salary_period) {
          payRate += `/${job.job_salary_period.toLowerCase()}`;
        }
      } else if (job.job_min_salary) {
        payRate = `$${job.job_min_salary.toLocaleString()}+`;
        if (job.job_salary_period) {
          payRate += `/${job.job_salary_period.toLowerCase()}`;
        }
      }

      // Format posted date
      let postedAt = null;
      if (job.job_posted_at_timestamp) {
        postedAt = new Date(job.job_posted_at_timestamp * 1000).toISOString();
      } else if (job.job_posted_at_datetime_utc) {
        postedAt = job.job_posted_at_datetime_utc;
      } else if (job.job_posted_human_readable) {
        // Keep human-readable as fallback
        postedAt = job.job_posted_human_readable;
      }

      const sourceUrl = job.job_apply_link || job.job_google_link || job.job_link || null;

      return {
        external_id: job.job_id || `jsearch_${index}`,
        title,
        clinic_name: clinicName,
        clinic_phone: null, // JSearch doesn't provide phone directly
        clinic_email: null, // JSearch doesn't provide email directly
        location,
        source_url: sourceUrl,
        pay_rate: payRate,
        charge_rate: null,
        posted_at: postedAt,
        source,
        description: job.job_description || null
      };
    }

    // When using Google Jobs, treat this as a true job posting
    if (isGoogleJobs) {
      const title =
        job.title ||
        job.position ||
        job.job_title ||
        job.detected_extensions?.job_title ||
        'Medical Receptionist';

      const clinicName =
        job.company_name ||
        job.employer ||
        job.hiring_organization ||
        job.clinic_name ||
        'Unknown Clinic';

      const location =
        job.location ||
        job.city ||
        job.region ||
        job.country ||
        job.detected_extensions?.location ||
        null;

      const payRate = job.salary || job.pay_rate || job.salary_text || null;
      const postedAt =
        job.detected_extensions?.posted_at ||
        job.date_posted ||
        job.posted_at ||
        null;

      const sourceUrl =
        job.apply_link ||
        job.link ||
        job.job_link ||
        job.url ||
        null;

      return {
        external_id: job.job_id || job.job_id_raw || job.id || `job_${index}`,
        title,
        clinic_name: clinicName,
        clinic_phone: null,
        clinic_email: null,
        location,
        source_url: sourceUrl,
        pay_rate: payRate,
        charge_rate: null,
        posted_at: postedAt,
        source
      };
    }

    // Default path: clinic / business search (Google Search / Maps / Places)
    const title = job.title || job.name || job.business_name || 'Medical Clinic';

    const clinicName =
      job.business_name ||
      job.company_name ||
      job.employer ||
      job.hiring_organization ||
      job.clinic_name ||
      title ||
      'Unknown Clinic';

    const location =
      job.address ||
      job.location ||
      job.job_location ||
      job.city ||
      job.region ||
      job.country ||
      job.snippet?.match(/([A-Z][a-z]+,\s*[A-Z]{2})/)?.[0] || // Extract "City, ST" from snippet
      null;

    const phone =
      job.phone ||
      job.phone_number ||
      job.contact_phone ||
      job.local_phone ||
      null;

    const email =
      job.email ||
      job.contact_email ||
      job.company_email ||
      null;

    const sourceUrl =
      job.website ||
      job.link ||
      job.url ||
      job.apply_link ||
      job.job_link ||
      null;

    const payRate = job.pay_rate || job.salary || job.salary_text || null;
    const postedAt = job.posted_at || job.date_posted || job.detected_extensions?.posted_at || null;

    return {
      external_id: job.place_id || job.id || job.job_id || job.job_id_raw || `clinic_${index}`,
      title: clinicName,
      clinic_name: clinicName,
      clinic_phone: phone,
      clinic_email: email,
      location,
      source_url: sourceUrl,
      pay_rate: payRate,
      charge_rate: null,
      posted_at: postedAt,
      source
    };
  });
}

/**
 * Convert location format from "US,NY" to SerpAPI format "New York, NY, United States"
 * Handles common US state abbreviations
 */
function normalizeLocationForProvider(location) {
  // If already in full format, return as-is
  if (location.includes(',') && location.includes('United States')) {
    return location;
  }

  // Handle "US,NY" or "US,STATE" format
  const usStateMap = {
    'NY': 'New York',
    'CA': 'California',
    'TX': 'Texas',
    'FL': 'Florida',
    'IL': 'Illinois',
    'PA': 'Pennsylvania',
    'OH': 'Ohio',
    'GA': 'Georgia',
    'NC': 'North Carolina',
    'MI': 'Michigan',
    'NJ': 'New Jersey',
    'VA': 'Virginia',
    'WA': 'Washington',
    'AZ': 'Arizona',
    'MA': 'Massachusetts',
    'TN': 'Tennessee',
    'IN': 'Indiana',
    'MO': 'Missouri',
    'MD': 'Maryland',
    'WI': 'Wisconsin',
    'CO': 'Colorado',
    'MN': 'Minnesota',
    'SC': 'South Carolina',
    'AL': 'Alabama',
    'LA': 'Louisiana',
    'KY': 'Kentucky',
    'OR': 'Oregon',
    'OK': 'Oklahoma',
    'CT': 'Connecticut',
    'UT': 'Utah',
    'IA': 'Iowa',
    'NV': 'Nevada',
    'AR': 'Arkansas',
    'MS': 'Mississippi',
    'KS': 'Kansas',
    'NM': 'New Mexico',
    'NE': 'Nebraska',
    'WV': 'West Virginia',
    'ID': 'Idaho',
    'HI': 'Hawaii',
    'NH': 'New Hampshire',
    'ME': 'Maine',
    'MT': 'Montana',
    'RI': 'Rhode Island',
    'DE': 'Delaware',
    'SD': 'South Dakota',
    'ND': 'North Dakota',
    'AK': 'Alaska',
    'DC': 'District of Columbia',
    'VT': 'Vermont',
    'WY': 'Wyoming'
  };

  // Try to parse "US,STATE" format
  const parts = location.split(',').map(p => p.trim());
  if (parts.length === 2 && parts[0].toUpperCase() === 'US' && parts[1].length === 2) {
    const stateAbbr = parts[1].toUpperCase();
    const stateName = usStateMap[stateAbbr];
    if (stateName) {
      return `${stateName}, ${stateAbbr}, United States`;
    }
  }

  // If we can't convert, return as-is and let the provider handle it
  return location;
}

/**
 * Search for jobs using the configured provider.
 *
 * @param {Object} params
 * @param {string} params.query - Search query, e.g. "medical billing jobs"
 * @param {string} params.location - Location string, e.g. "US,NY" (will be converted to "New York, NY, United States")
 * @param {number} params.postedSinceDays - How many days back to look (default: 1)
 * @param {string} params.engine - Explicit engine override (e.g., 'jsearch', 'google_jobs', 'google')
 *
 * Environment variables:
 * - JOB_SEARCH_API_URL  (e.g. https://jsearch.p.rapidapi.com/search or https://serpapi.com/search.json)
 * - JOB_SEARCH_API_KEY  (provider API key)
 * - JOB_SEARCH_ENGINE   (default engine: 'google', 'google_jobs', 'jsearch')
 *
 * This implementation supports multiple providers:
 * - JSearch (RapidAPI): Uses x-rapidapi-key header
 * - SerpAPI: Uses api_key query param
 */
async function searchJobs({
  query = 'medical billing jobs',
  location = 'US,NY',
  postedSinceDays = 1,
  engine
} = {}) {
  const apiUrl = process.env.JOB_SEARCH_API_URL;
  const apiKey = process.env.JOB_SEARCH_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error(
      'Job search provider not configured. Please set JOB_SEARCH_API_URL and JOB_SEARCH_API_KEY.'
    );
  }

  // Use explicit engine override when provided (e.g., jsearch, google_jobs)
  // Otherwise fall back to JOB_SEARCH_ENGINE env or plain Google search.
  const searchEngine = engine || process.env.JOB_SEARCH_ENGINE || 'google';

  // Detect if we're using JSearch (RapidAPI)
  const isJSearch = searchEngine === 'jsearch' || apiUrl.includes('rapidapi.com');

  let response;
  let rawJobs = [];

  if (isJSearch) {
    // JSearch API (RapidAPI) configuration
    // Extract host from URL (e.g., jsearch.p.rapidapi.com)
    const urlObj = new URL(apiUrl);
    const rapidApiHost = urlObj.hostname;

    // Map location format for JSearch (e.g., "US" -> all US, "US,NY" -> NY state)
    let country = 'us';
    let state = null;
    const locationParts = location.split(',').map(p => p.trim());

    if (locationParts[0].toUpperCase() === 'US') {
      country = 'us';
      // If just "US" or "US," with no state, search all US
      if (locationParts.length >= 2 && locationParts[1].length === 2) {
        state = locationParts[1].toLowerCase();
      }
      // If location is just "US", state stays null (search all US)
    }

    // Map postedSinceDays to JSearch date_posted filter
    let datePosted = 'all';
    if (postedSinceDays <= 1) {
      datePosted = 'today';
    } else if (postedSinceDays <= 3) {
      datePosted = '3days';
    } else if (postedSinceDays <= 7) {
      datePosted = 'week';
    } else if (postedSinceDays <= 30) {
      datePosted = 'month';
    }

    const params = {
      query,
      page: 1,
      num_pages: 1,
      country,
      date_posted: datePosted,
      language: 'en'
    };

    // Add state to query if we extracted it (for state-specific search)
    // If no state, JSearch will search all US
    if (state) {
      params.query = `${query} in ${state.toUpperCase()}`;
    }

    try {
      response = await axios.get(apiUrl, {
        params,
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': rapidApiHost
        }
      });

      // JSearch returns data in response.data.data array
      rawJobs = response.data?.data || [];
    } catch (error) {
      const status = error.response?.status;
      const providerMessage = error.response?.data?.error || error.response?.data?.message || error.message;

      console.error('❌ JSearch API error:', {
        status,
        message: providerMessage,
        url: apiUrl
      });

      throw new Error(
        `JSearch API request failed${status ? ` (status ${status})` : ''}: ${providerMessage}`
      );
    }
  } else {
    // SerpAPI (Google search) configuration
    const normalizedLocation = normalizeLocationForProvider(location);

    // Map postedSinceDays to a provider-friendly filter.
    let datePosted = 'all';
    if (postedSinceDays <= 1) {
      datePosted = 'today';
    } else if (postedSinceDays <= 3) {
      datePosted = '3days';
    } else if (postedSinceDays <= 7) {
      datePosted = 'week';
    }

    const params = {
      api_key: apiKey,
      q: query,
      location: normalizedLocation,
      engine: searchEngine,
      // For regular Google search, we don't need date_posted
      ...(searchEngine === 'google_jobs' ? { date_posted: datePosted } : {})
    };

    try {
      response = await axios.get(apiUrl, { params });

      // For different engines, results are in different places
      // Google search: organic_results
      // Google Jobs: jobs_results
      // Google Maps/Places: places_results or local_results
      rawJobs =
        response.data?.organic_results ||  // Google search results
        response.data?.local_results ||    // Google Maps results
        response.data?.places_results ||   // Google Places results
        response.data?.jobs_results ||      // Google Jobs (fallback)
        response.data?.jobs ||
        response.data?.results ||
        [];
    } catch (error) {
      const status = error.response?.status;
      const providerMessage = error.response?.data?.error || error.message;

      console.error('❌ SerpAPI error:', {
        status,
        message: providerMessage
      });

      throw new Error(
        `SerpAPI request failed${status ? ` (status ${status})` : ''}: ${providerMessage}`
      );
    }
  }

  return normalizeJobsFromProvider(rawJobs, searchEngine);
}

module.exports = {
  searchJobs
};



