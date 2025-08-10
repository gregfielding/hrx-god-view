import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Collapse,
  Card,
  CardContent,
  Button,
  CircularProgress,
  Alert,
  Badge
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Email as EmailIcon,
  Drafts as DraftsIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon
} from '@mui/icons-material';
import { format } from 'date-fns';

import EmailService from '../utils/emailService';

interface EmailLog {
  id?: string;
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  timestamp: Date;
  bodySnippet: string;
  bodyHtml?: string;
  direction: 'inbound' | 'outbound';
  contactId?: string;
  companyId?: string;
  dealId?: string;
  userId: string;
  isDraft?: boolean;
}

interface EmailTabProps {
  dealId: string;
  tenantId: string;
  contacts: any[];
  companies: any[];
  currentUser: any;
}

const EmailTab: React.FC<EmailTabProps> = ({
  dealId,
  tenantId,
  contacts,
  companies,
  currentUser
}) => {
  const [emails, setEmails] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
  const [showFullContent, setShowFullContent] = useState<Set<string>>(new Set());

  // Group emails by thread
  const groupedEmails = emails.reduce((acc, email) => {
    if (!acc[email.threadId]) {
      acc[email.threadId] = [];
    }
    acc[email.threadId].push(email);
    return acc;
  }, {} as Record<string, EmailLog[]>);

  // Sort threads by most recent email
  const sortedThreads = Object.entries(groupedEmails).sort(([, a], [, b]) => {
    const aLatest = Math.max(...a.map(e => e.timestamp.getTime()));
    const bLatest = Math.max(...b.map(e => e.timestamp.getTime()));
    return bLatest - aLatest;
  });

  const handleEmailToggle = (emailId: string) => {
    const newExpanded = new Set(expandedEmails);
    if (newExpanded.has(emailId)) {
      newExpanded.delete(emailId);
    } else {
      newExpanded.add(emailId);
    }
    setExpandedEmails(newExpanded);
  };

  const handleContentToggle = (emailId: string) => {
    const newShowFull = new Set(showFullContent);
    if (newShowFull.has(emailId)) {
      newShowFull.delete(emailId);
    } else {
      newShowFull.add(emailId);
    }
    setShowFullContent(newShowFull);
  };

  const getContactName = (email: string) => {
    const contact = contacts.find(c => c.email === email);
    return contact ? `${contact.firstName} ${contact.lastName}`.trim() : email;
  };

  const getCompanyName = (companyId?: string) => {
    if (!companyId) return null;
    const company = companies.find(c => c.id === companyId);
    return company?.name || company?.companyName || 'Unknown Company';
  };

  const getDirectionIcon = (direction: 'inbound' | 'outbound') => {
    return direction === 'inbound' ? '📥' : '📤';
  };

  const getDirectionColor = (direction: 'inbound' | 'outbound') => {
    return direction === 'inbound' ? 'primary' : 'secondary';
  };

  const formatEmailAddresses = (addresses: string[]) => {
    return addresses.map(addr => getContactName(addr)).join(', ');
  };

  const sanitizeHtml = (html: string) => {
    // Basic HTML sanitization - in production, use a proper sanitizer
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '');
  };

  useEffect(() => {
    const loadEmails = async () => {
      try {
        setLoading(true);
        setError(null);
        const emails = await EmailService.loadEmailsForDeal(tenantId, dealId);
        setEmails(emails);
      } catch (err) {
        console.error('Error loading emails:', err);
        // Don't show error if it's just that no emails exist yet
        if (err instanceof Error && err.message.includes('permission')) {
          setError('No emails found for this deal. Emails will appear here once Gmail integration is set up.');
        } else {
          setError('Failed to load emails');
        }
      } finally {
        setLoading(false);
      }
    };

    loadEmails();
  }, [dealId, tenantId]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      {/* Calendar connection UI removed for this view */}

      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6" component="h2">
          Email History ({emails.length} messages)
        </Typography>
        <Button
          variant="outlined"
          startIcon={<EmailIcon />}
          onClick={() => {
            // TODO: Implement Gmail sync
            console.log('Sync emails');
          }}
        >
          Sync Emails
        </Button>
      </Box>

      {emails.length === 0 ? (
        <Card>
          <CardContent>
            <Box textAlign="center" py={4}>
              <EmailIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No emails found
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Emails associated with this deal will appear here once Gmail integration is set up.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                To get started, connect your Google Calendar above and set up Gmail integration.
              </Typography>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Subject</TableCell>
                <TableCell>From/To</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Direction</TableCell>
                <TableCell>Associations</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedThreads.map(([threadId, threadEmails]) => {
                const latestEmail = threadEmails[0]; // Already sorted by timestamp
                const isExpanded = latestEmail.id ? expandedEmails.has(latestEmail.id) : false;
                
                return (
                  <React.Fragment key={threadId}>
                    <TableRow hover>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          {latestEmail.isDraft && (
                            <Badge badgeContent="DRAFT" color="warning">
                              <DraftsIcon fontSize="small" />
                            </Badge>
                          )}
                          <Typography variant="body2" fontWeight="medium">
                            {latestEmail.subject}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {latestEmail.direction === 'inbound' 
                            ? `From: ${getContactName(latestEmail.from)}`
                            : `To: ${formatEmailAddresses(latestEmail.to)}`
                          }
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {format(latestEmail.timestamp, 'MMM d, yyyy h:mm a')}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={latestEmail.direction}
                          color={getDirectionColor(latestEmail.direction)}
                          size="small"
                          icon={<span>{getDirectionIcon(latestEmail.direction)}</span>}
                        />
                      </TableCell>
                      <TableCell>
                        <Box display="flex" gap={0.5} flexWrap="wrap">
                          {latestEmail.contactId && (
                            <Chip
                              label={getContactName(latestEmail.from)}
                              size="small"
                              icon={<PersonIcon />}
                              variant="outlined"
                            />
                          )}
                          {latestEmail.companyId && (
                            <Chip
                              label={getCompanyName(latestEmail.companyId)}
                              size="small"
                              icon={<BusinessIcon />}
                              variant="outlined"
                            />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() => latestEmail.id && handleEmailToggle(latestEmail.id)}
                        >
                          {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </IconButton>
                      </TableCell>
                    </TableRow>
                    
                    <TableRow>
                      <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={6}>
                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <Box sx={{ margin: 1 }}>
                            {threadEmails.map((email) => (
                              <Card key={email.id || Math.random().toString(36)} sx={{ mb: 1 }}>
                                <CardContent>
                                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                    <Typography variant="subtitle2" color="text.secondary">
                                      {email.direction === 'inbound' ? 'Received' : 'Sent'} at{' '}
                                      {format(email.timestamp, 'MMM d, yyyy h:mm a')}
                                    </Typography>
                                    <IconButton
                                      size="small"
                                      onClick={() => email.id && handleContentToggle(email.id)}
                                    >
                                      {email.id && showFullContent.has(email.id) ? 
                                        <VisibilityOffIcon /> : <VisibilityIcon />
                                      }
                                    </IconButton>
                                  </Box>
                                  
                                  <Typography variant="body2" paragraph>
                                    {email.id && showFullContent.has(email.id) && email.bodyHtml ? (
                                      <div 
                                        dangerouslySetInnerHTML={{ 
                                          __html: sanitizeHtml(email.bodyHtml) 
                                        }}
                                      />
                                    ) : (
                                      email.bodySnippet
                                    )}
                                  </Typography>
                                  
                                  <Box display="flex" gap={1} flexWrap="wrap">
                                    <Chip
                                      label={email.direction}
                                      size="small"
                                      color={getDirectionColor(email.direction)}
                                    />
                                    {email.isDraft && (
                                      <Chip label="Draft" size="small" color="warning" />
                                    )}
                                  </Box>
                                </CardContent>
                              </Card>
                            ))}
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default EmailTab;
