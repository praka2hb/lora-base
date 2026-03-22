/**
 * ContentStrategyAgent — Decides WHAT to make before the script is written.
 *
 * Reads content history, analyzes personality traits, and picks:
 *   - Content type (continuation / reaction / story_beat / wildcard)
 *   - Script template (provocateur / storyteller / educator / reactor)
 *   - Hook style (pattern_interrupt / identity_callout / curiosity_gap / controversy / cliffhanger_payoff)
 *   - Narrative thread (ongoing series or standalone)
 *
 * Uses Grok for the decision — it understands content strategy and audience psychology.
 */

import type {
  PipelineContext,
  ContentStrategy,
  ContentType,
  ScriptTemplate,
  HookStyle,
} from './types.js';
import { PipelineError } from './types.js';
import { withRetry } from './retry.js';

const XAI_API = 'https://api.x.ai/v1/responses';

// ── Personality → Template Weights ───────────────────────────────────────────

const TRAIT_TEMPLATE_MAP: Record<string, ScriptTemplate> = {
  rebellious: 'provocateur', bold: 'provocateur', controversial: 'provocateur',
  sarcastic: 'provocateur', provocative: 'provocateur', edgy: 'provocateur',
  storytelling: 'storyteller', philosophical: 'storyteller', creative: 'storyteller',
  emotional: 'storyteller', dramatic: 'storyteller', narrative: 'storyteller',
  analytical: 'educator', knowledgeable: 'educator', technical: 'educator',
  informative: 'educator', scientific: 'educator', smart: 'educator',
  reactive: 'reactor', expressive: 'reactor', spontaneous: 'reactor',
  energetic: 'reactor', chaotic: 'reactor', entertaining: 'reactor',
};

// ── Content Type Weights by Template ─────────────────────────────────────────

const TEMPLATE_CONTENT_WEIGHTS: Record<ScriptTemplate, Record<ContentType, number>> = {
  provocateur: { reaction: 40, wildcard: 30, continuation: 20, story_beat: 10 },
  storyteller: { story_beat: 40, continuation: 30, wildcard: 20, reaction: 10 },
  educator:    { wildcard: 35, continuation: 30, reaction: 25, story_beat: 10 },
  reactor:     { reaction: 45, wildcard: 30, continuation: 15, story_beat: 10 },
};

// ── Hook Styles by Template ──────────────────────────────────────────────────

const TEMPLATE_HOOK_PREFERENCES: Record<ScriptTemplate, HookStyle[]> = {
  provocateur: ['controversy', 'pattern_interrupt', 'curiosity_gap'],
  storyteller: ['curiosity_gap', 'pattern_interrupt', 'identity_callout'],
  educator:    ['curiosity_gap', 'pattern_interrupt', 'identity_callout'],
  reactor:     ['pattern_interrupt', 'controversy', 'identity_callout'],
};

function inferTemplate(traits: string[] | null): ScriptTemplate {
  if (!traits?.length) return 'educator';

  const scores: Record<ScriptTemplate, number> = {
    provocateur: 0, storyteller: 0, educator: 0, reactor: 0,
  };

  for (const trait of traits) {
    const t = trait.toLowerCase().trim();
    const mapped = TRAIT_TEMPLATE_MAP[t];
    if (mapped) scores[mapped] += 1;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted[0][1] > 0 ? sorted[0][0] as ScriptTemplate : 'educator';
}

function weightedPick<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [key, weight] of entries) {
    r -= weight;
    if (r <= 0) return key;
  }
  return entries[0][0];
}

