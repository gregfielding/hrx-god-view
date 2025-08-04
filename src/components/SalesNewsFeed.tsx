import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Typography,
  List,
  ListItem,
  ListItemText,
  Chip,
  IconButton,
  CircularProgress,
  Button,
  Divider,
  Avatar,
  Link,
  Alert,
  Badge
} from '@mui/material';
import {
  Newspaper as NewspaperIcon,
  OpenInNew as OpenInNewIcon,
  Refresh as RefreshIcon,
  Business as BusinessIcon,
  Star as StarIcon
} from '@mui/icons-material';
import { collection, query, where, getDocs, orderBy, limit, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface NewsArticle {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt: string;
  companyId: string;
  companyName: string;
}

interface FollowedCompany {
  id: string;
  companyName: string;
  followedAt: any;
}

const SalesNewsFeed: React.FC = () => {
  const { user } = useAuth();
  const [followedCompanies, setFollowedCompanies] = useState<FollowedCompany[]>([]);
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load followed companies
  useEffect(() => {
    if (!user?.uid) return;

    const loadFollowedCompanies = async () => {
      try {
        const followsRef = collection(db, 'users', user.uid, 'followedCompanies');
        const followsQuery = query(followsRef, orderBy('followedAt', 'desc'), limit(25));
        
        const unsubscribe = onSnapshot(followsQuery, (snapshot) => {
          const companies = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as FollowedCompany[];
          
          setFollowedCompanies(companies);
        }, (err) => {
          console.error('Error loading followed companies:', err);
          setError('Failed to load followed companies');
        });

        return unsubscribe;
      } catch (err) {
        console.error('Error loading followed companies:', err);
        setError('Failed to load followed companies');
      }
    };

    loadFollowedCompanies();
  }, [user?.uid]);

  // Load news articles for followed companies
  useEffect(() => {
    if (followedCompanies.length === 0) {
      setLoading(false);
      return;
    }

    const loadNewsArticles = async () => {
      try {
        setLoading(true);
        const today = new Date().toISOString().split('T')[0];
        const allArticles: NewsArticle[] = [];

        for (const company of followedCompanies) {
          try {
            const newsDoc = await getDocs(collection(db, 'companyNewsCache', company.id, today));
            if (!newsDoc.empty) {
              const newsData = newsDoc.docs[0].data();
              if (newsData.articles) {
                allArticles.push(...newsData.articles);
              }
            }
          } catch (err) {
            console.error(`Error loading news for ${company.companyName}:`, err);
          }
        }

        // Sort by published date (newest first) and remove duplicates
        const uniqueArticles = allArticles
          .filter((article, index, self) => 
            index === self.findIndex(a => a.url === article.url)
          )
          .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
          .slice(0, 20); // Limit to 20 most recent articles

        setNewsArticles(uniqueArticles);
      } catch (err) {
        console.error('Error loading news articles:', err);
        setError('Failed to load news articles');
      } finally {
        setLoading(false);
      }
    };

    loadNewsArticles();
  }, [followedCompanies]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Trigger a manual refresh by reloading the data
      const today = new Date().toISOString().split('T')[0];
      const allArticles: NewsArticle[] = [];

      for (const company of followedCompanies) {
        try {
          const newsDoc = await getDocs(collection(db, 'companyNewsCache', company.id, today));
          if (!newsDoc.empty) {
            const newsData = newsDoc.docs[0].data();
            if (newsData.articles) {
              allArticles.push(...newsData.articles);
            }
          }
        } catch (err) {
          console.error(`Error refreshing news for ${company.companyName}:`, err);
        }
      }

      const uniqueArticles = allArticles
        .filter((article, index, self) => 
          index === self.findIndex(a => a.url === article.url)
        )
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
        .slice(0, 20);

      setNewsArticles(uniqueArticles);
    } catch (err) {
      console.error('Error refreshing news:', err);
      setError('Failed to refresh news');
    } finally {
      setRefreshing(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 48) return 'Yesterday';
    return date.toLocaleDateString();
  };

  const getCompanyColor = (companyName: string) => {
    const colors = ['#1976d2', '#388e3c', '#f57c00', '#d32f2f', '#7b1fa2', '#303f9f', '#c2185b', '#5d4037'];
    const index = companyName.charCodeAt(0) % colors.length;
    return colors[index];
  };

  if (followedCompanies.length === 0) {
    return (
      <Card>
        <CardHeader
          title={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <NewspaperIcon />
              Sales News Feed
            </Box>
          }
        />
        <CardContent>
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <StarIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No Followed Companies
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Follow companies to see their latest news here
            </Typography>
            <Button variant="outlined" href="/crm?tab=companies">
              Browse Companies
            </Button>
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <NewspaperIcon />
            Sales News Feed
            <Badge badgeContent={newsArticles.length} color="primary" />
          </Box>
        }
        action={
          <IconButton onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? <CircularProgress size={20} /> : <RefreshIcon />}
          </IconButton>
        }
      />
      <CardContent sx={{ p: 0 }}>
        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}
        
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : newsArticles.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              No recent news from followed companies
            </Typography>
          </Box>
        ) : (
          <List sx={{ p: 0 }}>
            {newsArticles.map((article, index) => (
              <React.Fragment key={article.url}>
                <ListItem sx={{ px: 2, py: 1.5 }}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                        <Avatar
                          sx={{
                            width: 24,
                            height: 24,
                            fontSize: '0.75rem',
                            bgcolor: getCompanyColor(article.companyName)
                          }}
                        >
                          {article.companyName.charAt(0).toUpperCase()}
                        </Avatar>
                        <Box sx={{ flex: 1 }}>
                          <Link
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              textDecoration: 'none',
                              color: 'text.primary',
                              fontWeight: 500,
                              '&:hover': {
                                textDecoration: 'underline'
                              }
                            }}
                          >
                            {article.title}
                          </Link>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                            <Chip
                              label={article.companyName}
                              size="small"
                              variant="outlined"
                              sx={{ fontSize: '0.7rem' }}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {article.source} • {formatDate(article.publishedAt)}
                            </Typography>
                          </Box>
                        </Box>
                        <IconButton
                          size="small"
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    }
                    secondary={
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          lineHeight: 1.4
                        }}
                      >
                        {article.snippet}
                      </Typography>
                    }
                  />
                </ListItem>
                {index < newsArticles.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
};

export default SalesNewsFeed; 