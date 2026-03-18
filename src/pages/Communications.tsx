import React, { useState } from 'react';
import { 
  Box, 
  Typography, 
  Container, 
  List, 
  ListItem, 
  Alert,
  Link,
  Paper,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import { useGuestLanguage } from '../hooks/useGuestLanguage';
import { useT, setLanguage } from '../i18n';

const Communications: React.FC = () => {
  const [languageMenuAnchorEl, setLanguageMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [guestLanguage, setGuestLanguage] = useGuestLanguage();
  const t = useT();

  React.useEffect(() => {
    setLanguage(guestLanguage);
  }, [guestLanguage]);

  return (
    <Container maxWidth="md" sx={{ py: 5, pb: 10, pt: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Tooltip title={guestLanguage === 'es' ? t('nav.messageLanguageEs') : t('nav.messageLanguageEn')}>
          <Box
            component="button"
            onClick={(e) => setLanguageMenuAnchorEl(e.currentTarget)}
            aria-label={t('nav.language')}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              px: 1,
              py: 0.75,
              bgcolor: 'background.paper',
              color: 'text.secondary',
              cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
            }}
          >
            <LanguageIcon sx={{ fontSize: 20 }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {guestLanguage === 'es' ? 'ES' : 'EN'}
            </Typography>
          </Box>
        </Tooltip>
      </Box>
      <Menu
        anchorEl={languageMenuAnchorEl}
        open={Boolean(languageMenuAnchorEl)}
        onClose={() => setLanguageMenuAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          selected={guestLanguage === 'en'}
          onClick={() => { setLanguageMenuAnchorEl(null); setGuestLanguage('en'); }}
        >
          {t('nav.englishEn')}
        </MenuItem>
        <MenuItem
          selected={guestLanguage === 'es'}
          onClick={() => { setLanguageMenuAnchorEl(null); setGuestLanguage('es'); }}
        >
          {t('nav.espanolEs')}
        </MenuItem>
      </Menu>
      {/* Header */}
      <Box component="header" sx={{ mb: 3 }}>
        <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.2, mb: 1.5 }}>
          {t('legal.consent.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('legal.consent.effectiveDate')} <time dateTime="2025-10-21">October 21, 2025</time> · {t('legal.consent.lastUpdated')} <time dateTime="2025-10-21">October 21, 2025</time>
          <br />
          {t('legal.consent.appliesTo')}
        </Typography>
        
        <Alert severity="info" sx={{ mb: 4 }}>
          <Typography variant="body2">
            <strong>{t('legal.consent.summaryLabel')}</strong> {t('legal.consent.summaryBody')}
          </Typography>
        </Alert>
      </Box>

      {/* Table of Contents */}
      <Paper variant="outlined" sx={{ p: 2, mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>{t('legal.consent.contents')}</Typography>
        <List dense>
          <ListItem sx={{ py: 0.5 }}><Link href="#purpose" underline="none">{t('legal.consent.s1Title')}</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#types" underline="none">{t('legal.consent.s2Title')}</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#frequency" underline="none">{t('legal.consent.s3Title')}</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#carrier" underline="none">{t('legal.consent.s4Title')}</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#opt-out" underline="none">{t('legal.consent.s5Title')}</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#support" underline="none">{t('legal.consent.s6Title')}</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#authorization" underline="none">{t('legal.consent.s7Title')}</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#privacy" underline="none">{t('legal.consent.s8Title')}</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#changes" underline="none">{t('legal.consent.s9Title')}</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#record" underline="none">{t('legal.consent.s10Title')}</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#jurisdiction" underline="none">{t('legal.consent.s11Title')}</Link></ListItem>
        </List>
      </Paper>

      <Box sx={{ borderTop: 1, borderColor: 'divider', my: 4 }} />

      {/* Sections */}
      <Box component="section" id="purpose" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.consent.s1Title')}</Typography>
        <Typography paragraph>
          {t('legal.consent.s1P1')}
        </Typography>
        <Typography paragraph>
          {t('legal.consent.s1P2')}
        </Typography>
      </Box>

      <Box component="section" id="types" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.consent.s2Title')}</Typography>
        <Typography paragraph>{t('legal.consent.s2Intro')}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.consent.s2L1')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.consent.s2L2')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.consent.s2L3')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.consent.s2L4')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.consent.s2L5')}</ListItem>
        </List>
        <Typography variant="body2" color="text.secondary">
          {t('legal.consent.s2P2')}
        </Typography>
      </Box>

      <Box component="section" id="frequency" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.consent.s3Title')}</Typography>
        <Typography paragraph>
          {t('legal.consent.s3P1')}
        </Typography>
      </Box>

      <Box component="section" id="carrier" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.consent.s4Title')}</Typography>
        <Typography paragraph>
          {t('legal.consent.s4P1')}
        </Typography>
      </Box>

      <Box component="section" id="opt-out" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.consent.s5Title')}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            {t('legal.consent.s5L1')}
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            {t('legal.consent.s5L2')}
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            {t('legal.consent.s5L3')}
          </ListItem>
        </List>
        <Typography variant="body2" color="text.secondary">
          {t('legal.consent.s5P2')}
        </Typography>
      </Box>

      <Box component="section" id="support" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.consent.s6Title')}</Typography>
        <Typography paragraph>
          {t('legal.consent.s6P1')} <Link href="mailto:support@c1staffing.com">support@c1staffing.com</Link>.
        </Typography>
      </Box>

      <Box component="section" id="authorization" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.consent.s7Title')}</Typography>
        <Typography paragraph>
          {t('legal.consent.s7P1')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('legal.consent.s7P2')}
        </Typography>
      </Box>

      <Box component="section" id="privacy" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.consent.s8Title')}</Typography>
        <Typography paragraph>
          {t('legal.consent.s8P1')} <Link href="/privacy">{t('legal.terms.linksPrivacy')}</Link>.
        </Typography>
      </Box>

      <Box component="section" id="changes" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.consent.s9Title')}</Typography>
        <Typography paragraph>
          {t('legal.consent.s9P1')}
        </Typography>
      </Box>

      <Box component="section" id="record" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.consent.s10Title')}</Typography>
        <Typography paragraph>
          {t('legal.consent.s10P1')} <Link href="mailto:support@c1staffing.com">support@c1staffing.com</Link>.
        </Typography>
      </Box>

      <Box component="section" id="jurisdiction" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.consent.s11Title')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('legal.consent.s11P1')}
        </Typography>
      </Box>

      {/* Footer */}
      <Box component="footer" sx={{ mt: 5, pt: 3, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary">
          © {new Date().getFullYear()} C1 Staffing, LLC and affiliates. {t('legal.terms.footer')} |{' '}
          <Link href="/terms">{t('legal.privacy.linksTerms')}</Link> |{' '}
          <Link href="/privacy">{t('legal.terms.linksPrivacy')}</Link> |{' '}
          <Link href="/sms-privacy">{t('legal.privacy.linksSMSPrivacy')}</Link>
        </Typography>
      </Box>
    </Container>
  );
};

export default Communications;
