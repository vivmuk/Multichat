import { ModelInfo } from '../types';

// Updated API key aligned with latest working configuration
const API_KEY = 'lnWNeSg0pA_rQUooNpbfpPDBaj2vJnWol5WqKWrIEF';
const BASE_URL = 'https://api.venice.ai/api/v1';

export const fetchModels = async (): Promise<ModelInfo[]> => {
  try {
    // Use the standard models endpoint; traits info is included in model_spec
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