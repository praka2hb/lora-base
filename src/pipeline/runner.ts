import { config } from '../config.js';
import { getCharacter, updateJobStatus, createPost } from '../db.js';
import { uploadImage, submitWorkflow, pollResult, downloadOutput, extractOutputFiles } from '../comfyui/client.js';
import { buildWorkflow } from '../comfyui/workflow-builder.js';
import { generateScene } from './scene-engine.js';
import { generateScript } from './script-engine.js';
import { buildPrompts } from './prompt-builder.js';
import { uploadToCloudflareStream } from '../upload/cloudflare.js';
import type { Job } from '../types.js';

export async function runPipeline(job: Job): Promise<void> {
  const jobId = job.id;
  console.log(`[pipeline] Starting job ${jobId}`);

  try {
    if (!job.influencer_id) {
      throw new Error('Job has no influencer_id');
    }

    const character = await getCharacter(job.influencer_id);
    if (!character) {
      throw new Error(`Influencer ${job.influencer_id} not found`);
    }

    if (!character.character) {
      throw new Error(`Influencer ${character.name} has no character assigned — select a character first`);
    }

    const charData = character.character;
    console.log(`[pipeline] Character: ${character.name} (${charData.name} - ${charData.category})`);

    // --- Scene & Script Generation ---
    const scene = await generateScene(character);
    const script = await generateScript(character);
    console.log(`[pipeline] Scene: ${scene}`);
    console.log(`[pipeline] Script: ${script}`);

    await updateJobStatus(jobId, 'processing', { scene, script });

    // --- Build Prompts ---
    const { positive, negative } = buildPrompts(character, scene);
    console.log(`[pipeline] Prompt built (${positive.length} chars)`);

    // --- Download Character Image from Next.js public/ & Upload to ComfyUI ---
    const imageUrl = `${config.appUrl}/${charData.image_path}`;
    const refImageRes = await fetch(imageUrl);
    if (!refImageRes.ok) {
      throw new Error(`Failed to download character image from ${imageUrl}`);
    }
    const refImageBuffer = Buffer.from(await refImageRes.arrayBuffer());
    const refFilename = `ref_${charData.slug}_${character.id.slice(0, 8)}.png`;

    await uploadImage(refImageBuffer, refFilename);
    console.log(`[pipeline] Reference image uploaded to ComfyUI as ${refFilename}`);

    // --- Build Workflow ---
    const seed = character.seed ?? Math.floor(Math.random() * 2147483647);
    const workflow = buildWorkflow({
      referenceImageFilename: refFilename,
      positivePrompt: positive,
      negativePrompt: negative,
      seed,
      frames: config.video.frames,
      fps: config.video.fps,
      width: config.video.width,
      height: config.video.height,
      phase: config.identityPhase,
    });

    // --- Submit to ComfyUI ---
    await updateJobStatus(jobId, 'generating');
    const { prompt_id } = await submitWorkflow(workflow);
    console.log(`[pipeline] ComfyUI prompt submitted: ${prompt_id}`);

    // --- Poll for completion ---
    const result = await pollResult(prompt_id);
    const outputFiles = extractOutputFiles(result);
    console.log(`[pipeline] Generation complete, ${outputFiles.length} output(s)`);

    if (outputFiles.length === 0) {
      throw new Error('ComfyUI returned no output files');
    }

    // --- Download video output ---
    const videoFile = outputFiles[0];
    const videoBuffer = await downloadOutput(videoFile.filename, videoFile.subfolder, videoFile.type);
    console.log(`[pipeline] Video downloaded: ${videoFile.filename} (${videoBuffer.length} bytes)`);

    // --- Upload to Cloudflare Stream ---
    await updateJobStatus(jobId, 'uploading');
    const upload = await uploadToCloudflareStream(videoBuffer);
    console.log(`[pipeline] Uploaded to Cloudflare: ${upload.uid}`);

    // --- Create Post ---
    await createPost(job.influencer_id, upload.playbackUrl, script);
    console.log(`[pipeline] Post created for influencer ${character.name}`);

    // --- Mark Done ---
    await updateJobStatus(jobId, 'done', { result_video_url: upload.playbackUrl });
    console.log(`[pipeline] Job ${jobId} completed successfully`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] Job ${jobId} failed:`, message);
    await updateJobStatus(jobId, 'failed', { error: message });
  }
}
