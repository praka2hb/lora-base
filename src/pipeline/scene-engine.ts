import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type { CharacterIdentity } from '../types.js';

const LOCATIONS = [
  'a busy city street',
  'a modern coffee shop',
  'a rooftop at sunset',
  'a neon-lit alleyway at night',
  'a cozy living room',
  'a sunny park bench',
  'a studio with ring light',
  'a beach at golden hour',
  'a bustling market',
  'a minimalist office space',
];

const SITUATIONS = [
  'reacting to surprising news',
  'sharing a life hack',
  'showing off a new outfit',
  'having a moment of realization',
  'giving a hot take',
  'vibing to music',
  'reviewing something unexpected',
  'doing a dramatic pause',
  'making a bold confession',
  'striking a confident pose',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateFromTemplate(character: CharacterIdentity): string {
  const location = pick(LOCATIONS);
  const situation = pick(SITUATIONS);
  return `${character.name} standing in ${location} ${situation}`;
}

async function generateWithClaude(character: CharacterIdentity): Promise<string> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey! });

  const systemPrompt = `You generate ultra-short scene descriptions for AI video generation.
Rules:
- Single location only
- One situation
- Max 2 actions
- No story progression
- Under 20 words
- Must be visually concrete (no abstract concepts)
- Output ONLY the scene description, nothing else

Character: ${character.name}
Persona: ${character.persona || 'content creator'}
Context: ${character.context || 'social media influencer'}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 80,
    temperature: 0.9,
    system: systemPrompt,
    messages: [
      { role: 'user', content: 'Generate one scene description.' },
    ],
  });

  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text.trim();
}

export async function generateScene(character: CharacterIdentity): Promise<string> {
  if (config.anthropicApiKey) {
    try {
      return await generateWithClaude(character);
    } catch (err) {
      console.warn('Claude scene generation failed, falling back to template:', err);
    }
  }
  return generateFromTemplate(character);
}
