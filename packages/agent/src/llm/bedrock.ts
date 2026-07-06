const REGION = process.env.BEDROCK_REGION ?? 'us-east-1';
// Same env contract as packages/api/services/chat.ts — cheapest Claude by default.
const MODEL = process.env.BEDROCK_MODEL ?? 'anthropic.claude-3-haiku-20240307-v1:0';
const BEDROCK_URL = `https://bedrock-runtime.${REGION}.amazonaws.com/model/${MODEL}/invoke`;

export async function bedrockChatCompletion(systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch(BEDROCK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.BEDROCK_API_KEY}`,
    },
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bedrock API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}
