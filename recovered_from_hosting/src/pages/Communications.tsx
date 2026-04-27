import React from 'react';
import { 
  Box, 
  Typography, 
  Container, 
  List, 
  ListItem, 
  Alert,
  Link,
  Paper
} from '@mui/material';

const Communications: React.FC = () => {
  return (
    <Container maxWidth="md" sx={{ py: 5, pb: 10 }}>
      {/* Header */}
      <Box component="header" sx={{ mb: 3 }}>
        <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.2, mb: 1.5 }}>
          SMS and Mobile Communications Consent Agreement
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Effective Date: <time dateTime="2025-10-21">October 21, 2025</time> · Last Updated: <time dateTime="2025-10-21">October 21, 2025</time>
          <br />
          Applies to: <Box component="span" sx={{ fontSize: '0.925rem' }}>C1 Staffing, LLC and its affiliates, including HRX One, HRX Companion, and related products ("we," "us," "our").</Box>
        </Typography>
        
        <Alert severity="info" sx={{ mb: 4 }}>
          <Typography variant="body2">
            <strong>Summary:</strong> By creating an account and selecting "I agree" during sign up, you consent to receive text messages (SMS/MMS), emails, and mobile app notifications about job opportunities, scheduling, onboarding, payroll, and related employment communications. Message & data rates may apply. Reply <strong>STOP</strong> to unsubscribe from SMS. You can manage push notifications in your device settings.
          </Typography>
        </Alert>
      </Box>

      {/* Table of Contents */}
      <Paper variant="outlined" sx={{ p: 2, mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>Contents</Typography>
        <List dense>
          <ListItem sx={{ py: 0.5 }}><Link href="#purpose" underline="none">1. Purpose of This Consent</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#types" underline="none">2. Types of Messages</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#frequency" underline="none">3. Frequency</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#carrier" underline="none">4. Carrier & Cost Notice</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#opt-out" underline="none">5. Opt-Out & Preference Management</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#support" underline="none">6. Help & Support</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#authorization" underline="none">7. Authorization & Representations</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#privacy" underline="none">8. Privacy</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#changes" underline="none">9. Changes to This Consent</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#record" underline="none">10. Record of Consent</Link></ListItem>
          <ListItem sx={{ py: 0.5 }}><Link href="#jurisdiction" underline="none">11. Jurisdiction & Compliance Notices</Link></ListItem>
        </List>
      </Paper>

      <Box sx={{ borderTop: 1, borderColor: 'divider', my: 4 }} />

      {/* Sections */}
      <Box component="section" id="purpose" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>1. Purpose of This Consent</Typography>
        <Typography paragraph>
          This Consent authorizes us to send you communications via <strong>SMS/MMS text messages, email, and mobile app push notifications</strong> relating to your application, job opportunities, onboarding, scheduling, timekeeping, payroll, benefits, HR updates, security alerts (including multi-factor codes), and other communications relevant to your engagement with us.
        </Typography>
        <Typography paragraph>
          Consent to receive these messages is <strong>not a condition</strong> of applying for or obtaining employment. Where required, we may obtain separate consent for any marketing communications unrelated to your employment or job search.
        </Typography>
      </Box>

      <Box component="section" id="types" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>2. Types of Messages</Typography>
        <Typography paragraph>You may receive, including but not limited to:</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Job openings, shift offers, assignment confirmations, and schedule changes</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Onboarding tasks, document reminders, I-9/E-Verify and compliance notices</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Timecard reminders, payroll notices, and benefits updates</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Account security alerts, verification codes, and app/service updates</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Operational announcements required for workplace safety or policy changes</ListItem>
        </List>
        <Typography variant="body2" color="text.secondary">
          We will not send unrelated promotional/marketing messages without a separate, explicit opt-in.
        </Typography>
      </Box>

      <Box component="section" id="frequency" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>3. Frequency</Typography>
        <Typography paragraph>
          Message frequency varies based on your activity, location, and assignments, and may include multiple messages per week during active periods (e.g., onboarding or scheduled shifts).
        </Typography>
      </Box>

      <Box component="section" id="carrier" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>4. Carrier & Cost Notice</Typography>
        <Typography paragraph>
          <strong>Message and data rates may apply</strong> according to your mobile plan and carrier. Carriers are not liable for delayed or undelivered messages. Availability may vary by carrier and device.
        </Typography>
      </Box>

      <Box component="section" id="opt-out" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>5. Opt-Out & Preference Management</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            <strong>SMS:</strong> You can opt out at any time by replying <strong>STOP</strong> to any text message from us. To get help, reply <strong>HELP</strong>.
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            <strong>Push Notifications:</strong> Manage or disable notifications in your device's settings or in the app's notification preferences.
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            <strong>Email:</strong> You may adjust email preferences using links in the footer where available. We may still send transactional or legally required emails.
          </ListItem>
        </List>
        <Typography variant="body2" color="text.secondary">
          Opting out of SMS or push notifications will not stop communications we are legally permitted or required to send by email or within your account.
        </Typography>
      </Box>

      <Box component="section" id="support" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>6. Help & Support</Typography>
        <Typography paragraph>
          For assistance with messaging, contact us at <Link href="mailto:support@c1staffing.com">support@c1staffing.com</Link>.
        </Typography>
      </Box>

      <Box component="section" id="authorization" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>7. Authorization & Representations</Typography>
        <Typography paragraph>
          By creating an account and selecting "I agree" on the sign-up screen, you confirm that (i) you are the owner or authorized user of the phone number and email you provide; (ii) you authorize us to contact you as described in this Consent; and (iii) you understand you may revoke consent at any time using the methods above.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          If your phone number or email changes, you agree to update your account information promptly to help ensure accurate delivery of communications.
        </Typography>
      </Box>

      <Box component="section" id="privacy" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>8. Privacy</Typography>
        <Typography paragraph>
          We handle your personal information in accordance with our <Link href="/privacy">Privacy Policy</Link>. This includes how we collect, use, and retain your contact information, and your rights under applicable laws (e.g., CCPA/CPRA where applicable).
        </Typography>
      </Box>

      <Box component="section" id="changes" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>9. Changes to This Consent</Typography>
        <Typography paragraph>
          We may update this Consent from time to time. The "Last Updated" date above will reflect the latest version. Material changes will be posted in the app or website. Continued use of our services after an update constitutes acknowledgment of the updated Consent.
        </Typography>
      </Box>

      <Box component="section" id="record" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>10. Record of Consent</Typography>
        <Typography paragraph>
          We maintain a record of your consent (including date/time, device, IP, and user account) for compliance purposes. You may request a copy of your consent record by contacting <Link href="mailto:support@c1staffing.com">support@c1staffing.com</Link>.
        </Typography>
      </Box>

      <Box component="section" id="jurisdiction" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>11. Jurisdiction & Compliance Notices</Typography>
        <Typography variant="body2" color="text.secondary">
          This Consent is intended to comply with applicable laws and carrier policies, including the Telephone Consumer Protection Act (TCPA) and relevant state privacy laws. If any provision is found unenforceable in a particular jurisdiction, it will be enforced to the maximum extent permitted, and the remainder will continue in effect.
        </Typography>
      </Box>

      {/* Footer */}
      <Box component="footer" sx={{ mt: 5, pt: 3, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary">
          © {new Date().getFullYear()} C1 Staffing, LLC and affiliates. All rights reserved. |{' '}
          <Link href="/terms">Terms of Use</Link> |{' '}
          <Link href="/privacy">Privacy Policy</Link> |{' '}
          <Link href="/sms-privacy">SMS Privacy Notice</Link>
        </Typography>
      </Box>
    </Container>
  );
};

export default Communications;
