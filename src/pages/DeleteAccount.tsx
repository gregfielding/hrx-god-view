/**
 * Delete Account — /delete-account (public, no auth).
 *
 * Google Play's Data safety form requires a public URL that explains how a
 * user of the "C1 Staffing" app requests account deletion and what is deleted
 * vs. retained (store listing 2026-09-05). Apple's in-app requirement is met
 * by the app's own Profile → Delete account flow; this page documents the
 * same request path for the web. Strings are inline (EN/ES) rather than in
 * i18n/locales because the page is legal copy that never appears inside the
 * authenticated app shell.
 */
import React from 'react';
import { Alert, Box, Container, Link, List, ListItem, Typography } from '@mui/material';
import { useGuestLanguage } from '../hooks/useGuestLanguage';
import { langToggleStyle } from './authMinimalStyles';

const COPY = {
  en: {
    title: 'Delete your C1 Staffing account',
    subtitle:
      'This page explains how to request deletion of the account you created in the C1 Staffing mobile app or at hrxone.com, and what happens to your data.',
    howTitle: 'How to request deletion',
    howIntro: 'You can request deletion in either of two ways:',
    howApp:
      'In the C1 Staffing app: open the Profile tab, tap "Delete account", then tap "Request deletion".',
    howEmail:
      'By email: send a message to hello@c1staffing.com from the email address on your account with the subject "Delete my account". Include the mobile number you use to sign in so we can find your profile.',
    whatTitle: 'What happens next',
    whatP1:
      'Our support team reviews every request. Your account is deactivated and your request is completed within 30 days. You will receive a confirmation at the email address on file.',
    deletedTitle: 'Data that is deleted',
    deletedIntro: 'When your request is completed we delete:',
    deletedL1: 'Your profile and sign-in (name, email address, phone number, home address, photo).',
    deletedL2: 'Documents and photos you uploaded through the app (for example ID photos and application attachments).',
    deletedL3: 'Job applications, shift preferences, saved jobs, and in-app activity.',
    deletedL4: 'Device and push-notification identifiers linked to your account.',
    keptTitle: 'Data that is kept, and for how long',
    keptIntro:
      'If you were placed on assignment or paid through C1 Staffing, some records must be retained by law even after your account is deleted:',
    keptL1: 'Payroll, tax, and wage records (typically retained for 4 to 7 years under federal and state law).',
    keptL2: 'Employment eligibility records such as Form I-9 and E-Verify results (retained for 3 years after hire or 1 year after employment ends, whichever is later).',
    keptL3: 'Workers’ compensation, safety, and legal-hold records for the period required by the applicable law.',
    keptP2:
      'These records are kept only for the required period, are not used for marketing, and are destroyed when the retention period ends. They are no longer linked to an active app account.',
    partialTitle: 'Deleting some data without closing your account',
    partialP1:
      'If you want to remove specific information (for example a document you uploaded) but keep your account, email hello@c1staffing.com and tell us what to remove.',
    contactTitle: 'Questions',
    contactP1: 'Email hello@c1staffing.com or see our ',
    contactLink: 'Privacy Policy',
    contactP2: '.',
  },
  es: {
    title: 'Elimina tu cuenta de C1 Staffing',
    subtitle:
      'Esta página explica cómo solicitar la eliminación de la cuenta que creaste en la app móvil de C1 Staffing o en hrxone.com, y qué pasa con tus datos.',
    howTitle: 'Cómo solicitar la eliminación',
    howIntro: 'Puedes solicitar la eliminación de dos maneras:',
    howApp:
      'En la app de C1 Staffing: abre la pestaña Perfil, toca “Eliminar cuenta” y luego “Solicitar eliminación”.',
    howEmail:
      'Por correo: envía un mensaje a hello@c1staffing.com desde el correo de tu cuenta con el asunto “Eliminar mi cuenta”. Incluye el número de celular con el que inicias sesión para que podamos encontrar tu perfil.',
    whatTitle: 'Qué sucede después',
    whatP1:
      'Nuestro equipo de soporte revisa cada solicitud. Tu cuenta se desactiva y la solicitud se completa en un plazo de 30 días. Recibirás una confirmación en el correo registrado.',
    deletedTitle: 'Datos que se eliminan',
    deletedIntro: 'Al completar tu solicitud eliminamos:',
    deletedL1: 'Tu perfil e inicio de sesión (nombre, correo, teléfono, domicilio, foto).',
    deletedL2: 'Documentos y fotos que subiste en la app (por ejemplo fotos de identificación y archivos adjuntos de postulaciones).',
    deletedL3: 'Postulaciones, preferencias de turnos, empleos guardados y actividad en la app.',
    deletedL4: 'Identificadores de dispositivo y de notificaciones vinculados a tu cuenta.',
    keptTitle: 'Datos que se conservan y por cuánto tiempo',
    keptIntro:
      'Si trabajaste en una asignación o recibiste pagos a través de C1 Staffing, la ley exige conservar algunos registros aun después de eliminar tu cuenta:',
    keptL1: 'Registros de nómina, impuestos y salarios (normalmente de 4 a 7 años según la ley federal y estatal).',
    keptL2: 'Registros de elegibilidad de empleo como el Formulario I-9 y resultados de E-Verify (3 años desde la contratación o 1 año después de terminar el empleo, lo que ocurra después).',
    keptL3: 'Registros de compensación laboral, seguridad y retención legal por el periodo que exija la ley aplicable.',
    keptP2:
      'Estos registros se conservan solo durante el periodo requerido, no se usan para marketing y se destruyen al terminar el plazo. Ya no están vinculados a una cuenta activa de la app.',
    partialTitle: 'Eliminar algunos datos sin cerrar tu cuenta',
    partialP1:
      'Si quieres eliminar información específica (por ejemplo un documento que subiste) pero conservar tu cuenta, escribe a hello@c1staffing.com e indícanos qué eliminar.',
    contactTitle: 'Preguntas',
    contactP1: 'Escribe a hello@c1staffing.com o consulta nuestra ',
    contactLink: 'Política de Privacidad',
    contactP2: '.',
  },
} as const;

