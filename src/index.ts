import { config } from './config.js';
import { claimNextJob, getCharacter, updateJobStatus, createPost } from './db.js';
import { AgentPipeline } from './agents/pipeline.js';
import type { PipelineConfig } from './agents/types.js';


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const pipelineConfig: PipelineConfig = {
  anthropicApiKey: config.anthropicApiKey,
  tavilyApiKey: config.tavilyApiKey,
  xaiApiKey: config.xaiApiKey,
  scriptTargetDuration: config.scriptTargetDuration,
  outputDir: config.outputDir,
  onProgress: (event) => console.log(`  [progress] ${event.message}`),
};

const pipeline = new AgentPipeline(pipelineConfig);

async function processJob(job: { id: string; influencer_id: string | null }): Promise<void> {
  const jobId = job.id;
  console.log(`[pipeline] Starting job ${jobId}`);

  try {
    if (!job.influencer_id) {
      throw new Error('Job has no influencer_id');
    }

    const influencer = await getCharacter(job.influencer_id);
    if (!influencer) {
      throw new Error(`Influencer ${job.influencer_id} not found`);
    }

    const charInfo = influencer.character
      ? `${influencer.character.name} - ${influencer.character.category}`
      : 'custom persona';
    console.log(`[pipeline] ${influencer.name} (${charInfo})`);

    const query = influencer.context
      ?? influencer.persona
      ?? (influencer.character ? `trending content about ${influencer.character.category}` : `trending viral content`);

    // Run the 3-agent pipeline
    const result = await pipeline.run(query, influencer);

    // video.filePath is now the Supabase Storage public URL
    const videoUrl = result.video.filePath;

    await updateJobStatus(jobId, 'done', {
      scene: result.searchResults.synthesis,
      script: result.script.fullText,
      result_video_url: videoUrl,
    });

    await createPost(job.influencer_id, videoUrl, result.script.fullText);

    const tracesSummary = result.traces.map(t =>
      `  ${t.agentName}: ${t.status} (${(t.durationMs / 1000).toFixed(1)}s${t.costUsd ? `, $${t.costUsd.toFixed(4)}` : ''})`
    ).join('\n');

    console.log(`[pipeline] Job ${jobId} completed!`);
    console.log(`[pipeline] Strategy: ${result.strategy.contentType} | ${result.strategy.template} | ${result.strategy.hookStyle}`);
    console.log(`[pipeline] Script: "${result.script.title}"${result.script.hasCliffhanger ? ' [CLIFFHANGER]' : ''}`);
    console.log(`[pipeline] Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`[pipeline] Cost: $${result.totalCostUsd.toFixed(4)}`);
    console.log(`[pipeline] Traces:\n${tracesSummary}`);
    console.log(`[pipeline] Video: ${videoUrl}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] Job ${jobId} failed:`, message);
    await updateJobStatus(jobId, 'failed', { error: message });
  }
}

async function main(): Promise<void> {
  console.log('=== 1000ds Video Worker ===');
  console.log(`Supabase:  ${config.supabaseUrl}`);
  console.log(`Anthropic: enabled`);
  console.log(`Tavily:    enabled`);
  console.log(`xAI Grok:  enabled (video gen)`);
  console.log(`Script:    ${config.scriptTargetDuration}s target`);
  console.log('');
  console.log(`[poll] Listening for jobs every ${config.pollIntervalMs}ms...`);
  console.log('');

  while (true) {
    try {
      const job = await claimNextJob();

      if (job) {
        console.log(`[poll] Claimed job ${job.id} for influencer ${job.influencer_id}`);
        await processJob(job);
        console.log('');
      }
    } catch (err) {
      console.error('[poll] Error in polling loop:', err instanceof Error ? err.message : err);
    }

    await sleep(config.pollIntervalMs);
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
