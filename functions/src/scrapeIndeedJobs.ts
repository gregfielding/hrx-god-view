import { onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';

// Define config parameters
const serpApiKey = defineString('SERP_API_KEY');
const gnewsApiKey = defineString('GNEWS_API_KEY');

export const scrapeIndeedJobs = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  try {
    const { companyName, indeedUrl } = request.data;

    if (!companyName) {
      throw new Error('Missing required parameter: companyName');
    }

    console.log(`Scraping Indeed jobs for: ${companyName}`);
    console.log(`Indeed URL: ${indeedUrl}`);

    // Strategy 1: Try to scrape from the actual Indeed URL if available
    if (indeedUrl && indeedUrl.includes('indeed.com/cmp/')) {
      try {
        const jobs = await scrapeFromIndeedUrl(indeedUrl, companyName);
        if (jobs && jobs.length > 0) {
          console.log(`Successfully scraped ${jobs.length} jobs from Indeed URL`);
          return {
            jobs,
            source: 'indeed-url',
            message: `Found ${jobs.length} jobs from Indeed profile`
          };
        }
      } catch (scrapeError) {
        console.error('Error scraping from Indeed URL:', scrapeError);
      }
    }

    // Strategy 2: Use SerpAPI for Google Jobs search (if API key available)
    try {
      const serpJobs = await scrapeWithSerpAPI(companyName);
      if (serpJobs && serpJobs.length > 0) {
        console.log(`Successfully scraped ${serpJobs.length} jobs via SerpAPI Google Jobs`);
        return {
          jobs: serpJobs,
          source: 'google-jobs',
          message: `Found ${serpJobs.length} jobs via Google Jobs search`
        };
      }
    } catch (serpError) {
      console.error('Error with SerpAPI Google Jobs:', serpError);
    }

    // Strategy 2.5: Use SerpAPI for Indeed search as backup
    try {
      const indeedJobs = await scrapeIndeedWithSerpAPI(companyName);
      if (indeedJobs && indeedJobs.length > 0) {
        console.log(`Successfully scraped ${indeedJobs.length} jobs via SerpAPI Indeed`);
        return {
          jobs: indeedJobs,
          source: 'indeed-serp',
          message: `Found ${indeedJobs.length} jobs via Indeed search`
        };
      }
    } catch (indeedSerpError) {
      console.error('Error with SerpAPI Indeed:', indeedSerpError);
    }

    // Strategy 3: Use GNews API for job-related news (fallback)
    try {
      const gnewsJobs = await scrapeWithGNews(companyName);
      if (gnewsJobs && gnewsJobs.length > 0) {
        console.log(`Successfully scraped ${gnewsJobs.length} jobs via GNews`);
        return {
          jobs: gnewsJobs,
          source: 'gnews',
          message: `Found ${gnewsJobs.length} jobs via news search`
        };
      }
    } catch (gnewsError) {
      console.error('Error with GNews:', gnewsError);
    }

    // Strategy 4: Web scraping fallback (if allowed)
    try {
      const scrapedJobs = await scrapeJobsFromWeb(companyName, indeedUrl);
      if (scrapedJobs && scrapedJobs.length > 0) {
        console.log(`Successfully scraped ${scrapedJobs.length} jobs via web scraping`);
        return {
          jobs: scrapedJobs,
          source: 'web-scraping',
          message: `Found ${scrapedJobs.length} jobs via web scraping`
        };
      }
    } catch (webError) {
      console.error('Error with web scraping:', webError);
    }

    // If all strategies fail, return empty results
    console.log('All scraping strategies failed, returning empty results');
    return {
      jobs: [],
      source: 'none',
      message: 'No jobs found from any source'
    };

  } catch (error) {
    console.error('Error in scrapeIndeedJobs:', error);
    throw new Error('Failed to scrape Indeed jobs');
  }
});

// Scrape jobs from a specific Indeed company URL
const scrapeFromIndeedUrl = async (indeedUrl: string, companyName: string): Promise<any[]> => {
  try {
    console.log(`Attempting to scrape from: ${indeedUrl}`);
    
    // In a production environment, you would use:
    // 1. Puppeteer for browser automation
    // 2. Cheerio for HTML parsing
    // 3. Proper rate limiting and user agents
    // 4. Respect for robots.txt and terms of service
    
    // For now, we'll use a headless browser approach
    const jobs = await scrapeWithPuppeteer(indeedUrl, companyName);
    return jobs;
  } catch (error) {
    console.error('Error scraping from Indeed URL:', error);
    throw error;
  }
};

