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

const Privacy: React.FC = () => {
  return (
    <Container maxWidth="md" sx={{ py: 5, pb: 10 }}>
      {/* Header */}
      <Box component="header" sx={{ mb: 3 }}>
        <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.2, mb: 1.5 }}>
          Privacy Policy
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Effective Date: <time dateTime="2025-10-21">October 21, 2025</time> · Last Updated: <time dateTime="2025-10-21">October 21, 2025</time>
          <br />
          Applies to: C1 Staffing, LLC and its affiliates, including HRX One, HRX Companion, and related products ("we," "us," "our").
        </Typography>
        
        <Alert severity="info" sx={{ mb: 4 }}>
          <Typography variant="body2">
            This Privacy Policy explains how we collect, use, and protect your information when you visit our websites, use our applications, or engage with us as a job applicant, employee, or client.
          </Typography>
        </Alert>
      </Box>

      {/* Sections */}
      <Box component="section" id="scope" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>1. Scope</Typography>
        <Typography paragraph>
          This Privacy Policy applies to all users of our websites, mobile applications, and related online services (collectively, the "Services"). It covers both job applicants and employees who use our platforms.
        </Typography>
        <Typography paragraph>
          This Policy does not apply to third-party websites or services that are linked from our platforms.
        </Typography>
      </Box>

      <Box component="section" id="info-collected" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>2. Information We Collect</Typography>
        <Typography paragraph>We collect information in three main ways:</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            <strong>Information you provide directly:</strong> such as your name, contact details, resume, employment history, education, shift preferences, and other information submitted through forms or applications.
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            <strong>Employment or assignment data:</strong> including job assignments, timesheets, location check-ins, payroll data, tax forms, and compliance documentation.
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            <strong>Automatic data:</strong> such as device type, IP address, browser information, and usage analytics collected via cookies and similar technologies.
          </ListItem>
        </List>
        <Typography paragraph>
          In some cases, we may collect sensitive information (e.g., Social Security number, driver's license, or work authorization documents) for employment verification or payroll purposes, handled under strict security and compliance controls.
        </Typography>
      </Box>

      <Box component="section" id="how-we-use" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>3. How We Use Your Information</Typography>
        <Typography paragraph>We use your information to:</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Process job applications and match you with potential opportunities</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Verify employment eligibility (e.g., I-9, E-Verify, background checks)</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Communicate about shifts, scheduling, payroll, and HR matters</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Provide, improve, and secure our Services</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Comply with legal and regulatory obligations</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Conduct analytics to improve platform performance and worker experience</ListItem>
        </List>
        <Typography paragraph>
          We do not sell personal information and only share data with vendors who help us deliver employment-related or operational functions.
        </Typography>
      </Box>

      <Box component="section" id="sharing" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>4. How We Share Information</Typography>
        <Typography paragraph>We may share information with:</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            <strong>Clients and hiring partners</strong> to facilitate job placements or assignments.
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            <strong>Service providers</strong> (e.g., payroll processors, background check partners, cloud hosting, and IT security vendors) who perform services on our behalf.
          </ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>
            <strong>Regulatory authorities</strong> as required by law or government request.
          </ListItem>
        </List>
        <Typography paragraph>
          All third-party vendors are bound by confidentiality and data protection obligations consistent with applicable law.
        </Typography>
      </Box>

      <Box component="section" id="cookies" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>5. Cookies and Tracking Technologies</Typography>
        <Typography paragraph>
          We use cookies, pixels, and analytics tools to understand how users interact with our websites and apps, improve performance, and enhance usability.
        </Typography>
        <Typography paragraph>
          You can control or disable cookies through your browser settings, though some features of the site may not function properly without them.
        </Typography>
      </Box>

      <Box component="section" id="legal-basis" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>6. Legal Bases for Processing (GDPR-style Notice)</Typography>
        <Typography paragraph>Where applicable law requires a legal basis, we process your personal information based on:</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Your consent (for example, when you agree to receive SMS messages)</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Performance of a contract (e.g., your employment agreement)</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Compliance with legal obligations (e.g., tax, payroll, labor regulations)</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Legitimate interests (e.g., platform security, service improvement)</ListItem>
        </List>
      </Box>

      <Box component="section" id="security" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>7. Data Security</Typography>
        <Typography paragraph>
          We implement industry-standard security measures including encryption, access controls, and data minimization to protect your personal information from unauthorized access, disclosure, alteration, or destruction.
        </Typography>
        <Typography paragraph>
          Access to sensitive data (such as SSNs) is restricted to authorized personnel and is stored in compliance with applicable data protection laws.
        </Typography>
      </Box>

      <Box component="section" id="retention" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>8. Data Retention</Typography>
        <Typography paragraph>
          We retain personal data only as long as necessary for employment, business, or legal purposes. Retention periods vary by data type and legal requirement (e.g., payroll records may be retained longer for compliance reasons).
        </Typography>
      </Box>

      <Box component="section" id="rights" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>9. Your Rights and Choices</Typography>
        <Typography paragraph>Depending on your location, you may have rights to:</Typography>
        <List sx={{ listStyleType: 'disc', pl: 3 }}>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Access, correct, or delete your personal information</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Request a copy of the information we hold about you</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Opt out of certain communications or data uses</ListItem>
          <ListItem sx={{ display: 'list-item', py: 0.5 }}>Not be discriminated against for exercising privacy rights</ListItem>
        </List>
        <Typography paragraph>
          To exercise these rights, contact us at <Link href="mailto:privacy@c1staffing.com">privacy@c1staffing.com</Link>. We may need to verify your identity before fulfilling your request.
        </Typography>
      </Box>

      <Box component="section" id="minors" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>10. Children's Privacy</Typography>
        <Typography paragraph>
          Our Services are not directed to children under 16. We do not knowingly collect personal information from minors without appropriate consent.
        </Typography>
      </Box>

      <Box component="section" id="transfer" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>11. International Data Transfers</Typography>
        <Typography paragraph>
          If you access our Services from outside the United States, be aware that your data may be processed and stored in the U.S., where data protection laws may differ from those in your jurisdiction.
        </Typography>
      </Box>

      <Box component="section" id="updates" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>12. Updates to This Policy</Typography>
        <Typography paragraph>
          We may update this Privacy Policy periodically. When we make material changes, we will post the updated version on this page and update the "Last Updated" date above. Continued use of our Services after updates constitutes acceptance of the revised Policy.
        </Typography>
      </Box>

      <Box component="section" id="contact" sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>13. Contact Us</Typography>
        <Typography paragraph>
          For privacy questions, requests, or complaints, please contact:
          <br />
          📧 <Link href="mailto:privacy@c1staffing.com">privacy@c1staffing.com</Link>
        </Typography>
      </Box>

      {/* Footer */}
      <Box component="footer" sx={{ mt: 5, pt: 3, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary">
          © {new Date().getFullYear()} C1 Staffing, LLC and affiliates. All rights reserved. |{' '}
          <Link href="/terms">Terms of Use</Link> |{' '}
          <Link href="/consent">SMS Consent</Link> |{' '}
          <Link href="/sms-privacy">SMS Privacy Notice</Link>
        </Typography>
      </Box>
    </Container>
  );
};

export default Privacy;
