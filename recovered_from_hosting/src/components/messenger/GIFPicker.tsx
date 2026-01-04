/**
 * GIF Picker Component
 * 
 * Modal for searching and selecting GIFs from GIPHY.
 * Shows trending GIFs and allows search.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  InputAdornment,
  Box,
  Grid,
  CircularProgress,
  Typography,
  IconButton,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';

interface GIFResult {
  id: string;
  url: string;
  stillUrl: string;
  width: number;
  height: number;
  title: string;
}

interface GIFPickerProps {
  open: boolean;
  onClose: () => void;
  onGIFSelect: (gif: { url: string; stillUrl: string; width: number; height: number; provider: 'giphy' }) => void;
}

// GIPHY API key - in production, this should be stored in Firebase config or environment variables
// For now, using public beta key (rate limited but works for development)
const GIPHY_API_KEY = 'Gc7131jiJgI4eZaS7XarhzC9Yy8K3xWz'; // Public beta key

const GIFPicker: React.FC<GIFPickerProps> = ({ open, onClose, onGIFSelect }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [searchQuery, setSearchQuery] = useState('');
  const [gifs, setGifs] = useState<GIFResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTrending, setShowTrending] = useState(true);

  // Fetch trending GIFs
  const fetchTrending = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=g`
      );
      const data = await response.json();

      if (data.meta?.status === 200 && data.data) {
        const gifResults: GIFResult[] = data.data.map((gif: any) => ({
          id: gif.id,
          url: gif.images.original.url,
          stillUrl: gif.images.original_still?.url || gif.images.fixed_height_still.url,
          width: parseInt(gif.images.original.width) || 400,
          height: parseInt(gif.images.original.height) || 400,
          title: gif.title || '',
        }));
        setGifs(gifResults);
        setShowTrending(true);
      } else {
        throw new Error(data.meta?.msg || 'Failed to fetch trending GIFs');
      }
    } catch (err: any) {
      console.error('Error fetching trending GIFs:', err);
      setError(err.message || 'Failed to load GIFs');
    } finally {
      setLoading(false);
    }
  }, []);

  // Search GIFs
  const searchGIFs = useCallback(async (query: string) => {
    if (!query.trim()) {
      fetchTrending();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=24&rating=g`
      );
      const data = await response.json();

      if (data.meta?.status === 200 && data.data) {
        const gifResults: GIFResult[] = data.data.map((gif: any) => ({
          id: gif.id,
          url: gif.images.original.url,
          stillUrl: gif.images.original_still?.url || gif.images.fixed_height_still.url,
          width: parseInt(gif.images.original.width) || 400,
          height: parseInt(gif.images.original.height) || 400,
          title: gif.title || '',
        }));
        setGifs(gifResults);
        setShowTrending(false);
      } else {
        throw new Error(data.meta?.msg || 'Failed to search GIFs');
      }
    } catch (err: any) {
      console.error('Error searching GIFs:', err);
      setError(err.message || 'Failed to search GIFs');
    } finally {
      setLoading(false);
    }
  }, [fetchTrending]);

  // Load trending on open
  useEffect(() => {
    if (open) {
      fetchTrending();
      setSearchQuery('');
    }
  }, [open, fetchTrending]);

  // Debounced search
  useEffect(() => {
    if (!open) return;

    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        searchGIFs(searchQuery);
      } else {
        fetchTrending();
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, open, searchGIFs, fetchTrending]);

  const handleGIFClick = (gif: GIFResult) => {
    onGIFSelect({
      url: gif.url,
      stillUrl: gif.stillUrl,
      width: gif.width,
      height: gif.height,
      provider: 'giphy',
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isMobile}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: isMobile ? 0 : 2,
          maxHeight: isMobile ? '100%' : '80vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {showTrending && <TrendingUpIcon fontSize="small" color="primary" />}
          <Typography variant="h6">
            {showTrending ? 'Trending GIFs' : 'Search GIFs'}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 2 }}>
        {/* Search bar */}
        <TextField
          fullWidth
          placeholder="Search GIFs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          size="small"
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />

        {/* Loading state */}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Error state */}
        {error && !loading && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          </Box>
        )}

        {/* GIF grid */}
        {!loading && !error && gifs.length > 0 && (
          <Box
            sx={{
              maxHeight: isMobile ? 'calc(100vh - 200px)' : '60vh',
              overflowY: 'auto',
              '&::-webkit-scrollbar': {
                width: '8px',
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: 'transparent',
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: 'rgba(0,0,0,0.2)',
                borderRadius: '4px',
              },
            }}
          >
            <Grid container spacing={1}>
              {gifs.map((gif) => (
                <Grid item xs={6} sm={4} md={3} key={gif.id}>
                  <Box
                    onClick={() => handleGIFClick(gif)}
                    sx={{
                      position: 'relative',
                      width: '100%',
                      paddingTop: '100%', // Square aspect ratio
                      cursor: 'pointer',
                      borderRadius: 1,
                      overflow: 'hidden',
                      bgcolor: 'grey.100',
                      '&:hover': {
                        opacity: 0.8,
                      },
                      '& img': {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      },
                    }}
                  >
                    <img
                      src={gif.stillUrl}
                      alt={gif.title}
                      loading="lazy"
                      onMouseEnter={(e) => {
                        // Start loading animated version on hover
                        const img = new Image();
                        img.src = gif.url;
                        img.onload = () => {
                          (e.target as HTMLImageElement).src = gif.url;
                        };
                      }}
                    />
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        {/* Empty state */}
        {!loading && !error && gifs.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              No GIFs found. Try a different search.
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default GIFPicker;

