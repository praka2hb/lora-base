/**
 * Agent Pipeline Orchestrator
 *
 * 4 agents:
 *   0. Content History  → load previous scripts for narrative continuity
 *   1. Content Strategy → decide content type, template, hook style
 *   2. Web Search       → trending facts (Tavily + Claude synthesis)
 *   3. Script Writer    → personality-matched script (Grok)
 *   4. Video Gen        → xAI Grok generates video
 *
 * After success, logs the script to influencer_content_log for future continuity.
 */

import { contentStrategyAgent } from './content-strategy-agent.js';
import { webSearchAgent } from './web-search-agent.js';
import { scriptWriterAgent } from './script-writer-agent.js';
import { videoGenAgent } from './video-gen-agent.js';
import { calculateCost, formatCost } from './cost.js';
import type {
  PipelineConfig,
  PipelineContext,
  AgentPipelineResult,
  AgentTrace,
} from './types.js';
import { PipelineError } from './types.js';
import type { CharacterIdentity } from '../types.js';
import { getContentHistory, logContent } from '../db.js';

export class AgentPipeline {
  private config: PipelineConfig;

  constructor(config: PipelineConfig) {
    this.validateConfig(config);
    this.config = config;
  }

  async run(query: string, influencer: CharacterIdentity): Promise<AgentPipelineResult> {
    if (!query?.trim()) throw new PipelineError('Query cannot be empty', 'pipeline');

    const startMs = Date.now();

    const ctx: PipelineContext = {
      query: query.trim(),
      influencer,
      config: this.config,
      startedAt: new Date(),
      traces: [],
    };

    // ── Step 0: Load Content History ───────────────────────────────────────
    console.log(`  [agent] Loading content history for ${influencer.name}`);
    this.config.onProgress?.({ stage: 'loading-history', message: `Loading content history` });
    try {
      ctx.contentHistory = await getContentHistory(influencer.id, 10);
      console.log(`  [agent] Found ${ctx.contentHistory.length} previous scripts`);
    } catch (err) {
      console.log(`  [agent] Content history unavailable, starting fresh`);
      ctx.contentHistory = [];
    }

    // ── Agent 1: Content Strategy (Grok) ─────────────────────────────────
    console.log(`  [agent] Content Strategy — deciding what to make`);
    ctx.strategy = await this.runAgent(
      ctx,
      'content-strategy',
      'Content Strategy Agent',
      () => contentStrategyAgent(ctx),
      (r) => `${r.contentType} / ${r.template} / ${r.hookStyle}`,
      (r) => `${r.directive.slice(0, 100)}...`,
      (r) => r.tokenUsage,
      (r) => calculateCost('grok-3-mini', r.tokenUsage.inputTokens, r.tokenUsage.outputTokens)
    );

    console.log(`  [agent] Strategy: ${ctx.strategy.contentType} | ${ctx.strategy.template} | ${ctx.strategy.hookStyle}`);
    console.log(`  [agent] Directive: ${ctx.strategy.directive.slice(0, 120)}...`);

    // ── Agent 2: Web Search (Tavily + Claude) ────────────────────────────
    console.log(`  [agent] Web Search — searching for "${query}"`);
    ctx.searchResults = await this.runAgent(
      ctx,
      'web-search',
      'Web Search Agent',
      () => webSearchAgent(ctx),
      (r) => `Found ${r.results.length} sources, extracted ${r.keyFacts.length} facts`,
      (r) => `${r.synthesis.slice(0, 100)}...`,
      (r) => r.tokenUsage,
      (r) => calculateCost('claude-sonnet-4-6', r.tokenUsage.inputTokens, r.tokenUsage.outputTokens)
    );

    // ── Agent 3: Script Writer (Grok + templates) ────────────────────────
    console.log(`  [agent] Script Writer — ${ctx.strategy.template} template as ${influencer.name}`);
    ctx.script = await this.runAgent(
      ctx,
      'script-writer',
      'Script Writer Agent',
      () => scriptWriterAgent(ctx),
      (r) => `${r.wordCount} words, ${r.sections.length} sections${r.hasCliffhanger ? ' [CLIFFHANGER]' : ''}`,
      (r) => `"${r.title}" — ${r.totalDurationSeconds}s, ${r.tone}`,
      (r) => r.tokenUsage,
      (r) => calculateCost('grok-3-mini', r.tokenUsage.inputTokens, r.tokenUsage.outputTokens)
    );

    // ── Agent 4: Video Gen (Grok → Supabase Storage) ─────────────────────
    console.log(`  [agent] Video Gen — Grok + Supabase Storage`);
    ctx.video = await this.runAgent(
      ctx,
      'video-gen',
      'Video Gen Agent',
      () => videoGenAgent(ctx),
      (r) => `Script → Grok video`,
      (r) => `${r.clipsGenerated} clip, ~${r.durationSeconds}s → ${r.filePath.split('/').pop()}`,
      undefined,
      undefined
    );

    // ── Log content for future continuity ────────────────────────────────
    try {
      await logContent({
        influencer_id: influencer.id,
        script_title: ctx.script.title,
        topic: query,
        content_type: ctx.strategy.contentType,
        narrative_thread: ctx.strategy.narrativeThread,
        template_used: ctx.strategy.template,
        hook_style: ctx.strategy.hookStyle,
        audience_hook: ctx.script.hookLine,
        has_cliffhanger: ctx.script.hasCliffhanger,
        cliffhanger_text: ctx.script.cliffhangerText,
        full_script: ctx.script.fullText,
      });
      console.log(`  [agent] Content logged for future continuity`);
    } catch (err) {
      console.error(`  [agent] Failed to log content:`, err);
    }

    ctx.config.onProgress?.({ stage: 'done', message: 'Pipeline complete!' });

    const totalCostUsd = ctx.traces.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);

