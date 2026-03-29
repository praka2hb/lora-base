/**
 * ScriptWriterAgent — Writes scripts using personality-matched templates
 *
 * Receives a ContentStrategy that specifies exactly:
 *   - Which template to use (provocateur/storyteller/educator/reactor)
 *   - What hook style to open with
 *   - Whether this is a continuation, reaction, story beat, or wildcard
 *   - Specific directive from the strategy agent
 *
 * Uses xAI Grok for authentic voice/style.
 */

import type {
  PipelineContext,
  VideoScript,
  ScriptSection,
  ScriptTemplate,
  HookStyle,
} from './types.js';
import { PipelineError } from './types.js';
import { withRetry } from './retry.js';
import { WOJAK_SCRIPT_VOICE } from '../wojak-style.js';

const XAI_API = 'https://api.x.ai/v1/responses';

// ── Template Structures ──────────────────────────────────────────────────────

const TEMPLATE_STRUCTURES: Record<ScriptTemplate, string> = {
  provocateur: `THE PROVOCATEUR — Bold claims, proof, mic drop.
Structure:
- HOOK (2-3s): Open with a controversial or bold claim. Make people stop scrolling because they disagree or can't believe it.
- PROOF (3-5s): Hit them with 1-2 undeniable facts that back up the claim. Be specific with numbers or examples.
- MIC DROP (2-3s): End with a definitive statement that reframes everything. No soft landing — drop the mic.
Voice: Confident, unapologetic, slightly confrontational. Short punchy sentences. Never hedge.`,

  storyteller: `THE STORYTELLER — Tension, reveal, cliffhanger.
Structure:
- SETUP (2-3s): "So this happened..." or "I need to tell you something..." — pull them into a story immediately.
- BUILD (4-6s): Escalate the tension. Add details that make people NEED to know what happens next. Use "and then..." beats.
- REVEAL/CLIFFHANGER (2-3s): Either deliver a satisfying twist OR cut off with "...and that's when everything changed. Part 2 tomorrow."
Voice: Intimate, like telling a friend a secret. Varied pace — slow for tension, fast for excitement.`,

  educator: `THE EDUCATOR — Mind-blown, deeper truth, call to learn more.
Structure:
- MIND-BLOW (2-3s): Open with a fact so surprising it creates cognitive dissonance. "Did you know..." but make it genuinely shocking.
- "BUT WAIT" (3-5s): Reveal the deeper truth behind the fact. "But here's what nobody tells you..." The real insight that changes how they see the topic.
- PAYOFF (2-3s): Connect it to their life or end with "Follow for part 2 where I explain [the even crazier thing]."
Voice: Enthusiastic but credible. Like a brilliant friend explaining something cool at dinner. Not lecturing.`,

  reactor: `THE REACTOR — See it, react, hot take.
Structure:
- THE THING (2s): Show/describe the thing you're reacting to. Be vivid. "So [person/brand] just [did this thing]..."
- GENUINE REACTION (3-4s): Your authentic, unfiltered response. This is where personality shines. Exaggerate slightly for entertainment.
- HOT TAKE (2-3s): Your actual opinion — make it spicy enough to generate comments. End with "What do you think?" or a strong stance.
Voice: Raw, unfiltered, energetic. Feel like you're watching someone process something in real-time.`,
};

// ── Hook Templates ───────────────────────────────────────────────────────────

const HOOK_TEMPLATES: Record<HookStyle, string> = {
  pattern_interrupt: `HOOK STYLE: Pattern Interrupt
Open by breaking the scroll pattern. Examples:
- "Stop scrolling. This is important."
- "Wait wait wait — did you see this?"
- "I wasn't going to post this but..."
The first words must CREATE A REASON to stay.`,

  identity_callout: `HOOK STYLE: Identity Call-out
Open by speaking directly to a specific type of person. Examples:
- "If you're still doing [thing], we need to talk."
- "This is for my [niche] people who..."
- "Every [type of person] needs to hear this."
Makes the viewer feel personally addressed.`,

  curiosity_gap: `HOOK STYLE: Curiosity Gap
Open by creating an information gap they MUST close. Examples:
- "Nobody's talking about this but..."
- "There's a reason [thing] keeps happening and it's not what you think."
- "I just found out something about [topic] that changes everything."
Promise value without delivering it yet.`,

  controversy: `HOOK STYLE: Controversy
Open with a take that will make people react. Examples:
- "This is gonna make people mad but..."
- "[Popular thing] is a scam and here's proof."
- "I don't care what anyone says — [bold claim]."
The controversy must be RELEVANT to the topic, not random rage-bait.`,

  cliffhanger_payoff: `HOOK STYLE: Cliffhanger Payoff
Open by referencing a previous unfinished story. Examples:
- "Remember when I said [thing]? Here's what happened."
- "Part 2. You asked for it."
- "I promised I'd tell you the rest. Here it is."
Immediately reward returning viewers.`,
};

