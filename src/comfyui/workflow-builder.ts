import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkflowParams } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, '../../workflows/identity-video.json');

interface WorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _phase_min?: number;
}

export function buildWorkflow(params: WorkflowParams): Record<string, unknown> {
  const raw = readFileSync(TEMPLATE_PATH, 'utf-8');
  const template: Record<string, WorkflowNode> = JSON.parse(raw);

  const filtered: Record<string, WorkflowNode> = {};
  for (const [id, node] of Object.entries(template)) {
    if (node._phase_min && node._phase_min > params.phase) continue;
    const clean = { ...node };
    delete clean._phase_min;
    filtered[id] = clean;
  }

  setNodeInput(filtered, '2', 'text', params.positivePrompt);
  setNodeInput(filtered, '3', 'text', params.negativePrompt);
  setNodeInput(filtered, '4', 'image', params.referenceImageFilename);
  setNodeInput(filtered, '5', 'width', params.width);
  setNodeInput(filtered, '5', 'height', params.height);
  setNodeInput(filtered, '5', 'batch_size', params.frames);
  setNodeInput(filtered, '50', 'seed', params.seed);
  setNodeInput(filtered, '52', 'frame_rate', params.fps);

  wireModelChain(filtered, params.phase);
  wireConditioningChain(filtered, params.phase);

  return filtered;
}

function wireModelChain(nodes: Record<string, WorkflowNode>, phase: number): void {
  // Model flows: Checkpoint -> IPAdapter -> (PuLID if phase>=2) -> AnimateDiff -> KSampler
  if (phase >= 2 && nodes['22']) {
    // PuLID takes model from IPAdapter output
    setNodeInput(nodes, '22', 'model', ['12', 0]);
    // AnimateDiff takes model from PuLID output
    setNodeInput(nodes, '42', 'model', ['22', 0]);
  } else {
    // AnimateDiff takes model directly from IPAdapter
    setNodeInput(nodes, '42', 'model', ['12', 0]);
  }
}

function wireConditioningChain(nodes: Record<string, WorkflowNode>, phase: number): void {
  if (phase >= 2 && nodes['32']) {
    // ControlNet outputs positive/negative conditioning
    setNodeInput(nodes, '50', 'positive', ['32', 0]);
    setNodeInput(nodes, '50', 'negative', ['32', 1]);
  } else {
    // KSampler uses CLIP conditioning directly
    setNodeInput(nodes, '50', 'positive', ['2', 0]);
    setNodeInput(nodes, '50', 'negative', ['3', 0]);
  }
}

function setNodeInput(
  nodes: Record<string, WorkflowNode>,
  nodeId: string,
  key: string,
  value: unknown
): void {
  if (nodes[nodeId]) {
    nodes[nodeId].inputs[key] = value;
  }
}
