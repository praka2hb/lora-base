/**
 * VideoGenAgent — xAI Grok Video (grok-imagine-video)
 *
 * Simple 2-step API:
 *   1. POST https://api.x.ai/v1/videos/generations → request_id
 *   2. GET  https://api.x.ai/v1/videos/{request_id} → poll until done → video URL
 *
 * Then download .mp4 and upload to Supabase Storage.
 */

import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import type { PipelineContext, VideoOutput } from './types.js';
import { PipelineError } from './types.js';
import { config as workerConfig } from '../config.js';
import { WOJAK_VIDEO_STYLE } from '../wojak-style.js';

const XAI_BASE = 'https://api.x.ai/v1';

export async function videoGenAgent(ctx: PipelineContext): Promise<VideoOutput> {
  if (!ctx.script) throw new PipelineError('videoGenAgent requires script', 'video-gen');
  if (!ctx.config.xaiApiKey) throw new PipelineError('xaiApiKey required', 'video-gen');

  const { config, script, influencer } = ctx;
  const startMs = Date.now();
  const apiKey = config.xaiApiKey;
  const outputDir = resolve(config.outputDir ?? './output');
  await mkdir(outputDir, { recursive: true });

  // Match video duration to script duration. Grok supports 5-16s.
  const scriptDuration = script.totalDurationSeconds;
  const videoDuration = clampDuration(scriptDuration);

  config.onProgress?.({ stage: 'generating-video', message: `Generating ${videoDuration}s video with Grok` });

  const prompt = buildVideoPrompt({
    topic: ctx.query,
    title: script.title,
    narration: script.fullText,
    tone: script.tone,
    durationSeconds: videoDuration,
    characterVisual: influencer.visual_description ?? influencer.character?.visual_description ?? undefined,
    characterCategory: influencer.character?.category,
  });

  console.log(`  [grok] Script: ${scriptDuration}s → Video: ${videoDuration}s`);
  console.log(`  [grok] Prompt (${prompt.length} chars): ${prompt.slice(0, 200)}...`);

  // ── Step 1: Start generation ────────────────────────────────────────────

  const startRes = await fetch(`${XAI_BASE}/videos/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-imagine-video',
      prompt,
      duration: videoDuration,
      aspect_ratio: '9:16',
      resolution: '720p',
    }),
  });

  if (!startRes.ok) {
    const body = await startRes.text();
    throw new PipelineError(`Grok video start failed (${startRes.status}): ${body}`, 'video-gen');
  }

  const { request_id } = await startRes.json() as { request_id: string };
  console.log(`  [grok] Request ID: ${request_id}`);

  // ── Step 2: Poll until done ─────────────────────────────────────────────

  let videoUrl: string | null = null;
  let pollCount = 0;

  while (true) {
    await sleep(5000);
    pollCount++;

    if (pollCount % 6 === 0) {
      console.log(`  [grok] Still generating... (${pollCount * 5}s)`);
      config.onProgress?.({ stage: 'generating-video', message: `Still generating... (${pollCount * 5}s)` });
    }

    const pollRes = await fetch(`${XAI_BASE}/videos/${request_id}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      const body = await pollRes.text();
      throw new PipelineError(`Grok video poll failed (${pollRes.status}): ${body}`, 'video-gen');
    }

    const data = await pollRes.json() as {
      status: 'pending' | 'done' | 'expired' | 'failed';
      video?: { url: string; duration: number };
    };

    if (data.status === 'done' && data.video?.url) {
      videoUrl = data.video.url;
      console.log(`  [grok] Video ready! Duration: ${data.video.duration}s`);
      break;
    } else if (data.status === 'expired') {
      throw new PipelineError('Grok video generation expired', 'video-gen');
    } else if (data.status === 'failed') {
      throw new PipelineError('Grok video generation failed', 'video-gen');
    }

    // Timeout after 10 minutes
    if (pollCount > 120) {
      throw new PipelineError('Grok video generation timed out (10min)', 'video-gen');
    }
  }

  // ── Step 3: Download .mp4 ───────────────────────────────────────────────

  config.onProgress?.({ stage: 'generating-video', message: 'Downloading video...' });

  const dlRes = await fetch(videoUrl);
  if (!dlRes.ok) {
    throw new PipelineError(`Failed to download video (${dlRes.status})`, 'video-gen');
  }

  const videoBuffer = Buffer.from(await dlRes.arrayBuffer());
  console.log(`  [grok] Downloaded ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  // ── Step 4: Upload to Supabase Storage ──────────────────────────────────

  config.onProgress?.({ stage: 'uploading', message: 'Uploading to storage...' });

  const supabase = createClient(workerConfig.supabaseUrl, workerConfig.supabaseServiceKey);
  const fileName = `videos/${Date.now()}_${request_id}.mp4`;

  const { error: uploadError } = await supabase.storage
    .from('videos')
    .upload(fileName, videoBuffer, {
      contentType: 'video/mp4',
      upsert: true,
    });

  if (uploadError) {
    // Fallback: save locally
    const localPath = join(outputDir, `video_${Date.now()}.mp4`);
    await writeFile(localPath, videoBuffer);
    console.error(`  [grok] Supabase upload failed: ${uploadError.message}, saved locally: ${localPath}`);
    throw new PipelineError(`Storage upload failed: ${uploadError.message}`, 'video-gen');
  }

  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(fileName);
  const publicUrl = urlData.publicUrl;
  console.log(`  [grok] Uploaded to: ${publicUrl}`);

  return {
    filePath: publicUrl,  // This is now the Supabase Storage URL
    durationSeconds: videoDuration,
    sections: script.sections.length,
    clipsGenerated: 1,
    durationMs: Date.now() - startMs,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clamp duration to Grok's supported range (1-15s) */
function clampDuration(seconds: number): number {
  if (seconds <= 5) return 5;
  if (seconds <= 8) return 8;
  if (seconds <= 12) return 12;
  return 15;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildVideoPrompt(params: {
  topic: string;
  title: string;
  narration: string;
  tone: string;
  durationSeconds: number;
  characterVisual?: string;
  characterCategory?: string;
}): string {
  const styleMap: Record<string, string> = {
    educational: 'MS Paint meme explainer vibe, simple graphics feel, still wojak energy',
    casual:      'crude meme clip lighting, ironic lifestyle, wojak reaction pacing',
    professional:'clean but still flat meme-adjacent — not corporate stock',
    energetic:   'chaotic wojak meme motion, bold flat colors, high energy',
  };
  const style = styleMap[params.tone] ?? styleMap['casual'];

  const categoryStyle: Record<string, string> = {
    pokemon: 'wojak-meme color pops, playful crude shapes',
    anime:   'exaggerated reaction faces, meme exaggeration not clean anime',
    game:    'retro gaming meme HUD vibes, ironic',
    cartoon: 'MS Paint cartoon, flat meme colors',
  };
  const catStyle = params.characterCategory
    ? categoryStyle[params.characterCategory.toLowerCase()] ?? ''
    : '';

  // Scale narration excerpt to video duration
  const wordsPerSecond = 2.5;
  const maxWords = Math.round(params.durationSeconds * wordsPerSecond);
  const words = params.narration.split(/\s+/);
  const narrationExcerpt = words.slice(0, maxWords).join(' ');

  const parts = [
    `A ${params.durationSeconds}-second short-form vertical MEME video about: ${params.title}`,
    WOJAK_VIDEO_STYLE,
    style,
    catStyle,
    params.characterVisual ? `Character (wojak-meme look): ${params.characterVisual}` : '',
    '9:16 portrait. Smooth motion. No on-screen text. Meme clip energy.',
    `Scene unfolds over ${params.durationSeconds} seconds. A narrator says: "${narrationExcerpt}"`,
  ].filter(Boolean);

  return parts.join('. ');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