    return {
      query,
      strategy: ctx.strategy,
      searchResults: ctx.searchResults!,
      script: ctx.script!,
      video: ctx.video!,
      traces: ctx.traces,
      totalCostUsd,
      totalDurationMs: Date.now() - startMs,
    };
  }

  private async runAgent<T>(
    ctx: PipelineContext,
    agentId: AgentTrace['agentId'],
    agentName: string,
    fn: () => Promise<T>,
    inputSummaryFn: (result: T) => string,
    outputSummaryFn: (result: T) => string,
    tokenUsageFn?: (result: T) => AgentTrace['tokenUsage'],
    costFn?: (result: T) => number
  ): Promise<T> {
    const startedAt = new Date();
    const startMs = Date.now();

    let result: T;
    try {
      result = await fn();
    } catch (err) {
      const durationMs = Date.now() - startMs;
      ctx.traces.push({
        agentId,
        agentName,
        status: 'error',
        inputSummary: `Failed at ${agentName}`,
        outputSummary: '',
        durationMs,
        error: err instanceof Error ? err.message : String(err),
        startedAt,
        completedAt: new Date(),
      });
      if (err instanceof PipelineError) throw err;
      throw new PipelineError(`${agentName} failed: ${String(err)}`, agentId, err);
    }

    const durationMs = Date.now() - startMs;
    const tokenUsage = tokenUsageFn?.(result);
    const costUsd = costFn?.(result);

    ctx.traces.push({
      agentId,
      agentName,
      status: 'success',
      inputSummary: inputSummaryFn(result),
      outputSummary: outputSummaryFn(result),
      tokenUsage,
      costUsd,
      durationMs,
      startedAt,
      completedAt: new Date(),
    });

    const costStr = costUsd !== undefined ? ` (${formatCost(costUsd)})` : '';
    console.log(`  [agent] ${agentName} done in ${(durationMs / 1000).toFixed(1)}s${costStr}`);

    return result;
  }

  private validateConfig(config: PipelineConfig): void {
    const required: (keyof PipelineConfig)[] = [
      'anthropicApiKey', 'tavilyApiKey', 'xaiApiKey',
    ];
    for (const key of required) {
      if (!config[key]) {
        throw new PipelineError(`Missing required config: ${key}`, 'pipeline');
      }
    }
  }
}
