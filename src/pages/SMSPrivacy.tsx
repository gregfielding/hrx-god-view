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

const SMSPrivacy: React.FC = () => {
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
          {t('legal.smsPrivacy.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('legal.smsPrivacy.effectiveDate')} <time dateTime="2025-10-21">October 21, 2025</time> · {t('legal.smsPrivacy.lastUpdated')} <time dateTime="2025-10-21">October 21, 2025</time>
          <br />
          {t('legal.smsPrivacy.appliesTo')}
        </Typography>
        
        <Alert severity="info" sx={{ mb: 4 }}>
          <Typography variant="body2">
            {t('legal.smsPrivacy.introP1')}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t('legal.smsPrivacy.introP2')}
          </Typography>
        </Alert>
      </Box>

      {/* Sections */}
      <Box component="section" id="info-collected" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.smsPrivacy.s1Title')}</Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s1Intro')}
        </Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s1L1')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s1L2')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s1L3')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s1L4')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s1L5')}</ListItem>
        </List>
        <Typography paragraph sx={{ mt: 2 }}>
          {t('legal.smsPrivacy.s1P2')}
        </Typography>
      </Box>

      <Box component="section" id="how-we-use" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.smsPrivacy.s2Title')}</Typography>
        <Typography paragraph>{t('legal.smsPrivacy.s2Intro')}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s2L1')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s2L2')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s2L3')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s2L4')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s2L5')}</ListItem>
        </List>
        <Typography paragraph sx={{ mt: 2 }}>
          {t('legal.smsPrivacy.s2P2')}
        </Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s2P3')}
        </Typography>
      </Box>

      <Box component="section" id="legal-basis" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.smsPrivacy.s3Title')}</Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s3P1')}
        </Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s3Intro')}
        </Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s3L1')}</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>{t('legal.smsPrivacy.s3L2')}</ListItem>
        </List>
        <Typography paragraph sx={{ mt: 2 }}>
          {t('legal.smsPrivacy.s3P2')}
        </Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s3P3')}
        </Typography>
      </Box>

      <Box component="section" id="opt-out" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.smsPrivacy.s4Title')}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            {t('legal.smsPrivacy.s4L1')}
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            {t('legal.smsPrivacy.s4L2')} <Link href="mailto:support@c1staffing.com">support@c1staffing.com</Link>.
          </ListItem>
        </List>
        <Typography paragraph sx={{ mt: 2 }}>
          {t('legal.smsPrivacy.s4P2')}
        </Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s4P3')}
        </Typography>
      </Box>

      <Box component="section" id="frequency" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.smsPrivacy.s5Title')}</Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s5P1')}
        </Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s5P2')}
        </Typography>
      </Box>

      <Box component="section" id="security" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.smsPrivacy.s6Title')}</Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s6P1')}
        </Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s6P2')}
        </Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s6P3')}
        </Typography>
      </Box>

      <Box component="section" id="privacy-rights" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.smsPrivacy.s7Title')}</Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s7P1')}
        </Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s7P2')}{' '}
          <Link href="/privacy">https://hrxone.com/privacy</Link>
        </Typography>
      </Box>

      <Box component="section" id="changes" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.smsPrivacy.s8Title')}</Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s8P1')}
        </Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s8P2')}
        </Typography>
      </Box>

      <Box component="section" id="contact" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{t('legal.smsPrivacy.s9Title')}</Typography>
        <Typography paragraph>
          {t('legal.smsPrivacy.s9P1')}
        </Typography>
        <List>
          <ListItem sx={{ pl: 0 }}>
            📧 <Link href="mailto:privacy@c1staffing.com">privacy@c1staffing.com</Link>
          </ListItem>
          <ListItem sx={{ pl: 0 }}>
            📧 <Link href="mailto:support@c1staffing.com">support@c1staffing.com</Link>
          </ListItem>
        </List>
      </Box>

      {/* Footer */}
      <Box component="footer" sx={{ mt: 5, pt: 3, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary">
          © {new Date().getFullYear()} C1 Staffing, LLC and affiliates. {t('legal.privacy.footer')} |{' '}
          <Link href="/terms">{t('legal.privacy.linksTerms')}</Link> |{' '}
          <Link href="/privacy">{t('legal.terms.linksPrivacy')}</Link> |{' '}
          <Link href="/consent">{t('legal.terms.linksSMS')}</Link>
        </Typography>
      </Box>
    </Container>
  );
};

export default SMSPrivacy;


