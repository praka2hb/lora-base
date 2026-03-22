/**
 * WebSearchAgent — Finds trending/relevant content for the influencer's niche
 *
 * Uses Tavily for web search + Claude Sonnet for synthesis (reliable structured extraction).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { PipelineContext, SearchResult, SearchResults } from './types.js';
import { PipelineError } from './types.js';
import { calculateCost } from './cost.js';
import { withRetry } from './retry.js';

const TAVILY_API = 'https://api.tavily.com/search';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

export async function webSearchAgent(ctx: PipelineContext): Promise<SearchResults> {
  const { query, config, influencer } = ctx;
  const maxResults = config.searchMaxResults ?? 5;
  const startMs = Date.now();

  // Build a search query enriched with the influencer's niche
  const nicheContext = influencer.context ?? influencer.persona ?? '';
  const enrichedQuery = nicheContext
    ? `${query} ${nicheContext} trending`
    : query;

  config.onProgress?.({ stage: 'searching', message: `Searching: "${enrichedQuery}"` });

  // ── Step 1: Tavily Search ──────────────────────────────────────────────────

  let tavilyResults: TavilyResult[] = [];

  try {
    const response = await fetch(TAVILY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.tavilyApiKey}`,
      },
      body: JSON.stringify({
        query: enrichedQuery,
        max_results: maxResults,
        search_depth: 'advanced',
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      throw new PipelineError(
        `Tavily search failed: ${response.status} ${response.statusText}`,
        'web-search'
      );
    }

    const data = await response.json() as TavilyResponse;
    tavilyResults = data.results ?? [];
  } catch (err) {
    if (err instanceof PipelineError) throw err;
    throw new PipelineError(`Tavily request failed: ${String(err)}`, 'web-search', err);
  }

  if (tavilyResults.length === 0) {
    throw new PipelineError(`No search results for: "${enrichedQuery}"`, 'web-search');
  }

  config.onProgress?.({ stage: 'synthesizing', message: `Synthesizing ${tavilyResults.length} sources` });

  // ── Step 2: Claude Sonnet Synthesis (reliable structured extraction) ────────

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const targetDuration = config.scriptTargetDuration ?? 30;

  const searchContext = tavilyResults
    .map((r, i) => `[Source ${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
    .join('\n\n---\n\n');

  const synthesisResponse = await withRetry(
    () => client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are a research analyst preparing facts for a ${targetDuration}-second short-form video.
The video will be presented by an AI influencer character.
Extract only the most engaging, shareable, surprising facts.
Prioritize facts that work well for short-form video (TikTok/Reels style).
Respond with valid JSON only.`,
      messages: [{
        role: 'user',
        content: `Query: "${query}"
Influencer niche: ${nicheContext || 'general'}

Sources:
${searchContext}

Return JSON:
{
  "synthesis": "2-3 sentence overview of what's trending/interesting about this topic",
  "keyFacts": ["fact 1", "fact 2", "fact 3", "fact 4", "fact 5"],
  "primaryAngle": "the hook — most surprising angle for a viral short-form video"
}`,
      }],
    }),
    { maxRetries: 3, baseDelayMs: 3000, label: 'WebSearch Claude synthesis' }
  );

  let synthesis = '';
  let keyFacts: string[] = [];

  try {
    const text = synthesisResponse.content[0].type === 'text'
      ? synthesisResponse.content[0].text
      : '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
    synthesis = parsed.synthesis ?? '';
    keyFacts = parsed.keyFacts ?? [];
    if (parsed.primaryAngle) {
      synthesis = `${synthesis} Hook: ${parsed.primaryAngle}`;
    }
  } catch {
    synthesis = synthesisResponse.content[0].type === 'text'
      ? synthesisResponse.content[0].text.slice(0, 500)
      : '';
    keyFacts = tavilyResults.map(r => r.title);
  }

  const inputTokens = synthesisResponse.usage.input_tokens;
  const outputTokens = synthesisResponse.usage.output_tokens;

  const results: SearchResult[] = tavilyResults.map(r => ({
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
    publishedDate: r.published_date,
  }));

  return {
    query: enrichedQuery,
    results,
    synthesis,
    keyFacts,
    sources: results.map(r => r.url),
    tokenUsage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    durationMs: Date.now() - startMs,
  };
}
