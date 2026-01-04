import React from 'react';
import { 
  Box, 
  Typography, 
  Container, 
  List, 
  ListItem, 
  Alert,
  Link
} from '@mui/material';

const Terms: React.FC = () => {
  return (
    <Container maxWidth="md" sx={{ py: 5, pb: 10 }}>
      {/* Header */}
      <Box component="header" sx={{ mb: 3 }}>
        <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.2, mb: 1.5 }}>
          Terms of Use
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Effective Date: <time dateTime="2025-10-21">October 21, 2025</time> · Last Updated: <time dateTime="2025-10-21">October 21, 2025</time>
          <br />
          Applies to: C1 Staffing, LLC and its affiliates, including HRX One, HRX Companion, and related products ("we," "us," "our").
        </Typography>
        
        <Alert severity="info" sx={{ mb: 4 }}>
          <Typography variant="body2">
            These Terms govern your access to and use of our websites, mobile applications, and related services. By creating an account or using our platform, you agree to these Terms of Use.
          </Typography>
        </Alert>
      </Box>

      {/* Sections */}
      <Box component="section" id="acceptance" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>1. Acceptance of Terms</Typography>
        <Typography paragraph>
          By accessing or using any part of the C1 Staffing or HRX One platforms (collectively, the "Services"), you acknowledge that you have read, understood, and agree to be bound by these Terms of Use and our <Link href="/privacy">Privacy Policy</Link> and <Link href="/consent">SMS and Mobile Communications Consent Agreement</Link>.
        </Typography>
        <Typography paragraph>
          If you do not agree, do not access or use our Services. If you are accessing the Services on behalf of a company or organization, you represent that you are authorized to bind that entity to these Terms.
        </Typography>
      </Box>

      <Box component="section" id="eligibility" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>2. Eligibility</Typography>
        <Typography paragraph>
          You must be at least 16 years old (or the age of majority in your jurisdiction, if higher) to use our Services. Some job assignments may require a higher minimum age as required by law.
        </Typography>
        <Typography paragraph>
          By registering, you represent that the information you provide is true, accurate, and complete, and that you will maintain it accordingly.
        </Typography>
      </Box>

      <Box component="section" id="accounts" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>3. Account Registration and Security</Typography>
        <Typography paragraph>
          To access certain features, you must create an account. You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account.
        </Typography>
        <Typography paragraph>
          You agree to notify us immediately of any unauthorized access or breach of your account. We reserve the right to suspend or terminate any account that violates these Terms or is otherwise deemed insecure or fraudulent.
        </Typography>
      </Box>

      <Box component="section" id="communications" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>4. Electronic Communications</Typography>
        <Typography paragraph>
          By creating an account, you consent to receive communications electronically, including via email, SMS, and mobile notifications, as described in our <Link href="/consent">SMS and Mobile Communications Consent Agreement</Link>. You may withdraw certain consents as permitted by law, though doing so may limit your ability to use certain features.
        </Typography>
      </Box>

      <Box component="section" id="platform-use" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>5. Use of the Services</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Use the Services only for lawful purposes related to job seeking, employment, scheduling, and communication with us.</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Do not impersonate another person or entity or misrepresent your affiliation.</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Do not upload, transmit, or distribute any harmful, fraudulent, or unlawful material.</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Do not attempt to access data or systems you are not authorized to access.</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Do not interfere with or disrupt the security, integrity, or performance of the Services.</ListItem>
        </List>
        <Typography paragraph>
          We reserve the right to monitor, moderate, and remove content or access at our sole discretion to maintain platform integrity and compliance.
        </Typography>
      </Box>

      <Box component="section" id="employment" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>6. Employment Relationship</Typography>
        <Typography paragraph>
          Your use of the platform does not in itself create an employment relationship. If you are hired or assigned to a client, your employment status, pay, and terms are governed by your separate employment documents with C1 Staffing or the relevant employer of record.
        </Typography>
        <Typography paragraph>
          Nothing in these Terms guarantees a job, assignment, or continued employment.
        </Typography>
      </Box>

      <Box component="section" id="intellectual" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>7. Intellectual Property</Typography>
        <Typography paragraph>
          All content, code, trademarks, logos, and other intellectual property in or related to the Services are owned or licensed by us and protected under applicable intellectual property laws.
        </Typography>
        <Typography paragraph>
          You are granted a limited, non-exclusive, non-transferable license to access and use the Services for lawful purposes. No rights are transferred to you except as expressly stated.
        </Typography>
      </Box>

      <Box component="section" id="user-content" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>8. User-Generated Content</Typography>
        <Typography paragraph>
          If you submit, upload, or post any information (such as resumes, feedback, or profile data), you grant us a worldwide, royalty-free, sublicensable license to use, host, display, and process such content solely to operate and improve our Services.
        </Typography>
        <Typography paragraph>
          You remain responsible for the accuracy and legality of the content you provide.
        </Typography>
      </Box>

      <Box component="section" id="privacy" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>9. Privacy and Data Protection</Typography>
        <Typography paragraph>
          Our <Link href="/privacy">Privacy Policy</Link> explains how we collect, use, and share your information. By using our Services, you consent to our data practices as described therein.
        </Typography>
      </Box>

      <Box component="section" id="third-parties" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>10. Third-Party Services and Links</Typography>
        <Typography paragraph>
          The Services may link to third-party websites or integrate with third-party systems (such as payroll, identity verification, or messaging providers). We are not responsible for the content or practices of any third party. Your use of such services is governed by their terms.
        </Typography>
      </Box>

      <Box component="section" id="termination" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>11. Termination</Typography>
        <Typography paragraph>
          We may suspend or terminate your access to the Services at any time, with or without notice, for conduct that we believe violates these Terms or is otherwise harmful to other users or to us.
        </Typography>
        <Typography paragraph>
          You may deactivate your account at any time by contacting <Link href="mailto:support@c1staffing.com">support@c1staffing.com</Link>.
        </Typography>
      </Box>

      <Box component="section" id="disclaimer" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>12. Disclaimers</Typography>
        <Typography paragraph>
          The Services are provided "as is" and "as available." We make no warranties, express or implied, regarding the reliability, accuracy, or availability of the Services, including any job listings or communications.
        </Typography>
        <Typography paragraph>
          We do not guarantee employment or placement. Use of the platform is at your own risk.
        </Typography>
      </Box>

      <Box component="section" id="liability" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>13. Limitation of Liability</Typography>
        <Typography paragraph>
          To the fullest extent permitted by law, we and our affiliates shall not be liable for any indirect, incidental, consequential, special, or punitive damages arising from or relating to your use of the Services, even if advised of the possibility of such damages.
        </Typography>
        <Typography paragraph>
          Our total liability for any claim arising out of or relating to these Terms or your use of the Services shall not exceed one hundred U.S. dollars (US $100).
        </Typography>
      </Box>

      <Box component="section" id="indemnification" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>14. Indemnification</Typography>
        <Typography paragraph>
          You agree to indemnify and hold harmless C1 Staffing, HRX One, and their officers, directors, employees, and agents from any claims, losses, liabilities, damages, or expenses (including reasonable attorneys' fees) arising from your violation of these Terms or misuse of the Services.
        </Typography>
      </Box>

      <Box component="section" id="arbitration" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>15. Governing Law and Arbitration</Typography>
        <Typography paragraph>
          These Terms and any dispute arising out of or related to them shall be governed by the laws of the State of Nevada, without regard to its conflict of law rules.
        </Typography>
        <Typography paragraph>
          Except where prohibited by law, disputes will be resolved through binding arbitration administered by the American Arbitration Association (AAA) under its Commercial Arbitration Rules. You and we waive the right to a jury trial or to participate in a class action.
        </Typography>
      </Box>

      <Box component="section" id="changes" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>16. Changes to These Terms</Typography>
        <Typography paragraph>
          We may update these Terms from time to time. The "Last Updated" date above will indicate the latest version. Continued use of the Services after changes become effective constitutes your acceptance of the updated Terms.
        </Typography>
      </Box>

      <Box component="section" id="misc" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>17. Miscellaneous</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>If any provision is held invalid or unenforceable, the remaining provisions remain in full force and effect.</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Our failure to enforce any right or provision does not constitute a waiver of that right.</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>These Terms constitute the entire agreement between you and us regarding the Services.</ListItem>
        </List>
      </Box>

      {/* Footer */}
      <Box component="footer" sx={{ mt: 5, pt: 3, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary">
          © {new Date().getFullYear()} C1 Staffing, LLC and affiliates. All rights reserved. | <Link href="/privacy">Privacy Policy</Link> | <Link href="/consent">SMS Consent</Link> | <Link href="/sms-privacy">SMS Privacy Notice</Link>
        </Typography>
      </Box>
    </Container>
  );
};

export default Terms;
