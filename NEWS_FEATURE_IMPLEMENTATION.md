# News Feature Implementation

## Overview

The News feature provides AI-powered news enrichment for company pages, automatically surfacing and summarizing recent news articles related to companies in the CRM system.

## Components

### 1. NewsEnrichmentPanel Component
**Location**: `src/components/NewsEnrichmentPanel.tsx`

A React component that displays news articles for a company with:
- AI-generated summaries and relevance tags
- Filtering of irrelevant content (job ads, stock news)
- Caching to reduce API calls
- Interactive UI with refresh functionality

### 2. Firebase Function
**Location**: `functions/src/fetchCompanyNews.ts`

A callable Firebase function that:
- Fetches news from GNews API
- Filters articles by relevance and recency
- Uses OpenAI for summarization and tagging
- Caches results for 6 hours
- Handles missing API keys gracefully

## Integration Points

### Company Details Page
**Location**: `src/pages/TenantViews/CompanyDetails.tsx`

Added a "News" tab (index 6) that displays the NewsEnrichmentPanel for CRM companies.

### Customer Profile Page
**Location**: `src/pages/CustomerProfile/index.tsx`

Added a "News" tab for customer companies (when user has appropriate permissions).

## API Dependencies

### Required Environment Variables
- `OPENAI_API_KEY`: For AI summarization and tagging
- `GNEWS_API_KEY`: For fetching news articles

### Optional Enhancement
- `SERPAPI_KEY`: Alternative news API (not implemented)

## Features

### News Filtering
- Articles must mention the company in headline or content
- Published within last 30 days
- Excludes job ads, stock/earnings news, and duplicates
- Relevance scoring based on company mentions and keywords

### AI Processing
- **Summarization**: 2-sentence summaries focused on staffing, expansion, legal changes
- **Tagging**: Automatic categorization (Expansion, Layoffs, Legal, Partnership, etc.)
- **Relevance Scoring**: Prioritizes articles by importance and recency

### Caching
- Results cached for 6 hours to reduce API costs
- Stored in Firestore: `/tenants/{tenantId}/crm_companies/{companyId}/newsArticles/latest`

### UI Features
- Responsive card layout
- Color-coded tags with icons
- Refresh button for manual updates
- Loading states and error handling
- External link opening

## Usage

### For CRM Companies
1. Navigate to a company in the CRM
2. Click the "News" tab
3. View recent news articles with AI summaries
4. Click refresh to fetch latest news

### For Customer Companies
1. Navigate to a customer profile
2. Click the "News" tab (requires appropriate permissions)
3. View company-specific news

## Configuration

### API Keys Setup
```bash
# Set environment variables in Firebase
firebase functions:config:set openai.api_key="your-openai-key"
firebase functions:config:set gnews.api_key="your-gnews-key"
```

### Customization
- Modify tag categories in `fetchCompanyNews.ts`
- Adjust caching duration (currently 6 hours)
- Change relevance scoring algorithm
- Add additional news sources

## Error Handling

The system gracefully handles:
- Missing API keys (returns empty results with error message)
- API rate limits
- Network failures
- Invalid company data

## Performance Considerations

- Caching reduces API calls by 90%+
- Parallel processing of articles
- Efficient Firestore queries
- Responsive UI with loading states

## Future Enhancements

1. **Additional News Sources**: SerpAPI, NewsAPI
2. **Notification System**: Alert on keywords like "expanding", "hiring", "layoffs"
3. **Sentiment Analysis**: Positive/negative news scoring
4. **Geographic Filtering**: Location-based news relevance
5. **Industry-Specific Sources**: Trade publications and industry news
6. **Competitor Monitoring**: Track competitor mentions
7. **News Analytics**: Trending topics and company activity scores

## Testing

To test the feature:
1. Ensure API keys are configured
2. Navigate to a company with recent news
3. Check the News tab displays articles
4. Verify refresh functionality works
5. Test error handling with invalid company names

## Troubleshooting

### No News Displayed
- Check API keys are configured
- Verify company name is searchable
- Check browser console for errors
- Ensure company has recent news coverage

### API Errors
- Verify API key validity
- Check rate limits
- Review Firebase function logs
- Ensure proper permissions

### Performance Issues
- Check caching is working
- Monitor API response times
- Review function execution logs
- Consider adjusting cache duration 