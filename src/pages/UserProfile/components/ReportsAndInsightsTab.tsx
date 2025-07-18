import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Paper,
  Grid,
  Card,
  CardContent,
  Button,
  Chip,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  TrendingFlat,
  Warning,
  CheckCircle,
  Info,
  Download,
  Assessment,
  Psychology,
  Timeline,
  Feedback,
  School,
  AutoFixHigh,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';

interface ReportsAndInsightsTabProps {
  uid: string;
}

interface JSIScore {
  overallScore: number;
  workEngagement: number;
  careerAlignment: number;
  managerRelationship: number;
  personalWellbeing: number;
  jobMobility: number;
  riskLevel: 'low' | 'medium' | 'high';
  trend: 'up' | 'down' | 'stable';
  lastUpdated: any;
}

interface TraitData {
  name: string;
  score: number;
  confidence: number;
  trend: 'up' | 'down' | 'stable';
  lastUpdated: any;
}

interface MomentEngagement {
  momentTitle: string;
  category: string;
  responseRate: number;
  lastEngagement: any;
  totalInteractions: number;
}

interface FeedbackAnalysis {
  sentimentScore: number;
  responseQuality: number;
  improvementAreas: string[];
  trends: any;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

const ReportsAndInsightsTab: React.FC<ReportsAndInsightsTabProps> = ({ uid }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPersonalWellbeing, setShowPersonalWellbeing] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Data states
  const [jsiData, setJsiData] = useState<JSIScore | null>(null);
  const [jsiHistory, setJsiHistory] = useState<any[]>([]);
  const [traitsData, setTraitsData] = useState<TraitData[]>([]);
  const [momentsData, setMomentsData] = useState<MomentEngagement[]>([]);
  const [feedbackData, setFeedbackData] = useState<FeedbackAnalysis | null>(null);
  const [learningData, setLearningData] = useState<any>(null);
  const [selfImprovementData, setSelfImprovementData] = useState<any>(null);

