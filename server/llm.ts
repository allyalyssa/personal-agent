import Anthropic from '@anthropic-ai/sdk'

export const client = new Anthropic()

export const MODEL = process.env.HANDLED_MODEL ?? 'claude-opus-5-5'
export const EFFORT = (process.env.HANDLED_EFFORT ?? 'medium') as 'low' | 'medium' | 'high'

// Server-side fallbacks re-run a refused request on another model inside the same call.
export const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }

export async function structured<T>(system: string, content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, any>): Promise<T> {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    system,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }]
  })
  if (res.stop_reason === 'refusal') throw new Error(`Model declined: ${res.stop_details?.explanation ?? 'no reason given'}`)
  const text = res.content.find(b => b.type === 'text')
  return JSON.parse(text!.type === 'text' ? text!.text : '{}')
}

export function imageBlock(dataUrl: string): Anthropic.Beta.BetaContentBlockParam {
  const [, mediaType, data] = dataUrl.match(/^data:([^;]+);base64,(.*)$/)!
  if (mediaType === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
  return { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data } }
}
