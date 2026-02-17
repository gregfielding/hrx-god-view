import React, { useState } from 'react';
import {
  Box,
  Typography,
  Container,
  List,
  ListItem,
  Alert,
  Link,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import { useGuestLanguage } from '../hooks/useGuestLanguage';
import { useT, setLanguage } from '../i18n';

const Terms: React.FC = () => {
  const [languageMenuAnchorEl, setLanguageMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [guestLanguage, setGuestLanguage] = useGuestLanguage();
  const t = useT();

  React.useEffect(() => {
    setLanguage(guestLanguage);
  }, [guestLanguage]);

  return (
    <Container maxWidth="md" sx={{ py: 5, pb: 10, pt: 2 }}>
      {/* Language picker - 16px padding above (pt: 2) */}
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
          {t('legal.terms.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('legal.terms.effectiveDate')} <time dateTime="2025-10-21">October 21, 2025</time> · {t('legal.terms.lastUpdated')} <time dateTime="2025-10-21">October 21, 2025</time>
          <br />
          {t('legal.terms.appliesTo')}
        </Typography>
        
        <Alert severity="info" sx={{ mb: 4 }}>
          <Typography variant="body2">
            {t('legal.terms.introAlert')}
          </Typography>
        </Alert>
      </Box>

      {/* Sections */}
      <Box component="section" id="acceptance" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s1Title')}</Typography>
        <Typography paragraph>
          {t('legal.terms.s1P1')} <Link href="/privacy">{t('legal.terms.s1P1Privacy')}</Link>{t('legal.terms.s1P1And')}<Link href="/consent">{t('legal.terms.s1P1Consent')}</Link>.
        </Typography>
        <Typography paragraph>
          {t('legal.terms.s1P2')}
        </Typography>
      </Box>

      <Box component="section" id="eligibility" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s2Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s2P1')}</Typography>
        <Typography paragraph>{t('legal.terms.s2P2')}</Typography>
      </Box>

      <Box component="section" id="accounts" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s3Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s3P1')}</Typography>
        <Typography paragraph>{t('legal.terms.s3P2')}</Typography>
      </Box>

      <Box component="section" id="communications" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s4Title')}</Typography>
        <Typography paragraph>
          {t('legal.terms.s4P1')} <Link href="/consent">{t('legal.terms.s4P1Consent')}</Link>{t('legal.terms.s4P1B')}
        </Typography>
      </Box>

      <Box component="section" id="platform-use" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s5Title')}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.terms.s5L1')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.terms.s5L2')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.terms.s5L3')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.terms.s5L4')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.terms.s5L5')}</ListItem>
        </List>
        <Typography paragraph>{t('legal.terms.s5P2')}</Typography>
      </Box>

      <Box component="section" id="employment" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s6Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s6P1')}</Typography>
        <Typography paragraph>{t('legal.terms.s6P2')}</Typography>
      </Box>

      <Box component="section" id="intellectual" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s7Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s7P1')}</Typography>
        <Typography paragraph>{t('legal.terms.s7P2')}</Typography>
      </Box>

      <Box component="section" id="user-content" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s8Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s8P1')}</Typography>
        <Typography paragraph>{t('legal.terms.s8P2')}</Typography>
      </Box>

      <Box component="section" id="privacy" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s9Title')}</Typography>
        <Typography paragraph>
          {t('legal.terms.s9P1')} <Link href="/privacy">{t('legal.terms.s9P1Privacy')}</Link>{t('legal.terms.s9P1B')}
        </Typography>
      </Box>

      <Box component="section" id="third-parties" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s10Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s10P1')}</Typography>
      </Box>

      <Box component="section" id="termination" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s11Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s11P1')}</Typography>
        <Typography paragraph>
          {t('legal.terms.s11P2')} <Link href="mailto:support@c1staffing.com">support@c1staffing.com</Link>.
        </Typography>
      </Box>

      <Box component="section" id="disclaimer" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s12Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s12P1')}</Typography>
        <Typography paragraph>{t('legal.terms.s12P2')}</Typography>
      </Box>

      <Box component="section" id="liability" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s13Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s13P1')}</Typography>
        <Typography paragraph>{t('legal.terms.s13P2')}</Typography>
      </Box>

      <Box component="section" id="indemnification" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s14Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s14P1')}</Typography>
      </Box>

      <Box component="section" id="arbitration" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s15Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s15P1')}</Typography>
        <Typography paragraph>{t('legal.terms.s15P2')}</Typography>
      </Box>

      <Box component="section" id="changes" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s16Title')}</Typography>
        <Typography paragraph>{t('legal.terms.s16P1')}</Typography>
      </Box>

      <Box component="section" id="misc" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.terms.s17Title')}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.terms.s17L1')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.terms.s17L2')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.terms.s17L3')}</ListItem>
        </List>
      </Box>

      {/* Footer */}
      <Box component="footer" sx={{ mt: 5, pt: 3, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary">
          © {new Date().getFullYear()} C1 Staffing, LLC and affiliates. {t('legal.terms.footer')} | <Link href="/privacy">{t('legal.terms.linksPrivacy')}</Link> | <Link href="/consent">{t('legal.terms.linksSMS')}</Link> | <Link href="/sms-privacy">{t('legal.terms.linksSMSPrivacy')}</Link>
        </Typography>
      </Box>
    </Container>
  );
};

export default Terms;