export async function scriptWriterAgent(ctx: PipelineContext): Promise<VideoScript> {
  if (!ctx.searchResults) {
    throw new PipelineError('ScriptWriterAgent requires searchResults in context', 'script-writer');
  }
  if (!ctx.strategy) {
    throw new PipelineError('ScriptWriterAgent requires strategy in context', 'script-writer');
  }

  const { query, config, searchResults, influencer, strategy, contentHistory } = ctx;
  const targetDuration = config.scriptTargetDuration ?? 8;
  const startMs = Date.now();

  config.onProgress?.({ stage: 'writing-script', message: `Writing ${strategy.template} script as ${influencer.name}` });

  // Build influencer voice
  const personality = [
    influencer.persona ? `Background: ${influencer.persona}` : null,
    influencer.context ? `Niche/Topic: ${influencer.context}` : null,
    influencer.tone ? `Tone: ${influencer.tone}` : null,
    influencer.speaking_style ? `Speaking style: ${influencer.speaking_style}` : null,
    influencer.personality_traits?.length
      ? `Personality traits: ${influencer.personality_traits.join(', ')}`
      : null,
  ].filter(Boolean).join('\n');

  const researchContext = [
    `Topic: ${query}`,
    `Research: ${searchResults.synthesis}`,
    `Key Facts:\n${searchResults.keyFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`,
  ].join('\n\n');

  // Previous scripts context (avoid repetition)
  const prevScripts = (contentHistory ?? []).slice(0, 5);
  const avoidContext = prevScripts.length > 0
    ? `\nDO NOT repeat these recent topics/hooks:\n${prevScripts.map(h => `- "${h.script_title}" (${h.hook_style} hook)`).join('\n')}\n`
    : '';

  const wordBudget = Math.round(targetDuration * 2.5);

  // Determine if we should add a cliffhanger (30% chance for storyteller/educator, 10% for others)
  const cliffhangerChance = strategy.template === 'storyteller' ? 0.35
    : strategy.template === 'educator' ? 0.30
    : 0.12;
  const shouldCliffhanger = Math.random() < cliffhangerChance && strategy.contentType !== 'continuation';

  const systemPrompt = `You write ultra-short video scripts for TikTok/Reels/Shorts.
You ARE this character — write in first person, in their exact voice.

${WOJAK_SCRIPT_VOICE}

CHARACTER:
${personality}

TEMPLATE TO FOLLOW:
${TEMPLATE_STRUCTURES[strategy.template]}

HOOK TO USE:
${HOOK_TEMPLATES[strategy.hookStyle]}

${strategy.continuationContext ? `CONTINUATION: This video picks up from a previous cliffhanger: "${strategy.continuationContext}". Open by referencing it.` : ''}

${shouldCliffhanger ? `CLIFFHANGER: End this video on an intentional cliffhanger. Leave the story/argument unfinished. Tease what comes next. The audience should NEED part 2.` : ''}

STRATEGY DIRECTIVE:
${strategy.directive}

CONSTRAINTS:
- EXACTLY ${targetDuration} seconds. Word budget: ~${wordBudget} words. Do NOT exceed.
- Every word earns its place. Ruthlessly concise.
- If this is a real person, write in their ACTUAL voice/mannerisms.
${avoidContext}
Respond with valid JSON only, no markdown fences.`;

  const userPrompt = `Write the ${targetDuration}-second ${strategy.template} script about: "${query}"

Research:
${researchContext}

Return JSON:
{
  "title": "catchy title (max 60 chars)",
  "tone": "${influencer.tone || 'casual'}",
  "hookLine": "the exact opening line/hook",
  "hasCliffhanger": ${shouldCliffhanger},
  ${shouldCliffhanger ? '"cliffhangerText": "the cliffhanger setup text that teases the next video",' : '"cliffhangerText": null,'}
  "totalDurationSeconds": ${targetDuration},
  "sections": [
    {
      "id": "s1",
      "type": "intro",
      "title": "hook",
      "content": "exact narration (KEEP SHORT)",
      "durationSeconds": 3,
      "visualNotes": "what to show"
    }
  ]
}

Section durations MUST sum to EXACTLY ${targetDuration}s. Total ~${wordBudget} words.`;

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
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!res.ok) throw new Error(`Grok script writer failed: ${res.status}`);
      return res.json();
    },
    { maxRetries: 3, baseDelayMs: 3000, label: 'ScriptWriter Grok' }
  );

  const text = response.output?.find((o: { type: string }) => o.type === 'message')
    ?.content?.find((c: { type: string }) => c.type === 'output_text')?.text ?? '';

  let parsed: any;
  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
  } catch {
    throw new PipelineError('ScriptWriterAgent returned invalid JSON', 'script-writer');
  }

  if (!parsed.sections?.length) {
    throw new PipelineError('ScriptWriterAgent returned no sections', 'script-writer');
  }

  const sections: ScriptSection[] = parsed.sections.map((s: any, i: number) => ({
    id: s.id ?? `s${i + 1}`,
    type: s.type ?? 'main',
    title: s.title ?? `Section ${i + 1}`,
    content: s.content ?? '',
    durationSeconds: s.durationSeconds ?? Math.floor(targetDuration / parsed.sections.length),
    visualNotes: s.visualNotes,
  }));

  const fullText = sections.map(s => s.content).join(' ');
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;
  const totalDuration = sections.reduce((sum, s) => sum + s.durationSeconds, 0);
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;

  return {
    title: parsed.title ?? query,
    totalDurationSeconds: totalDuration,
    tone: (parsed.tone ?? influencer.tone ?? 'casual') as VideoScript['tone'],
    sections,
    fullText,
    wordCount,
    hookLine: parsed.hookLine ?? sections[0]?.content?.split('.')[0] ?? '',
    hasCliffhanger: parsed.hasCliffhanger ?? shouldCliffhanger,
    cliffhangerText: parsed.cliffhangerText ?? null,
    tokenUsage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    durationMs: Date.now() - startMs,
  };
}