export async function contentStrategyAgent(ctx: PipelineContext): Promise<ContentStrategy> {
  const { query, config, influencer, contentHistory } = ctx;
  const startMs = Date.now();

  config.onProgress?.({ stage: 'strategizing', message: `Planning content strategy for ${influencer.name}` });

  const template = inferTemplate(influencer.personality_traits);
  const history = contentHistory ?? [];

  // Check for open cliffhangers
  const lastCliffhanger = history.find(h => h.has_cliffhanger && h.cliffhanger_text);
  const recentTopics = history.slice(0, 5).map(h => h.topic).filter(Boolean);
  const recentThreads = history.slice(0, 5).map(h => h.narrative_thread).filter(Boolean);
  const recentTypes = history.slice(0, 3).map(h => h.content_type);

  // Adjust weights based on history
  const weights = { ...TEMPLATE_CONTENT_WEIGHTS[template] };

  // Boost continuation if there's an open cliffhanger
  if (lastCliffhanger) {
    weights.continuation += 25;
  } else {
    weights.continuation = Math.max(weights.continuation - 10, 5);
  }

  // Reduce whatever was done in the last 2 posts to avoid monotony
  for (const recentType of recentTypes.slice(0, 2)) {
    if (recentType in weights) {
      weights[recentType as ContentType] = Math.max(weights[recentType as ContentType] * 0.5, 5);
    }
  }

  const contentType = weightedPick(weights);

  // Pick hook style — if continuing a cliffhanger, use cliffhanger_payoff
  let hookStyle: HookStyle;
  if (contentType === 'continuation' && lastCliffhanger) {
    hookStyle = 'cliffhanger_payoff';
  } else {
    const prefs = TEMPLATE_HOOK_PREFERENCES[template];
    hookStyle = prefs[Math.floor(Math.random() * prefs.length)];
  }

  // Build context for Grok to generate the specific directive
  const historyContext = history.length > 0
    ? history.slice(0, 8).map((h, i) =>
        `${i + 1}. [${h.content_type}] "${h.script_title}" — ${h.topic ?? 'general'}${h.has_cliffhanger ? ` (CLIFFHANGER: "${h.cliffhanger_text}")` : ''}${h.narrative_thread ? ` [thread: ${h.narrative_thread}]` : ''}`
      ).join('\n')
    : 'No previous content — this is the first video.';

  const response = await withRetry(
    async () => {
      const res = await fetch(XAI_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.xaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-3-mini',
          store: false,
          input: [
            {
              role: 'system',
              content: `You are a content strategist for short-form video (TikTok/Reels). You decide what content to make next based on the creator's personality, content history, and audience psychology. Be specific and actionable.

Respond with valid JSON only, no markdown fences.`,
            },
            {
              role: 'user',
              content: `Creator: ${influencer.name}
Personality: ${influencer.personality_traits?.join(', ') ?? 'unknown'}
Persona: ${influencer.persona ?? 'not set'}
Niche: ${influencer.context ?? 'general'}
Tone: ${influencer.tone ?? 'casual'}
Speaking style: ${influencer.speaking_style ?? 'conversational'}

Content type chosen: ${contentType}
Template: ${template} (${templateDescription(template)})
Hook style: ${hookStyle} (${hookDescription(hookStyle)})
Current topic/query: "${query}"

Content history (most recent first):
${historyContext}

${contentType === 'continuation' && lastCliffhanger
  ? `OPEN CLIFFHANGER from last video: "${lastCliffhanger.cliffhanger_text}"\nThe new video MUST pick up from this cliffhanger.`
  : ''}

Topics already covered recently: ${recentTopics.join(', ') || 'none'}
Active narrative threads: ${[...new Set(recentThreads)].join(', ') || 'none'}

Return JSON:
{
  "narrative_thread": "name of the ongoing thread (e.g. 'crypto rant series', 'day in my life') or null if standalone",
  "directive": "A specific 2-3 sentence instruction for the script writer. Include: what angle to take, what to open with, what to build toward, and how to end. Be VERY specific — don't say 'make a good video', say 'open with the claim that X is dead, prove why with 2 facts, end by asking if viewers agree'.",
  "reasoning": "1 sentence: why this content type + template + hook is the right move right now"
}`,
            },
          ],
        }),
      });

      if (!res.ok) throw new Error(`Grok strategy failed: ${res.status}`);
      return res.json();
    },
    { maxRetries: 2, baseDelayMs: 2000, label: 'ContentStrategy Grok' }
  );

  const text = response.output?.find((o: { type: string }) => o.type === 'message')
    ?.content?.find((c: { type: string }) => c.type === 'output_text')?.text ?? '{}';

  let parsed: { narrative_thread?: string | null; directive?: string; reasoning?: string };
  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
  } catch {
    parsed = {};
  }

  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;

  return {
    contentType,
    template,
    hookStyle,
    narrativeThread: parsed.narrative_thread ?? null,
    continuationContext: lastCliffhanger?.cliffhanger_text ?? null,
    directive: parsed.directive ?? `Create a ${contentType} video about "${query}" using the ${template} template with a ${hookStyle} hook.`,
    reasoning: parsed.reasoning ?? `${template} template with ${contentType} content type based on personality.`,
    tokenUsage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    durationMs: Date.now() - startMs,
  };
}

function templateDescription(t: ScriptTemplate): string {
  const d: Record<ScriptTemplate, string> = {
    provocateur: 'controversial claim → "here\'s why everyone\'s wrong" → proof → mic drop',
    storyteller: '"so this happened..." → build tension → reveal → cliffhanger',
    educator: 'mind-blowing fact → "but wait" → deeper truth → "follow for part 2"',
    reactor: 'show the thing → genuine reaction → hot take → call to action',
  };
  return d[t];
}

function hookDescription(h: HookStyle): string {
  const d: Record<HookStyle, string> = {
    pattern_interrupt: '"Stop scrolling if..."',
    identity_callout: '"If you\'re a [type of person]..."',
    curiosity_gap: '"Nobody talks about this but..."',
    controversy: '"This is gonna make people mad but..."',
    cliffhanger_payoff: '"Remember when I said...? Here\'s what happened"',
  };
  return d[h];
}