const DeleteAccount: React.FC = () => {
  const [guestLanguage, setGuestLanguage] = useGuestLanguage();
  const c = COPY[guestLanguage === 'es' ? 'es' : 'en'];

  const bullet = { display: 'list-item', py: 0.5 } as const;

  return (
    <Container maxWidth="md" sx={{ py: 5, pb: 10, pt: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2, whiteSpace: 'nowrap' }}>
        <button type="button" style={langToggleStyle(guestLanguage === 'en')} onClick={() => setGuestLanguage('en')}>EN</button>
        <span style={{ color: '#ccc', margin: '0 8px' }}>|</span>
        <button type="button" style={langToggleStyle(guestLanguage === 'es')} onClick={() => setGuestLanguage('es')}>ES</button>
      </Box>

      <Box component="header" sx={{ mb: 3 }}>
        <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.2, mb: 1.5 }}>
          {c.title}
        </Typography>
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">{c.subtitle}</Typography>
        </Alert>
      </Box>

      <Box component="section" id="how" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{c.howTitle}</Typography>
        <Typography paragraph>{c.howIntro}</Typography>
        <List sx={{ listStyleType: 'decimal', pl: 3 }}>
          <ListItem sx={bullet}>{c.howApp}</ListItem>
          <ListItem sx={bullet}>{c.howEmail}</ListItem>
        </List>
      </Box>

      <Box component="section" id="what-happens" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{c.whatTitle}</Typography>
        <Typography paragraph>{c.whatP1}</Typography>
      </Box>

      <Box component="section" id="deleted" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{c.deletedTitle}</Typography>
        <Typography paragraph>{c.deletedIntro}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={bullet}>{c.deletedL1}</ListItem>
          <ListItem sx={bullet}>{c.deletedL2}</ListItem>
          <ListItem sx={bullet}>{c.deletedL3}</ListItem>
          <ListItem sx={bullet}>{c.deletedL4}</ListItem>
        </List>
      </Box>

      <Box component="section" id="retained" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{c.keptTitle}</Typography>
        <Typography paragraph>{c.keptIntro}</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={bullet}>{c.keptL1}</ListItem>
          <ListItem sx={bullet}>{c.keptL2}</ListItem>
          <ListItem sx={bullet}>{c.keptL3}</ListItem>
        </List>
        <Typography paragraph>{c.keptP2}</Typography>
      </Box>

      <Box component="section" id="partial" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{c.partialTitle}</Typography>
        <Typography paragraph>{c.partialP1}</Typography>
      </Box>

      <Box component="section" id="contact" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>{c.contactTitle}</Typography>
        <Typography paragraph>
          {c.contactP1}
          <Link href="/privacy">{c.contactLink}</Link>
          {c.contactP2}
        </Typography>
      </Box>
    </Container>
  );
};

export default DeleteAccount;
