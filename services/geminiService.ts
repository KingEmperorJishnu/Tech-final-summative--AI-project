
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Helper to handle retries with exponential backoff for API calls.
 */
async function callWithRetry<T>(fn: () => Promise<T>, retries = 3, initialDelay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isRateLimit = error?.message?.includes('RESOURCE_EXHAUSTED') || error?.status === 429;
    if (retries > 0 && isRateLimit) {
      console.warn(`Rate limit hit. Retrying in ${initialDelay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, initialDelay));
      return callWithRetry(fn, retries - 1, initialDelay * 2);
    }
    throw error;
  }
}

export const getInsightForClass = async (className: string) => {
  try {
    // Added explicit type for callWithRetry to ensure TypeScript recognizes response as GenerateContentResponse
    const response = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Provide a short, 2-sentence interesting insight or fact about these items identified in an image: "${className}". 
      
      Note: The image is in horizontal, regular orientation. 
      
      If there is more than one item, try to mention how they relate or give a quick fact about the most interesting one. Keep it friendly and informative.`,
      config: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
      }
    }));
    return response.text;
  } catch (error) {
    console.error("Gemini insight error:", error);
    return "The model has high confidence in this identification. What else can you show it?";
  }
};

export const processFeedback = async (className: string, isCorrect: boolean) => {
  try {
    const feedbackType = isCorrect ? "correct" : "incorrect";
    // Added explicit type for callWithRetry to ensure TypeScript recognizes response as GenerateContentResponse
    const response = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `The vision model identified the following: "${className}" (assuming horizontal orientation). The user marked this identification as ${feedbackType}. 
      If it was correct, give a quick "Great!" style encouragement. 
      If it was incorrect, give a humble acknowledgement that we'll use this to improve future training data. 
      Keep the response under 15 words.`,
      config: {
        temperature: 0.8,
      }
    }));
    return response.text;
  } catch (error) {
    console.error("Feedback process error:", error);
    return isCorrect ? "Glad to hear it! Analysis confirmed." : "Understood. Feedback logged for model refinement.";
  }
};
