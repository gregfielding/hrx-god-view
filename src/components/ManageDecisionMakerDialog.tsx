import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
} from '@mui/material';
import { Close as CloseIcon, Person as PersonIcon } from '@mui/icons-material';

export interface DecisionMakerContact {
  id: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  title?: string;
  email?: string;
}

interface ManageDecisionMakerDialogProps {
  open: boolean;
  onClose: () => void;
  dealContacts: DecisionMakerContact[];
  currentDecisionMaker: DecisionMakerContact | null;
  onSave: (contact: DecisionMakerContact | null) => void;
}

const ManageDecisionMakerDialog: React.FC<ManageDecisionMakerDialogProps> = ({
  open,
  onClose,
  dealContacts,
  currentDecisionMaker,
  onSave,
}) => {
  const [selected, setSelected] = useState<DecisionMakerContact | null>(currentDecisionMaker);

  useEffect(() => {
    if (open) setSelected(currentDecisionMaker);
  }, [open, currentDecisionMaker?.id]);

  const handleSave = () => {
    onSave(selected);
    onClose();
  };

  const displayName = (c: DecisionMakerContact) =>
    c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.name || 'Unknown';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Decision Maker</Typography>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select the decision maker from the deal contacts.
          </Typography>
          {dealContacts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No deal contacts yet. Add contacts to the deal first, then choose a decision maker.
            </Typography>
          ) : (
            <List sx={{ bgcolor: 'grey.50', borderRadius: 1 }}>
              <ListItem
                sx={{
                  py: 1,
                  borderRadius: 1,
                  bgcolor: selected === null ? 'action.selected' : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => setSelected(null)}
                button
              >
                <ListItemAvatar>
                  <Avatar sx={{ width: 40, height: 40, bgcolor: 'grey.400' }}>
                    <PersonIcon />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary="No decision maker"
                  secondary="Clear selection"
                />
              </ListItem>
              {dealContacts.map((contact) => (
                <ListItem
                  key={contact.id}
                  sx={{
                    py: 1,
                    borderRadius: 1,
                    bgcolor: selected?.id === contact.id ? 'action.selected' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelected(contact)}
                  button
                >
                  <ListItemAvatar>
                    <Avatar sx={{ width: 40, height: 40, fontSize: '1rem' }}>
                      {(contact.fullName || contact.firstName || contact.name || 'C').charAt(0).toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={displayName(contact)}
                    secondary={contact.title || contact.email || 'No title'}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button onClick={onClose} variant="outlined">
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained">
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ManageDecisionMakerDialog;
