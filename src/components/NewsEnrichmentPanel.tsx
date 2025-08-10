import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Button,
  CircularProgress,
  Alert,
  Grid,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  OpenInNew as OpenInNewIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Business as BusinessIcon,
  Gavel as GavelIcon,
  Handshake as HandshakeIcon,
  Work as WorkIcon,
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../firebase';

interface NewsArticle {
  id: string;
  title: string;
  url: string;
  summary: string;
  tags: string[];
  date: string;
  source: string | { name: string; icon?: string; authors?: string[] };
  relevance: number;
}

interface NewsEnrichmentPanelProps {
  companyName: string;
  companyId: string;
  tenantId: string;
  headquartersCity?: string;
  industry?: string;
}

const NewsEnrichmentPanel: React.FC<NewsEnrichmentPanelProps> = ({
  companyName,
  companyId,
  tenantId,
  headquartersCity,
  industry,
}) => {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchNewsArticles = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    
    try {
      const fetchNews = httpsCallable(functions, 'fetchCompanyNews');
      const result = await fetchNews({
        companyName,
        companyId: forceRefresh ? `${companyId}-${Date.now()}` : companyId, // Force cache bypass
        tenantId,
        headquartersCity,
        industry,
      });
      
      const data = result.data as { articles: NewsArticle[] };
      setArticles(data.articles || []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching news articles:', err);
      setError('Failed to fetch news articles. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (companyName) {
      fetchNewsArticles();
    }
  }, [companyName, companyId, tenantId]);

  const getTagIcon = (tag: string) => {
    const tagLower = tag.toLowerCase();
    if (tagLower.includes('expansion') || tagLower.includes('growth') || tagLower.includes('hiring')) {
      return <TrendingUpIcon fontSize="small" />;
    }
    if (tagLower.includes('layoff') || tagLower.includes('downsizing') || tagLower.includes('closure')) {
      return <TrendingDownIcon fontSize="small" />;
    }
    if (tagLower.includes('legal') || tagLower.includes('lawsuit') || tagLower.includes('regulation')) {
      return <GavelIcon fontSize="small" />;
    }
    if (tagLower.includes('partnership') || tagLower.includes('acquisition') || tagLower.includes('merger')) {
      return <HandshakeIcon fontSize="small" />;
    }
    if (tagLower.includes('staffing') || tagLower.includes('workforce') || tagLower.includes('employment')) {
      return <WorkIcon fontSize="small" />;
    }
    return <BusinessIcon fontSize="small" />;
  };

  const getTagColor = (tag: string) => {
    const tagLower = tag.toLowerCase();
    if (tagLower.includes('expansion') || tagLower.includes('growth') || tagLower.includes('hiring')) {
      return 'success';
    }
    if (tagLower.includes('layoff') || tagLower.includes('downsizing') || tagLower.includes('closure')) {
      return 'error';
    }
    if (tagLower.includes('legal') || tagLower.includes('lawsuit') || tagLower.includes('regulation')) {
      return 'warning';
    }
    if (tagLower.includes('partnership') || tagLower.includes('acquisition') || tagLower.includes('merger')) {
      return 'info';
    }
    return 'default';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return 'Today';
    if (diffDays === 2) return 'Yesterday';
    if (diffDays <= 7) return `${diffDays - 1} days ago`;
    return date.toLocaleDateString();
  };

  const handleRefresh = () => {
    fetchNewsArticles(true); // Force refresh to bypass cache
  };

  const handleOpenArticle = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Helper function to safely get source name
  const getSourceName = (source: string | { name: string; icon?: string; authors?: string[] }) => {
    if (typeof source === 'string') {
      return source;
    }
    return source?.name || 'Unknown Source';
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          📰 In the News
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {lastUpdated && (
            <Typography variant="caption" color="text.secondary">
              Last updated: {formatDate(lastUpdated.toISOString())}
            </Typography>
          )}
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={handleRefresh}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!loading && !error && articles.length === 0 && (
        <Alert severity="info">
          No recent news articles found for {companyName}. Try refreshing or check back later.
        </Alert>
      )}

      {!loading && !error && articles.length > 0 && (
        <Grid container spacing={2}>
          {articles.map((article) => (
            <Grid item xs={12} key={article.id}>
              <Card sx={{ 
                border: 'none',
                boxShadow: 'none',
                borderBottom: '1px solid',
                borderBottomColor: 'divider',
                paddingBottom: '16px',
              }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography 
                      variant="h6" 
                      component="h3"
                      sx={{ 
                        fontWeight: 600,
                        fontSize: '1rem',
                        lineHeight: 1.3,
                        mb: 1,
                        cursor: 'pointer',
                        '&:hover': {
                          color: 'primary.main',
                        },
                      }}
                      onClick={() => handleOpenArticle(article.url)}
                    >
                      {article.title}
                    </Typography>
                    <Tooltip title="Open article">
                      <IconButton 
                        size="small" 
                        onClick={() => handleOpenArticle(article.url)}
                        sx={{ ml: 1 }}
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  
                  <Typography 
                    variant="body2" 
                    color="text.secondary" 
                    sx={{ mb: 2, lineHeight: 1.5 }}
                  >
                    {article.summary}
                  </Typography>
                  
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {article.tags.map((tag) => (
                        <Chip
                          key={tag}
                          label={tag}
                          size="small"
                          icon={getTagIcon(tag)}
                          color={getTagColor(tag) as any}
                          variant="outlined"
                          sx={{ fontSize: '0.75rem' }}
                        />
                      ))}
                    </Box>
                    
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        {getSourceName(article.source)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        • {formatDate(article.date)}
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
};

export default NewsEnrichmentPanel; 