  useEffect(() => {
    if (uid) {
      fetchAllData();
    }
  }, [uid]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchJSIData(),
        fetchTraitsData(),
        fetchMomentsData(),
        fetchFeedbackData(),
        fetchLearningData(),
        fetchSelfImprovementData(),
      ]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchJSIData = async () => {
    try {
      // Fetch current JSI score
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        if (userData.jsiScore) {
          setJsiData(userData.jsiScore);
        }
      }

      // Fetch JSI history
      const jsiHistoryQuery = query(
        collection(db, 'jsiScores'),
        where('userId', '==', uid),
        orderBy('lastUpdated', 'desc'),
        limit(12)
      );
      const jsiHistorySnap = await getDocs(jsiHistoryQuery);
      const history = jsiHistorySnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: doc.data().lastUpdated?.toDate?.() || new Date()
      }));
      setJsiHistory(history);
    } catch (error) {
      console.error('Error fetching JSI data:', error);
    }
  };

  const fetchTraitsData = async () => {
    try {
      // Fetch user traits
      const traitsRef = doc(db, 'user_traits', uid);
      const traitsSnap = await getDoc(traitsRef);
      if (traitsSnap.exists()) {
        const traits = traitsSnap.data();
        const traitsArray = Object.entries(traits.traits || {}).map(([name, score]) => ({
          name,
          score: score as number,
          confidence: 0.8, // Mock confidence
          trend: 'stable' as const,
          lastUpdated: traits.lastUpdated
        }));
        setTraitsData(traitsArray);
      }
    } catch (error) {
      console.error('Error fetching traits data:', error);
    }
  };

  const fetchMomentsData = async () => {
    try {
      // Fetch moment engagement data
      const momentsQuery = query(
        collection(db, 'moment_analysis'),
        where('userId', '==', uid),
        orderBy('timestamp', 'desc'),
        limit(10)
      );
      const momentsSnap = await getDocs(momentsQuery);
      const moments = momentsSnap.docs.map(doc => ({
        momentTitle: doc.data().momentTitle || 'Unknown Moment',
        category: doc.data().category || 'general',
        responseRate: doc.data().userEngagement || 0,
        lastEngagement: doc.data().timestamp,
        totalInteractions: doc.data().totalInteractions || 1
      }));
      setMomentsData(moments);
    } catch (error) {
      console.error('Error fetching moments data:', error);
    }
  };

  const fetchFeedbackData = async () => {
    try {
      // Fetch feedback analysis
      const feedbackQuery = query(
        collection(db, 'feedback_analysis'),
        where('userId', '==', uid),
        orderBy('timestamp', 'desc'),
        limit(1)
      );
      const feedbackSnap = await getDocs(feedbackQuery);
      if (!feedbackSnap.empty) {
        const feedback = feedbackSnap.docs[0].data();
        setFeedbackData({
          sentimentScore: feedback.sentimentScore || 0.5,
          responseQuality: feedback.responseQuality || 0.7,
          improvementAreas: feedback.improvementAreas || [],
          trends: feedback.trends || {}
        });
      }
    } catch (error) {
      console.error('Error fetching feedback data:', error);
    }
  };

  const fetchLearningData = async () => {
    try {
      // Fetch learning analytics
      const learningQuery = query(
        collection(db, 'userLearningBoosts'),
        where('userId', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(20)
      );
      const learningSnap = await getDocs(learningQuery);
      const learning = learningSnap.docs.map(doc => doc.data());
      
      if (learning.length > 0) {
        const completed = learning.filter(l => l.status === 'completed').length;
        const total = learning.length;
        const avgRating = learning.reduce((sum, l) => sum + (l.rating || 0), 0) / total;
        
        setLearningData({
          totalBoosts: total,
          completedBoosts: completed,
          completionRate: total > 0 ? (completed / total) * 100 : 0,
          averageRating: avgRating,
          recentActivity: learning.slice(0, 5)
        });
      }
    } catch (error) {
      console.error('Error fetching learning data:', error);
    }
  };

  const fetchSelfImprovementData = async () => {
    try {
      // Fetch self-improvement data
      const improvementQuery = query(
        collection(db, 'selfImprovementReports'),
        where('userId', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(1)
      );
      const improvementSnap = await getDocs(improvementQuery);
      if (!improvementSnap.empty) {
        const improvement = improvementSnap.docs[0].data();
        setSelfImprovementData(improvement);
      }
    } catch (error) {
      console.error('Error fetching self-improvement data:', error);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'high': return '#f44336';
      case 'medium': return '#ff9800';
      case 'low': return '#4caf50';
      default: return '#757575';
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUp color="success" />;
      case 'down': return <TrendingDown color="error" />;
      case 'stable': return <TrendingFlat color="disabled" />;
      default: return <TrendingFlat color="disabled" />;
    }
  };

  const exportToCSV = async (dataType: string) => {
    setExporting(true);
    try {
      let csvData = '';
      let filename = '';

      switch (dataType) {
        case 'jsi':
          if (jsiData && jsiHistory.length > 0) {
            csvData = 'Date,Overall Score,Work Engagement,Career Alignment,Manager Relationship,Personal Wellbeing,Job Mobility,Risk Level,Trend\n';
            jsiHistory.forEach(item => {
              csvData += `${item.date.toISOString().split('T')[0]},${item.overallScore},${item.workEngagement},${item.careerAlignment},${item.managerRelationship},${item.personalWellbeing},${item.jobMobility},${item.riskLevel},${item.trend}\n`;
            });
            filename = `jsi_report_${uid}_${new Date().toISOString().split('T')[0]}.csv`;
          }
          break;

        case 'traits':
          if (traitsData.length > 0) {
            csvData = 'Trait Name,Score,Confidence,Trend,Last Updated\n';
            traitsData.forEach(trait => {
              csvData += `${trait.name},${trait.score},${trait.confidence},${trait.trend},${trait.lastUpdated?.toDate?.().toISOString() || 'Unknown'}\n`;
            });
            filename = `traits_report_${uid}_${new Date().toISOString().split('T')[0]}.csv`;
          }
          break;

        case 'moments':
          if (momentsData.length > 0) {
            csvData = 'Moment Title,Category,Response Rate,Total Interactions,Last Engagement\n';
            momentsData.forEach(moment => {
              csvData += `${moment.momentTitle},${moment.category},${moment.responseRate},${moment.totalInteractions},${moment.lastEngagement?.toDate?.().toISOString() || 'Unknown'}\n`;
            });
            filename = `moments_report_${uid}_${new Date().toISOString().split('T')[0]}.csv`;
          }
          break;

        case 'feedback':
          if (feedbackData) {
            csvData = 'Metric,Value\n';
            csvData += `Sentiment Score,${feedbackData.sentimentScore}\n`;
            csvData += `Response Quality,${feedbackData.responseQuality}\n`;
            csvData += `Improvement Areas,${feedbackData.improvementAreas.join('; ')}\n`;
            filename = `feedback_report_${uid}_${new Date().toISOString().split('T')[0]}.csv`;
          }
          break;

        case 'learning':
          if (learningData) {
            csvData = 'Metric,Value\n';
            csvData += `Total Boosts,${learningData.totalBoosts}\n`;
            csvData += `Completed Boosts,${learningData.completedBoosts}\n`;
            csvData += `Completion Rate,${learningData.completionRate}%\n`;
            csvData += `Average Rating,${learningData.averageRating}\n`;
            filename = `learning_report_${uid}_${new Date().toISOString().split('T')[0]}.csv`;
          }
          break;

        case 'all':
          // Export all data in separate sheets
          csvData = 'Report Type,Data\n';
          if (jsiData) csvData += `JSI Score,${jsiData.overallScore}\n`;
          if (traitsData.length > 0) csvData += `Traits Count,${traitsData.length}\n`;
          if (momentsData.length > 0) csvData += `Moments Count,${momentsData.length}\n`;
          if (feedbackData) csvData += `Feedback Available,Yes\n`;
          if (learningData) csvData += `Learning Available,Yes\n`;
          filename = `complete_report_${uid}_${new Date().toISOString().split('T')[0]}.csv`;
          break;
      }

      if (csvData) {
        const blob = new Blob([csvData], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error exporting CSV:', error);
    } finally {
      setExporting(false);
      setExportDialogOpen(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h6">Reports & Insights</Typography>
        <Button
          variant="outlined"
          startIcon={<Download />}
          onClick={() => setExportDialogOpen(true)}
        >
          Export Data
        </Button>
      </Box>

      <Tabs value={activeTab} onChange={handleTabChange} sx={{ mb: 3 }}>
        <Tab label="Overview" icon={<Assessment />} />
        <Tab label="Job Satisfaction" icon={<Psychology />} />
        <Tab label="Traits & Behavior" icon={<Timeline />} />
        <Tab label="Engagement" icon={<Feedback />} />
        <Tab label="Learning" icon={<School />} />
        <Tab label="Self-Improvement" icon={<AutoFixHigh />} />
      </Tabs>

      {activeTab === 0 && (
        <Grid container spacing={3}>
          {/* Overview Dashboard */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Current JSI Score
                </Typography>
                {jsiData ? (
                  <Box>
                    <Typography variant="h3" color="primary">
                      {jsiData.overallScore}
                    </Typography>
                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                      <Chip 
                        label={jsiData.riskLevel.toUpperCase()} 
                        color={jsiData.riskLevel === 'high' ? 'error' : jsiData.riskLevel === 'medium' ? 'warning' : 'success'}
                        size="small"
                      />
                      {getTrendIcon(jsiData.trend)}
                    </Box>
                  </Box>
                ) : (
                  <Typography color="text.secondary">No JSI data available</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Key Traits Summary
                </Typography>
                {traitsData.length > 0 ? (
                  <Box>
                    <Typography variant="h3" color="secondary">
                      {traitsData.length}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Active traits tracked
                    </Typography>
                    <Box display="flex" flexWrap="wrap" gap={1} mt={2}>
                      {traitsData.slice(0, 3).map((trait) => (
                        <Chip 
                          key={trait.name} 
                          label={`${trait.name}: ${trait.score}`} 
                          size="small" 
                          variant="outlined"
                        />
                      ))}
                    </Box>
                  </Box>
                ) : (
                  <Typography color="text.secondary">No traits data available</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Recent Activity Summary
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">Moments Engaged</Typography>
                    <Typography variant="h6">{momentsData.length}</Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">Learning Completion</Typography>
                    <Typography variant="h6">
                      {learningData ? `${learningData.completionRate.toFixed(1)}%` : 'N/A'}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">Feedback Sentiment</Typography>
                    <Typography variant="h6">
                      {feedbackData ? `${(feedbackData.sentimentScore * 100).toFixed(0)}%` : 'N/A'}
                    </Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {activeTab === 1 && (
        <Grid container spacing={3}>
          {/* JSI Analysis */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <Typography variant="h6">JSI Score Breakdown</Typography>
                  <Tooltip title={showPersonalWellbeing ? "Hide Personal Wellbeing" : "Show Personal Wellbeing"}>
                    <IconButton onClick={() => setShowPersonalWellbeing(!showPersonalWellbeing)}>
                      {showPersonalWellbeing ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </Tooltip>
                </Box>
                {jsiData ? (
                  <Box>
                    <Box mb={2}>
                      <Typography variant="body2" gutterBottom>Work Engagement</Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={jsiData.workEngagement} 
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                      <Typography variant="caption">{jsiData.workEngagement}/100</Typography>
                    </Box>
                    <Box mb={2}>
                      <Typography variant="body2" gutterBottom>Career Alignment</Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={jsiData.careerAlignment} 
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                      <Typography variant="caption">{jsiData.careerAlignment}/100</Typography>
                    </Box>
                    <Box mb={2}>
                      <Typography variant="body2" gutterBottom>Manager Relationship</Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={jsiData.managerRelationship} 
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                      <Typography variant="caption">{jsiData.managerRelationship}/100</Typography>
                    </Box>
                    {showPersonalWellbeing && (
                      <Box mb={2}>
                        <Typography variant="body2" gutterBottom>Personal Wellbeing</Typography>
                        <LinearProgress 
                          variant="determinate" 
                          value={jsiData.personalWellbeing} 
                          sx={{ height: 8, borderRadius: 4 }}
                        />
                        <Typography variant="caption">{jsiData.personalWellbeing}/100</Typography>
                      </Box>
                    )}
                    <Box mb={2}>
                      <Typography variant="body2" gutterBottom>Job Mobility</Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={jsiData.jobMobility} 
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                      <Typography variant="caption">{jsiData.jobMobility}/100</Typography>
                    </Box>
                  </Box>
                ) : (
                  <Typography color="text.secondary">No JSI data available</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>JSI Trends</Typography>
                {jsiHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={jsiHistory}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis domain={[0, 100]} />
                      <RechartsTooltip />
                      <Line type="monotone" dataKey="overallScore" stroke="#8884d8" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Typography color="text.secondary">No trend data available</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {activeTab === 2 && (
        <Grid container spacing={3}>
          {/* Traits Analysis */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Current Trait Profile</Typography>
                {traitsData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={traitsData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis domain={[0, 10]} />
                      <RechartsTooltip />
                      <Bar dataKey="score" fill="#8884d8" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Typography color="text.secondary">No traits data available</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Trait Details</Typography>
                {traitsData.length > 0 ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Trait</TableCell>
                          <TableCell>Score</TableCell>
                          <TableCell>Confidence</TableCell>
                          <TableCell>Trend</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {traitsData.map((trait) => (
                          <TableRow key={trait.name}>
                            <TableCell>{trait.name}</TableCell>
                            <TableCell>{trait.score}/10</TableCell>
                            <TableCell>{(trait.confidence * 100).toFixed(0)}%</TableCell>
                            <TableCell>{getTrendIcon(trait.trend)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Typography color="text.secondary">No traits data available</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {activeTab === 3 && (
        <Grid container spacing={3}>
          {/* Engagement Analysis */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Moment Engagement</Typography>
                {momentsData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={momentsData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="momentTitle" />
                      <YAxis domain={[0, 100]} />
                      <RechartsTooltip />
                      <Bar dataKey="responseRate" fill="#82ca9d" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Typography color="text.secondary">No engagement data available</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Engagement Details</Typography>
                {momentsData.length > 0 ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Moment</TableCell>
                          <TableCell>Category</TableCell>
                          <TableCell>Response Rate</TableCell>
                          <TableCell>Interactions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {momentsData.map((moment, index) => (
                          <TableRow key={index}>
                            <TableCell>{moment.momentTitle}</TableCell>
                            <TableCell>{moment.category}</TableCell>
                            <TableCell>{(moment.responseRate * 100).toFixed(0)}%</TableCell>
                            <TableCell>{moment.totalInteractions}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Typography color="text.secondary">No engagement data available</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {activeTab === 4 && (
        <Grid container spacing={3}>
          {/* Learning Analytics */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Learning Progress</Typography>
                {learningData ? (
                  <Box>
                    <Box mb={3}>
                      <Typography variant="body2" gutterBottom>Completion Rate</Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={learningData.completionRate} 
                        sx={{ height: 12, borderRadius: 6 }}
                      />
                      <Typography variant="caption">{learningData.completionRate.toFixed(1)}%</Typography>
                    </Box>
                    <Grid container spacing={2}>
                      <Grid item xs={6}>
                        <Typography variant="h4" color="primary">{learningData.totalBoosts}</Typography>
                        <Typography variant="body2">Total Boosts</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="h4" color="success.main">{learningData.completedBoosts}</Typography>
                        <Typography variant="body2">Completed</Typography>
                      </Grid>
                    </Grid>
                    <Box mt={2}>
                      <Typography variant="body2" gutterBottom>Average Rating</Typography>
                      <Typography variant="h6">{learningData.averageRating.toFixed(1)}/5</Typography>
                    </Box>
                  </Box>
                ) : (
                  <Typography color="text.secondary">No learning data available</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Recent Learning Activity</Typography>
                {learningData?.recentActivity ? (
                  <Box>
                    {learningData.recentActivity.map((activity: any, index: number) => (
                      <Box key={index} mb={2} p={2} border={1} borderColor="grey.300" borderRadius={1}>
                        <Typography variant="body2" fontWeight="bold">
                          {activity.contentTitle || 'Learning Activity'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Status: {activity.status} | Rating: {activity.rating || 'N/A'}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Typography color="text.secondary">No recent activity</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {activeTab === 5 && (
        <Grid container spacing={3}>
          {/* Self-Improvement */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Self-Improvement Analysis</Typography>
                {selfImprovementData ? (
                  <Box>
                    <Grid container spacing={3}>
                      <Grid item xs={12} md={4}>
                        <Typography variant="h4" color="primary">
                          {selfImprovementData.recommendations?.length || 0}
                        </Typography>
                        <Typography variant="body2">Active Recommendations</Typography>
                      </Grid>
                      <Grid item xs={12} md={4}>
                        <Typography variant="h4" color="secondary">
                          {selfImprovementData.totalTraits || 0}
                        </Typography>
                        <Typography variant="body2">Traits Analyzed</Typography>
                      </Grid>
                      <Grid item xs={12} md={4}>
                        <Typography variant="h4" color="success.main">
                          {selfImprovementData.needsImprovement?.length || 0}
                        </Typography>
                        <Typography variant="body2">Areas for Improvement</Typography>
                      </Grid>
                    </Grid>
                    {selfImprovementData.recommendations && (
                      <Box mt={3}>
                        <Typography variant="h6" gutterBottom>Recommendations</Typography>
                        {selfImprovementData.recommendations.map((rec: string, index: number) => (
                          <Box key={index} mb={1} p={2} bgcolor="grey.50" borderRadius={1}>
                            <Typography variant="body2">{rec}</Typography>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                ) : (
                  <Typography color="text.secondary">No self-improvement data available</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Export Dialog */}
      <Dialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)}>
        <DialogTitle>Export Data</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            Select the data you would like to export as CSV:
          </Typography>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => exportToCSV('jsi')}
                disabled={!jsiData || exporting}
              >
                Export JSI Data
              </Button>
            </Grid>
            <Grid item xs={12}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => exportToCSV('traits')}
                disabled={traitsData.length === 0 || exporting}
              >
                Export Traits Data
              </Button>
            </Grid>
            <Grid item xs={12}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => exportToCSV('moments')}
                disabled={momentsData.length === 0 || exporting}
              >
                Export Engagement Data
              </Button>
            </Grid>
            <Grid item xs={12}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => exportToCSV('feedback')}
                disabled={!feedbackData || exporting}
              >
                Export Feedback Data
              </Button>
            </Grid>
            <Grid item xs={12}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => exportToCSV('learning')}
                disabled={!learningData || exporting}
              >
                Export Learning Data
              </Button>
            </Grid>
            <Grid item xs={12}>
              <Button
                fullWidth
                variant="contained"
                onClick={() => exportToCSV('all')}
                disabled={exporting}
              >
                Export All Data
              </Button>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExportDialogOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ReportsAndInsightsTab; 