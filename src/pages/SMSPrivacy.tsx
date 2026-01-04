import React from 'react';
import { 
  Box, 
  Typography, 
  Container, 
  List,
  ListItem,
  Alert,
  Link,
} from '@mui/material';

const SMSPrivacy: React.FC = () => {
  return (
    <Container maxWidth="md" sx={{ py: 5, pb: 10 }}>
      {/* Header */}
      <Box component="header" sx={{ mb: 3 }}>
        <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.2, mb: 1.5 }}>
          SMS/Text Messaging & Mobile Communications Privacy Notice
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Effective Date: <time dateTime="2025-10-21">October 21, 2025</time> · Last Updated: <time dateTime="2025-10-21">October 21, 2025</time>
          <br />
          Applies to: <Box component="span" sx={{ fontSize: '0.925rem' }}>C1 Staffing, LLC and its affiliates, including HRX One, HRX Companion, and related products ("we," "us," "our").</Box>
        </Typography>
        
        <Alert severity="info" sx={{ mb: 4 }}>
          <Typography variant="body2">
            This SMS/Text Messaging & Mobile Communications Privacy Notice (the "Notice") supplements the Privacy Policy of C1 Staffing, LLC and its affiliates, including HRX One and HRX Companion and explains how we collect and use information in connection with SMS/text messaging, mobile alerts, and mobile app notifications (collectively, "Mobile Communications").
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            This Notice applies to job applicants, employees, contractors, and platform users who enroll in or otherwise receive Mobile Communications from us.
          </Typography>
        </Alert>
      </Box>

      {/* Sections */}
      <Box component="section" id="info-collected" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>1. Information We Collect for Mobile Communications</Typography>
        <Typography paragraph>
          When you provide your mobile number or enable mobile notifications, we may collect and store:
        </Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Your mobile phone number</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>The date, time, and content of messages sent or received</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Delivery status and system logs</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Your device type and carrier information</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Your communication preferences and opt-in/opt-out status</ListItem>
        </List>
        <Typography paragraph sx={{ mt: 2 }}>
          We do <strong>not</strong> collect the contents of replies beyond what is necessary for operational purposes (for example, "STOP," "HELP," or message responses).
        </Typography>
      </Box>

      <Box component="section" id="how-we-use" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>2. How We Use Mobile Communication Data</Typography>
        <Typography paragraph>We use this information to:</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Send job-related, onboarding, scheduling, payroll, and employment notifications</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Provide account security alerts and verification codes</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Deliver system and service-related updates</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Maintain compliance records for consent, delivery, and opt-out activity</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Troubleshoot delivery errors and improve our messaging system</ListItem>
        </List>
        <Typography paragraph sx={{ mt: 2 }}>
          We do <strong>not</strong> sell or rent your phone number or messaging data.
        </Typography>
        <Typography paragraph>
          We will not send unrelated marketing content unless you separately and explicitly opt-in to receive it.
        </Typography>
      </Box>

      <Box component="section" id="legal-basis" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>3. Legal Basis & Consent</Typography>
        <Typography paragraph>
          Where required by law, we rely on your express consent to send Mobile Communications.
        </Typography>
        <Typography paragraph>
          Consent is typically obtained when you:
        </Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Check the box agreeing to SMS during account creation, or</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Otherwise provide your mobile number and agree to receive communications</ListItem>
        </List>
        <Typography paragraph sx={{ mt: 2 }}>
          Consent is <strong>not required</strong> as a condition of applying for or accepting employment.
        </Typography>
        <Typography paragraph>
          You may withdraw consent at any time by replying <strong>STOP</strong>.
        </Typography>
      </Box>

      <Box component="section" id="opt-out" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>4. How to Opt-Out or Get Help</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            To stop receiving SMS messages, reply <strong>STOP</strong> to any message from us.
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            To receive assistance, reply <strong>HELP</strong> or email <Link href="mailto:support@c1staffing.com">support@c1staffing.com</Link>.
          </ListItem>
        </List>
        <Typography paragraph sx={{ mt: 2 }}>
          After opting out, you may still receive legally-required or service-essential messages through other channels such as email or in-app notifications.
        </Typography>
        <Typography paragraph>
          Carriers are <strong>not liable for delayed or undelivered messages.</strong>
        </Typography>
      </Box>

      <Box component="section" id="frequency" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>5. Message Frequency & Charges</Typography>
        <Typography paragraph>
          Message frequency varies and may increase during onboarding, scheduling, or active assignments.
        </Typography>
        <Typography paragraph>
          Message and data rates may apply according to your mobile plan and carrier.
        </Typography>
      </Box>

      <Box component="section" id="security" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>6. Data Security & Retention</Typography>
        <Typography paragraph>
          We store Mobile Communication data securely using industry-standard safeguards.
        </Typography>
        <Typography paragraph>
          Opt-in and opt-out records may be retained for compliance purposes such as proving consent under the Telephone Consumer Protection Act (TCPA) or carrier policies.
        </Typography>
        <Typography paragraph>
          Other message data is retained only as long as reasonably necessary to operate our Services or comply with applicable laws.
        </Typography>
      </Box>

      <Box component="section" id="privacy-rights" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>7. Privacy Rights & Additional Disclosures</Typography>
        <Typography paragraph>
          Your personal information is handled in accordance with our full Privacy Policy, including your rights to access, correct, or delete information where applicable.
        </Typography>
        <Typography paragraph>
          For details, please review our full Privacy Policy at:{' '}
          <Link href="/privacy">https://hrxone.com/privacy</Link>
        </Typography>
      </Box>

      <Box component="section" id="changes" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>8. Changes to This Notice</Typography>
        <Typography paragraph>
          We may update this Notice from time to time. The "Last Updated" date indicates the most recent revision. Material changes will be posted in our app or website.
        </Typography>
        <Typography paragraph>
          Continued use of our Services after an update constitutes acknowledgment of the revised Notice.
        </Typography>
      </Box>

      <Box component="section" id="contact" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>9. Contact Us</Typography>
        <Typography paragraph>
          If you have questions or concerns regarding Mobile Communications or privacy, contact us at:
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
          © {new Date().getFullYear()} C1 Staffing, LLC and affiliates. All rights reserved. |{' '}
          <Link href="/terms">Terms of Use</Link> |{' '}
          <Link href="/privacy">Privacy Policy</Link> |{' '}
          <Link href="/consent">SMS Consent</Link>
        </Typography>
      </Box>
    </Container>
  );
};

export default SMSPrivacy;