// Use SerpAPI to search Google Jobs
const scrapeWithSerpAPI = async (companyName: string): Promise<any[]> => {
  const apiKey = serpApiKey.value();
  
  if (!apiKey || apiKey === 'YOUR_SERP_API_KEY') {
    console.log('SerpAPI key not configured');
    return [];
  }

  try {
    const searchQuery = `${companyName} jobs hiring`;
    const url = `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(searchQuery)}&api_key=${apiKey}`;
    
    console.log('Searching Google Jobs via SerpAPI:', searchQuery);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`SerpAPI error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.jobs_results || data.jobs_results.length === 0) {
      return [];
    }

    const jobs = data.jobs_results.map((job: any, index: number) => ({
      id: `google-${index}`,
      title: job.title || 'Unknown Position',
      location: job.location || 'Various Locations',
      company: job.company_name || companyName,
      description: job.description || job.snippet || 'No description available',
      postedDate: job.detected_extensions?.posted_time || new Date().toISOString(),
      salary: job.detected_extensions?.salary || 'Competitive',
      jobType: job.detected_extensions?.schedule_type || 'Full-time',
      url: job.related_links?.[0]?.link || job.job_highlights?.[0]?.items?.[0] || '#',
      keywords: extractKeywords(job.title + ' ' + job.description),
      urgency: determineUrgency(job.detected_extensions?.posted_time),
      source: 'Google Jobs'
    }));

    return jobs;
  } catch (error) {
    console.error('Error with SerpAPI Google Jobs:', error);
    return [];
  }
};

const scrapeIndeedWithSerpAPI = async (companyName: string): Promise<any[]> => {
  const apiKey = serpApiKey.value();
  
  if (!apiKey || apiKey === 'YOUR_SERP_API_KEY') {
    console.log('SerpAPI key not configured');
    return [];
  }

  try {
    const searchQuery = `site:indeed.com "${companyName}" jobs`;
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${apiKey}`;
    
    console.log('Searching Indeed via SerpAPI:', searchQuery);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`SerpAPI Indeed error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.organic_results || data.organic_results.length === 0) {
      return [];
    }

    // Filter for Indeed job listings
    const indeedResults = data.organic_results.filter((result: any) => 
      result.link && result.link.includes('indeed.com/jobs')
    );

    const jobs = indeedResults.map((result: any, index: number) => ({
      id: `indeed-serp-${index}`,
      title: extractJobTitle(result.title, companyName),
      location: extractLocation(result.snippet),
      company: companyName,
      description: result.snippet || 'No description available',
      postedDate: new Date().toISOString(),
      salary: 'Competitive',
      jobType: 'Full-time',
      url: result.link,
      keywords: extractKeywords(result.title + ' ' + result.snippet),
      urgency: determineUrgency(),
      source: 'Indeed'
    }));

    return jobs;
  } catch (error) {
    console.error('Error with SerpAPI Indeed:', error);
    return [];
  }
};

// Use GNews API for job-related news
const scrapeWithGNews = async (companyName: string): Promise<any[]> => {
  const apiKey = gnewsApiKey.value();
  
  if (!apiKey || apiKey === 'YOUR_GNEWS_API_KEY') {
    console.log('GNews API key not configured');
    return [];
  }

  try {
    const searchQuery = `${companyName} hiring jobs careers employment`;
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(searchQuery)}&lang=en&country=us&max=10&apikey=${apiKey}`;
    
    console.log('Searching GNews for job-related articles:', searchQuery);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`GNews API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.articles || data.articles.length === 0) {
      return [];
    }

    // Filter articles that are likely about job postings
    const jobArticles = data.articles.filter((article: any) => {
      const title = article.title.toLowerCase();
      const content = (article.content || article.description || '').toLowerCase();
      
      return title.includes('hiring') || title.includes('job') || title.includes('career') ||
             content.includes('hiring') || content.includes('job') || content.includes('career') ||
             content.includes('position') || content.includes('opportunity');
    });

    const jobs = jobArticles.map((article: any, index: number) => ({
      id: `gnews-${index}`,
      title: extractJobTitle(article.title, companyName),
      location: extractLocation(article.content || article.description),
      company: companyName,
      description: article.description || article.content?.substring(0, 200) + '...',
      postedDate: article.publishedAt,
      salary: 'Competitive',
      jobType: 'Full-time',
      url: article.url,
      keywords: extractKeywords(article.title + ' ' + article.description),
      urgency: determineUrgency(article.publishedAt),
      source: 'GNews Job Articles'
    }));

    return jobs;
  } catch (error) {
    console.error('Error with GNews:', error);
    return [];
  }
};

// Web scraping with Puppeteer
const scrapeWithPuppeteer = async (url: string, companyName: string): Promise<any[]> => {
  let browser;
  try {
    console.log(`Starting Puppeteer scraping from: ${url}`);
    
    // Launch browser
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Navigate to the URL
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for job listings to load
    await page.waitForSelector('[data-testid="job-card"], .job_seen_beacon, .jobsearch-ResultsList', { timeout: 10000 })
      .catch(() => console.log('Job listings selector not found, continuing...'));
    
    // Extract job data
    const jobs = await page.evaluate((companyName: string) => {
      const jobElements = document.querySelectorAll('[data-testid="job-card"], .job_seen_beacon, .jobsearch-ResultsList > div');
      const jobs: any[] = [];
      
      jobElements.forEach((element, index) => {
        try {
          // Extract job title
          const titleElement = element.querySelector('[data-testid="job-card-title"], h2, .jobTitle');
          const title = titleElement?.textContent?.trim() || 'Unknown Position';
          
          // Extract company name
          const companyElement = element.querySelector('[data-testid="job-card-company"], .companyName');
          const company = companyElement?.textContent?.trim() || companyName;
          
          // Extract location
          const locationElement = element.querySelector('[data-testid="job-card-location"], .companyLocation');
          const location = locationElement?.textContent?.trim() || 'Various Locations';
          
          // Extract job description/snippet
          const descriptionElement = element.querySelector('[data-testid="job-card-snippet"], .summary');
          const description = descriptionElement?.textContent?.trim() || 'No description available';
          
          // Extract job URL
          const linkElement = element.querySelector('a[href*="/viewjob"], a[href*="/job/"]') as HTMLAnchorElement;
          const jobUrl = linkElement?.href || '#';
          
          // Extract posted date
          const dateElement = element.querySelector('[data-testid="job-card-date"], .date');
          const postedDate = dateElement?.textContent?.trim() || new Date().toISOString();
          
          // Extract salary if available
          const salaryElement = element.querySelector('[data-testid="job-card-salary"], .salary-snippet');
          const salary = salaryElement?.textContent?.trim() || 'Competitive';
          
          if (title && title !== 'Unknown Position') {
            jobs.push({
              id: `puppeteer-${index}`,
              title,
              location,
              company,
              description,
              postedDate,
              salary,
              jobType: 'Full-time', // Default assumption
              url: jobUrl,
              keywords: extractKeywords(title + ' ' + description),
              urgency: determineUrgency(postedDate),
              source: 'Indeed Puppeteer Scraping'
            });
          }
        } catch (error) {
          console.error('Error parsing job element:', error);
        }
      });
      
      return jobs;
    }, companyName);
    
    console.log(`Puppeteer found ${jobs.length} jobs`);
    return jobs;
    
  } catch (error) {
    console.error('Error with Puppeteer scraping:', error);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

// Fallback web scraping method using Cheerio
const scrapeJobsFromWeb = async (companyName: string, indeedUrl?: string): Promise<any[]> => {
  try {
    if (indeedUrl) {
      console.log(`Attempting Cheerio web scraping from: ${indeedUrl}`);
      
      const response = await fetch(indeedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const html = await response.text();
      const $ = cheerio.load(html);
      
      const jobs: any[] = [];
      
      // Try different selectors for job listings
      const jobSelectors = [
        '[data-testid="job-card"]',
        '.job_seen_beacon',
        '.jobsearch-ResultsList > div',
        '.job_seen_beacon'
      ];
      
      for (const selector of jobSelectors) {
        const jobElements = $(selector);
        
        if (jobElements.length > 0) {
          jobElements.each((index, element) => {
            try {
              const $element = $(element);
              
              // Extract job title
              const title = $element.find('[data-testid="job-card-title"], h2, .jobTitle').first().text().trim() || 'Unknown Position';
              
              // Extract company name
              const company = $element.find('[data-testid="job-card-company"], .companyName').first().text().trim() || companyName;
              
              // Extract location
              const location = $element.find('[data-testid="job-card-location"], .companyLocation').first().text().trim() || 'Various Locations';
              
              // Extract job description/snippet
              const description = $element.find('[data-testid="job-card-snippet"], .summary').first().text().trim() || 'No description available';
              
              // Extract job URL
              const jobUrl = $element.find('a[href*="/viewjob"], a[href*="/job/"]').first().attr('href') || '#';
              
              // Extract posted date
              const postedDate = $element.find('[data-testid="job-card-date"], .date').first().text().trim() || new Date().toISOString();
              
              // Extract salary if available
              const salary = $element.find('[data-testid="job-card-salary"], .salary-snippet').first().text().trim() || 'Competitive';
              
              if (title && title !== 'Unknown Position') {
                jobs.push({
                  id: `cheerio-${index}`,
                  title,
                  location,
                  company,
                  description,
                  postedDate,
                  salary,
                  jobType: 'Full-time',
                  url: jobUrl.startsWith('http') ? jobUrl : `https://indeed.com${jobUrl}`,
                  keywords: extractKeywords(title + ' ' + description),
                  urgency: determineUrgency(postedDate),
                  source: 'Indeed Web Scraping'
                });
              }
            } catch (error) {
              console.error('Error parsing job element with Cheerio:', error);
            }
          });
          
          if (jobs.length > 0) {
            console.log(`Cheerio found ${jobs.length} jobs using selector: ${selector}`);
            break;
          }
        }
      }
      
      return jobs;
    }
    
    return [];
  } catch (error) {
    console.error('Error with Cheerio web scraping:', error);
    return [];
  }
};

