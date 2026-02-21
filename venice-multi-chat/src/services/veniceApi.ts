import { ModelInfo } from '../types';

// API key from environment variable
const API_KEY = process.env.REACT_APP_VENICE_API_KEY || '';
const BASE_URL = 'https://api.venice.ai/api/v1';

if (!API_KEY) {
  console.error('REACT_APP_VENICE_API_KEY is not set. Please create a .env file with REACT_APP_VENICE_API_KEY=your-key-here');
}

export const fetchModels = async (): Promise<ModelInfo[]> => {
  try {
    // Fetch all models (text only) for the chat interface
    const response = await fetch(`${BASE_URL}/models?type=text`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching models:', error);
    return [];
  }
};

export const getDefaultModels = async (): Promise<Record<string, string>> => {
  try {
    const response = await fetch(`${BASE_URL}/models?type=text`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.data || {};
  } catch (error) {
    console.error('Error fetching default models:', error);
    return {};
  }
};