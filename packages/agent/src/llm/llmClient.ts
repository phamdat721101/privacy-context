import { geminiChatCompletion } from './gemini';
import { chatCompletion as openaiChatCompletion } from './openai';

export async function chatCompletion(systemPrompt: string, userMessage: string): Promise<string> {
  if (process.env.GEMINI_API_KEY) {
    return geminiChatCompletion(systemPrompt, userMessage);
  }
  return openaiChatCompletion(systemPrompt, userMessage);
}