// Helper function to extract job title from article title
const extractJobTitle = (title: string, companyName: string): string => {
  const companyLower = companyName.toLowerCase();
  
  // Remove company name from title
  let jobTitle = title.replace(new RegExp(companyLower, 'gi'), '').trim();
  
  // Clean up common prefixes/suffixes
  jobTitle = jobTitle.replace(/^(hiring|now hiring|careers|jobs|employment|opportunities?)\s*:?\s*/i, '');
  jobTitle = jobTitle.replace(/\s*(hiring|jobs|careers|employment|opportunities?)$/i, '');
  jobTitle = jobTitle.replace(/[-|]/, '').trim();
  
  // If we can't extract a meaningful title, use a generic one
  if (!jobTitle || jobTitle.length < 3) {
    return 'Open Position';
  }
  
  return jobTitle;
};

// Helper function to extract location from content
const extractLocation = (content: string): string => {
  if (!content) return 'Various Locations';
  
  // Look for common location patterns
  const locationPatterns = [
    /in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})/i,
    /at\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})/i
  ];
  
  for (const pattern of locationPatterns) {
    const match = content.match(pattern);
    if (match) {
      return `${match[1]}, ${match[2]}`;
    }
  }
  
  return 'Various Locations';
};

// Helper function to extract keywords from text
const extractKeywords = (text: string): string[] => {
  if (!text) return ['general'];
  
  const commonKeywords = [
    'hiring', 'job', 'career', 'position', 'opportunity', 'employment',
    'full-time', 'part-time', 'contract', 'temporary', 'permanent',
    'remote', 'onsite', 'hybrid', 'entry-level', 'senior', 'manager',
    'assistant', 'specialist', 'coordinator', 'supervisor', 'director'
  ];
  
  const textLower = text.toLowerCase();
  const foundKeywords = commonKeywords.filter(keyword => 
    textLower.includes(keyword.toLowerCase())
  );
  
  return foundKeywords.length > 0 ? foundKeywords : ['general'];
};

// Helper function to determine urgency based on posting date
const determineUrgency = (dateString?: string): string => {
  if (!dateString) return 'medium';
  
  const postedDate = new Date(dateString);
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - postedDate.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysDiff <= 1) return 'high';
  if (daysDiff <= 7) return 'medium';
  return 'low';
}; 