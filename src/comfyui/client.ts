import { config } from '../config.js';
import type { ComfyUIPromptResponse, ComfyUIHistoryEntry } from '../types.js';

const BASE = () => config.comfyuiUrl.replace(/\/$/, '');

export async function getSystemStats(): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE()}/system_stats`);
  if (!res.ok) throw new Error(`ComfyUI health check failed: ${res.status}`);
  return res.json();
}

export async function uploadImage(
  imageBuffer: Buffer,
  filename: string
): Promise<{ name: string; subfolder: string; type: string }> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' });
  form.append('image', blob, filename);
  form.append('overwrite', 'true');

  const res = await fetch(`${BASE()}/upload/image`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ComfyUI image upload failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function submitWorkflow(
  workflow: Record<string, unknown>
): Promise<ComfyUIPromptResponse> {
  const res = await fetch(`${BASE()}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ComfyUI workflow submission failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function pollResult(
  promptId: string
): Promise<ComfyUIHistoryEntry> {
  const deadline = Date.now() + config.comfyuiTimeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${BASE()}/history/${promptId}`);
    if (!res.ok) {
      await sleep(config.comfyuiPollIntervalMs);
      continue;
    }

    const history: Record<string, ComfyUIHistoryEntry> = await res.json();
    const entry = history[promptId];

    if (entry && entry.status?.completed) {
      return entry;
    }

    await sleep(config.comfyuiPollIntervalMs);
  }

  throw new Error(`ComfyUI generation timed out after ${config.comfyuiTimeoutMs}ms`);
}

export async function downloadOutput(
  filename: string,
  subfolder: string = '',
  type: string = 'output'
): Promise<Buffer> {
  const params = new URLSearchParams({ filename, subfolder, type });
  const res = await fetch(`${BASE()}/view?${params}`);

  if (!res.ok) {
    throw new Error(`ComfyUI download failed (${res.status}): ${filename}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function extractOutputFiles(
  entry: ComfyUIHistoryEntry
): Array<{ filename: string; subfolder: string; type: string }> {
  const files: Array<{ filename: string; subfolder: string; type: string }> = [];

  for (const nodeOutput of Object.values(entry.outputs)) {
    if (nodeOutput.images) {
      files.push(...nodeOutput.images);
    }
  }

  return files;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
