import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  TextField,
  Button,
  Chip,
  Snackbar,
  Alert,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  OutlinedInput,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Autocomplete,
  Tabs,
  Tab,
  Divider,
} from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import JobOrderDetails from '../AgencyProfile/components/JobOrderDetails';

const TenantJobOrderDetails: React.FC = () => {
  const { jobOrderId } = useParams<{ jobOrderId: string }>();
  const { tenantId } = useAuth();
  if (!tenantId || !jobOrderId) return null;
  return <JobOrderDetails tenantId={tenantId} jobOrderId={jobOrderId} />;
};

export default TenantJobOrderDetails; 