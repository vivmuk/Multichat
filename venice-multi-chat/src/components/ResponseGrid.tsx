import React from 'react';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ReactMarkdown from 'react-markdown';
import { ModelConfig } from '../types';
import { Message } from '../App';

interface ResponseGridProps {
  responses: Record<string, string>;
  loading: Record<string, boolean>;
  models: ModelConfig[];
  conversationHistory: Record<string, Message[]>;
  onClearConversation: (modelId: string) => void;
}

const ResponseGrid: React.FC<ResponseGridProps> = ({
  responses,
  loading,
  models,
  conversationHistory,
  onClearConversation
}) => {
  if (models.length === 0) {
    return (
      <Box sx={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        height: '100%', p: 3, bgcolor: 'background.paper', borderRadius: 3
      }}>
        <Typography variant="body2" color="text.secondary">
          Select models from the panel to see responses
        </Typography>
      </Box>
    );
  }

  return (
    <Grid container spacing={2}>
      {models.map((model) => {
        const history = conversationHistory[model.id] || [];
        const turnCount = Math.floor(history.length / 2);
        const isLoading = loading[model.id];
        const streamingContent = responses[model.id];

        return (
          <Grid item xs={12} md={6} lg={4} key={model.id}>
            <Paper elevation={2} sx={{
              height: '100%', display: 'flex', flexDirection: 'column',
              borderRadius: 3, overflow: 'hidden', minHeight: 280
            }}>
              {/* Card header */}
              <Box sx={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                px: 2, py: 1, borderBottom: '1px solid rgba(0,0,0,0.08)', flexShrink: 0
              }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                  {model.id}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                  <Chip label={`T: ${model.temperature.toFixed(1)}`} size="small"
                    sx={{ height: 18, fontSize: '0.68rem', bgcolor: 'rgba(0,0,0,0.05)' }} />
                  {model.webSearch && (
                    <Chip label="Web" size="small" color="primary"
                      sx={{ height: 18, fontSize: '0.68rem', bgcolor: 'rgba(63,81,181,0.1)', color: 'primary.main' }} />
                  )}
                  {turnCount > 0 && (
                    <Chip label={`${turnCount}t`} size="small"
                      sx={{ height: 18, fontSize: '0.68rem', bgcolor: 'rgba(16,185,129,0.1)', color: '#10b981' }} />
                  )}
                  {(turnCount > 0 || streamingContent) && (
                    <Tooltip title="Clear this conversation">
                      <IconButton size="small" onClick={() => onClearConversation(model.id)}
                        sx={{ p: 0.25, color: 'text.secondary', '&:hover': { color: 'error.main' } }}>
                        <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </Box>

              {/* Conversation body */}
              <Box sx={{ flex: 1, overflow: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {/* Render past turns from history */}
                {history.map((msg, idx) => {
                  const isUser = msg.role === 'user';
                  return (
                    <Box key={idx} sx={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                      {isUser ? (
                        <Box sx={{
                          bgcolor: 'primary.main', color: 'white',
                          borderRadius: '12px 12px 4px 12px',
                          px: 1.5, py: 0.75, maxWidth: '85%',
                          fontSize: '0.8rem', lineHeight: 1.4
                        }}>
                          {msg.content}
                        </Box>
                      ) : (
                        <Box sx={{
                          bgcolor: 'rgba(0,0,0,0.03)', borderRadius: '4px 12px 12px 12px',
                          px: 1.5, py: 0.75, width: '100%', fontSize: '0.82rem',
                          '& p': { mt: 0, mb: 1, fontSize: '0.82rem', lineHeight: 1.5 },
                          '& pre': { p: 1, borderRadius: 1, bgcolor: 'rgba(0,0,0,0.05)', fontSize: '0.76rem', overflow: 'auto' },
                          '& code': { fontSize: '0.76rem', bgcolor: 'rgba(0,0,0,0.05)', px: 0.4, borderRadius: 0.5 },
                          '& ul, & ol': { pl: 2.5, mb: 1 },
                          '& li': { mb: 0.3 },
                          '& h1, & h2, & h3': { fontSize: '0.9rem', fontWeight: 600, mt: 1, mb: 0.5 }
                        }}>
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </Box>
                      )}
                    </Box>
                  );
                })}

                {/* Streaming / loading state for the current turn */}
                {isLoading && !streamingContent && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                    <CircularProgress size={20} />
                  </Box>
                )}
                {isLoading && streamingContent && (
                  <Box sx={{
                    bgcolor: 'rgba(0,0,0,0.03)', borderRadius: '4px 12px 12px 12px',
                    px: 1.5, py: 0.75, width: '100%', fontSize: '0.82rem',
                    '& p': { mt: 0, mb: 1, fontSize: '0.82rem', lineHeight: 1.5 },
                    '& pre': { p: 1, borderRadius: 1, bgcolor: 'rgba(0,0,0,0.05)', fontSize: '0.76rem', overflow: 'auto' },
                    '& code': { fontSize: '0.76rem', bgcolor: 'rgba(0,0,0,0.05)', px: 0.4, borderRadius: 0.5 },
                    '& ul, & ol': { pl: 2.5, mb: 1 },
                    '& li': { mb: 0.3 },
                    '& h1, & h2, & h3': { fontSize: '0.9rem', fontWeight: 600, mt: 1, mb: 0.5 }
                  }}>
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
                    <Box component="span" sx={{
                      display: 'inline-block', width: 8, height: 14,
                      bgcolor: 'primary.main', ml: 0.5, verticalAlign: 'text-bottom',
                      animation: 'blink 1s step-end infinite',
                      '@keyframes blink': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0 } }
                    }} />
                  </Box>
                )}

                {/* Empty state */}
                {!isLoading && history.length === 0 && !streamingContent && (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 1, fontSize: '0.8rem' }}>
                    No response yet
                  </Typography>
                )}
              </Box>
            </Paper>
          </Grid>
        );
      })}
    </Grid>
  );
};

export default ResponseGrid;
