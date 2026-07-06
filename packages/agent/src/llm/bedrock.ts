const REGION = process.env.BEDROCK_REGION ?? 'us-east-1';
// Same env contract as packages/api/services/chat.ts — cheapest Bedrock model
// (Amazon Nova Micro) via the unified Converse API. Flip BEDROCK_MODEL to any
// Anthropic / Meta / Mistral / Cohere ID without touching code.
const MODEL = process.env.BEDROCK_MODEL ?? 'amazon.nova-micro-v1:0';
const MAX_TOKENS = Math.max(256, Number(process.env.BEDROCK_MAX_OUTPUT_TOKENS ?? 4096));
const BEDROCK_URL = `https://bedrock-runtime.${REGION}.amazonaws.com/model/${MODEL}/converse`;

export async function bedrockChatCompletion(systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch(BEDROCK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.BEDROCK_API_KEY}`,
    },
    body: JSON.stringify({
      system: systemPrompt ? [{ text: systemPrompt }] : undefined,
      messages: [{ role: 'user', content: [{ text: userMessage }] }],
      inferenceConfig: { maxTokens: MAX_TOKENS },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bedrock API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.output?.message?.content?.[0]?.text ?? '';
}
