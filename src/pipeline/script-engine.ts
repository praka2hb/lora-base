import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type { CharacterIdentity } from '../types.js';

const HOOKS = [
  'Nobody talks about this but',
  'Wait, did you know',
  'This changed everything for me',
  'Stop scrolling, you need to hear this',
  'I can\'t believe this actually works',
  'POV: you just discovered',
  'Here\'s what they won\'t tell you',
  'Okay but why does nobody mention',
  'Real talk for a second',
  'Hot take incoming',
];

const PUNCHLINES = [
  'and it actually worked.',
  'you\'re welcome.',
  'try it and thank me later.',
  'let that sink in.',
  'mind blown.',
  'and I\'m not even sorry.',
  'game changer, honestly.',
  'no cap.',
  'this is the way.',
  'trust the process.',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateFromTemplate(character: CharacterIdentity): string {
  const hook = pick(HOOKS);
  const punchline = pick(PUNCHLINES);
  const topic = character.context || 'this hidden gem';
  return `${hook} ${topic} — ${punchline}`;
}

async function generateWithClaude(character: CharacterIdentity): Promise<string> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey! });

  const systemPrompt = `You write ultra-short scripts for short-form video content.
Rules:
- Max 2 sentences
- Under 25 words total
- Must have a strong hook (first 3 words must grab attention)
- Match the character's tone and style
- Output ONLY the script text, no quotes, labels, or explanations

Character: ${character.name}
Tone: ${character.tone || 'casual and energetic'}
Speaking style: ${character.speaking_style || 'direct and punchy'}
Personality: ${(character.personality_traits || []).join(', ') || 'confident, witty'}
Context: ${character.context || 'social media content'}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 80,
    temperature: 0.9,
    system: systemPrompt,
    messages: [
      { role: 'user', content: 'Write one script.' },
    ],
  });

  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text.trim();
}

export async function generateScript(character: CharacterIdentity): Promise<string> {
  if (config.anthropicApiKey) {
    try {
      return await generateWithClaude(character);
    } catch (err) {
      console.warn('Claude script generation failed, falling back to template:', err);
    }
  }
  return generateFromTemplate(character);
}
