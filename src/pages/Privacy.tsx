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
import { langToggleStyle } from './authMinimalStyles';
import { useT, setLanguage } from '../i18n';

const Privacy: React.FC = () => {
  const [guestLanguage, setGuestLanguage] = useGuestLanguage();
  const t = useT();

  React.useEffect(() => {
    setLanguage(guestLanguage);
  }, [guestLanguage]);

  return (
    <Container maxWidth="md" sx={{ py: 5, pb: 10, pt: 2 }}>
      {/* Language picker - 16px padding above (pt: 2) */}
      {/* Quiet EN | ES — the standard guest language toggle (2026-08-25). */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2, whiteSpace: 'nowrap' }}>
        <button type="button" style={langToggleStyle(guestLanguage === 'en')} onClick={() => setGuestLanguage('en')}>EN</button>
        <span style={{ color: '#ccc', margin: '0 8px' }}>|</span>
        <button type="button" style={langToggleStyle(guestLanguage === 'es')} onClick={() => setGuestLanguage('es')}>ES</button>
      </Box>

      {/* Header */}
      <Box component="header" sx={{ mb: 3 }}>
        <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.2, mb: 1.5 }}>
          {t('legal.privacy.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('legal.privacy.effectiveDate')} <time dateTime="2025-10-21">October 21, 2025</time> · {t('legal.privacy.lastUpdated')} <time dateTime="2025-10-21">October 21, 2025</time>
          <br />
          {t('legal.privacy.appliesTo')}
        </Typography>
        
        <Alert severity="info" sx={{ mb: 4 }}>
          <Typography variant="body2">
            {t('legal.privacy.introAlert')}
          </Typography>
        </Alert>
      </Box>

      {/* Sections */}
      <Box component="section" id="scope" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s1Title')}</Typography>
        <Typography paragraph>
          {t('legal.privacy.s1P1')}
        </Typography>
        <Typography paragraph>
          {t('legal.privacy.s1P2')}
        </Typography>
      </Box>

      <Box component="section" id="info-collected" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s2Title')}</Typography>
        <Typography paragraph>{t('legal.privacy.s2Intro')}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s2L1')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s2L2')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s2L3')}</ListItem>
        </List>
        <Typography paragraph>
          {t('legal.privacy.s2Sensitive')}
        </Typography>
      </Box>

      <Box component="section" id="how-we-use" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s3Title')}</Typography>
        <Typography paragraph>{t('legal.privacy.s3Intro')}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s3L1')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s3L2')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s3L3')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s3L4')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s3L5')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s3L6')}</ListItem>
        </List>
        <Typography paragraph>{t('legal.privacy.s3P2')}</Typography>
      </Box>

      <Box component="section" id="sharing" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s4Title')}</Typography>
        <Typography paragraph>{t('legal.privacy.s4Intro')}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s4L1')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s4L2')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s4L3')}</ListItem>
        </List>
        <Typography paragraph>{t('legal.privacy.s4P2')}</Typography>
      </Box>

      <Box component="section" id="cookies" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s5Title')}</Typography>
        <Typography paragraph>{t('legal.privacy.s5P1')}</Typography>
        <Typography paragraph>{t('legal.privacy.s5P2')}</Typography>
      </Box>

      <Box component="section" id="legal-basis" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s6Title')}</Typography>
        <Typography paragraph>{t('legal.privacy.s6Intro')}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s6L1')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s6L2')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s6L3')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s6L4')}</ListItem>
        </List>
      </Box>

      <Box component="section" id="security" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s7Title')}</Typography>
        <Typography paragraph>{t('legal.privacy.s7P1')}</Typography>
        <Typography paragraph>{t('legal.privacy.s7P2')}</Typography>
      </Box>

      <Box component="section" id="retention" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s8Title')}</Typography>
        <Typography paragraph>{t('legal.privacy.s8P1')}</Typography>
      </Box>

      <Box component="section" id="rights" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s9Title')}</Typography>
        <Typography paragraph>{t('legal.privacy.s9Intro')}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s9L1')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s9L2')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s9L3')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.privacy.s9L4')}</ListItem>
        </List>
        <Typography paragraph>
          {t('legal.privacy.s9P2')} <Link href="mailto:privacy@c1staffing.com">privacy@c1staffing.com</Link>. {t('legal.privacy.s9P3')}
        </Typography>
      </Box>

      <Box component="section" id="minors" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s10Title')}</Typography>
        <Typography paragraph>{t('legal.privacy.s10P1')}</Typography>
      </Box>

      <Box component="section" id="transfer" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s11Title')}</Typography>
        <Typography paragraph>{t('legal.privacy.s11P1')}</Typography>
      </Box>

      <Box component="section" id="updates" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s12Title')}</Typography>
        <Typography paragraph>{t('legal.privacy.s12P1')}</Typography>
      </Box>

      <Box component="section" id="contact" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.privacy.s13Title')}</Typography>
        <Typography paragraph>
          {t('legal.privacy.s13P1')}
          <br />
          📧 <Link href="mailto:privacy@c1staffing.com">privacy@c1staffing.com</Link>
        </Typography>
      </Box>

      {/* Footer */}
      <Box component="footer" sx={{ mt: 5, pt: 3, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary">
          © {new Date().getFullYear()} C1 Staffing, LLC and affiliates. {t('legal.privacy.footer')} |{' '}
          <Link href="/terms">{t('legal.privacy.linksTerms')}</Link> |{' '}
          <Link href="/consent">{t('legal.privacy.linksSMS')}</Link> |{' '}
          <Link href="/sms-privacy">{t('legal.privacy.linksSMSPrivacy')}</Link>
        </Typography>
      </Box>
    </Container>
  );
};

export default Privacy;
