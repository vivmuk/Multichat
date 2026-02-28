import { ModelInfo } from '../types';

const BASE_URL = 'https://api.venice.ai/api/v1';

export const fetchModels = async (apiKey: string): Promise<ModelInfo[]> => {
  if (!apiKey) return [];
  try {
    const response = await fetch(`${BASE_URL}/models?type=text`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    // Only return text models (filter out any image/video that might slip through)
    const models: ModelInfo[] = data.data || [];
    return models.filter(m => m.type === 'text');
  } catch (error) {
    console.error('Error fetching models:', error);
    return [];
  }
};
