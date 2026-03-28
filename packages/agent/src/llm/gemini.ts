import { GoogleGenerativeAI } from '@google/generative-ai';

let _client: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (!_client) _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  return _client;
}

export async function geminiChatCompletion(systemPrompt: string, userMessage: string): Promise<string> {
  const model = getGeminiClient().getGenerativeModel({
    model: 'gemini-2.5-pro',
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent(userMessage);
  return result.response.text();
}
