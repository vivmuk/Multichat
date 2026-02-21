import React, { useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import PromptInput from './components/PromptInput';
import ModelSelectionPanel from './components/ModelSelectionPanel';
import ResponseGrid from './components/ResponseGrid';
import { ModelConfig } from './types';

export type Message = { role: 'user' | 'assistant'; content: string };

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#3f51b5' },
    secondary: { main: '#f50057' },
    background: { default: '#f5f5f5', paper: '#ffffff' },
  },
  typography: { fontSize: 13 },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: { styleOverrides: { root: { textTransform: 'none', borderRadius: 12 } } },
    MuiPaper: { styleOverrides: { root: { borderRadius: 12 } } },
  },
});

function App() {
  const [prompt, setPrompt] = useState<string>('');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [selectedModels, setSelectedModels] = useState<ModelConfig[]>([]);
  const [conversationHistory, setConversationHistory] = useState<Record<string, Message[]>>({});

  const handlePromptSubmit = async (inputPrompt: string) => {
    if (!inputPrompt.trim() || selectedModels.length === 0) return;
    setPrompt(inputPrompt);

    const newLoadingState: Record<string, boolean> = {};
    selectedModels.forEach(model => { newLoadingState[model.id] = true; });
    setLoading(newLoadingState);
    setResponses({});

    await Promise.allSettled(selectedModels.map(model => fetchModelResponse(inputPrompt, model)));
  };

  const fetchModelResponse = async (inputPrompt: string, model: ModelConfig) => {
    try {
      const history = conversationHistory[model.id] || [];
      const newMessages: Message[] = [...history, { role: 'user', content: inputPrompt }];

      const response = await fetch('https://api.venice.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.REACT_APP_VENICE_API_KEY || ''}`
        },
        body: JSON.stringify({
          model: model.id,
          messages: newMessages,
          venice_parameters: { enable_web_search: model.webSearch ? 'on' : 'off' },
          max_tokens: model.maxTokens,
          temperature: model.temperature,
          stream: true
        })
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              setResponses(prev => ({ ...prev, [model.id]: fullContent }));
            }
          } catch { /* skip malformed chunk */ }
        }
      }

      // Append full exchange to this model's conversation history
      setConversationHistory(prev => ({
        ...prev,
        [model.id]: [
          ...(prev[model.id] || []),
          { role: 'user', content: inputPrompt },
          { role: 'assistant', content: fullContent }
        ]
      }));
    } catch (error) {
      console.error(`Error fetching response from ${model.id}:`, error);
      setResponses(prev => ({
        ...prev,
        [model.id]: `Error: Failed to get response from ${model.id}`
      }));
    } finally {
      setLoading(prev => ({ ...prev, [model.id]: false }));
    }
  };

  const clearConversation = (modelId?: string) => {
    if (modelId) {
      setConversationHistory(prev => { const n = { ...prev }; delete n[modelId]; return n; });
      setResponses(prev => { const n = { ...prev }; delete n[modelId]; return n; });
    } else {
      setConversationHistory({});
      setResponses({});
      setPrompt('');
    }
  };

  const totalTurns = Object.values(conversationHistory).reduce((sum, msgs) => sum + Math.floor(msgs.length / 2), 0);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth={false} sx={{ height: '100vh', py: 2 }}>
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h5" component="h1">
            Venice AI Multi-Chat
          </Typography>
          {totalTurns > 0 && (
            <Tooltip title="Clear all conversation history">
              <Button
                size="small"
                variant="outlined"
                color="error"
                onClick={() => clearConversation()}
                sx={{ fontSize: '0.75rem' }}
              >
                New Chat ({totalTurns} turn{totalTurns !== 1 ? 's' : ''})
              </Button>
            </Tooltip>
          )}
        </Box>

        <Box sx={{ display: 'flex', height: 'calc(100% - 80px)' }}>
          <Box sx={{ width: 300, mr: 2 }}>
            <ModelSelectionPanel
              selectedModels={selectedModels}
              setSelectedModels={setSelectedModels}
            />
          </Box>

          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <PromptInput onSubmit={handlePromptSubmit} />

            <Box sx={{ flex: 1, mt: 2, overflow: 'auto' }}>
              <ResponseGrid
                responses={responses}
                loading={loading}
                models={selectedModels}
                conversationHistory={conversationHistory}
                onClearConversation={clearConversation}
              />
            </Box>
          </Box>
        </Box>
      </Container>
    </ThemeProvider>
  );
}

export default App;
