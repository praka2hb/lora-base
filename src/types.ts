export interface CharacterIdentity {
  id: string;
  name: string;
  persona: string | null;
  context: string | null;
  face_url: string | null;
  avatar_url: string | null;
  character_id: string | null;
  character: {
    slug: string;
    name: string;
    category: string;
    image_path: string;
    visual_description: string | null;
  } | null;
  visual_description: string | null;
  tone: string | null;
  speaking_style: string | null;
  personality_traits: string[] | null;
  seed: number | null;
}

export type JobStatus = 'pending' | 'processing' | 'generating' | 'uploading' | 'done' | 'failed';

export interface Job {
  id: string;
  influencer_id: string | null;
  status: JobStatus;
  prompt_data: Record<string, unknown> | null;
  scene: string | null;
  script: string | null;
  result_video_url: string | null;
  error: string | null;
  created_at: string;
}

export interface WorkflowParams {
  referenceImageFilename: string;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  frames: number;
  fps: number;
  width: number;
  height: number;
  phase: 1 | 2 | 3;
}

export interface ComfyUIPromptResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, unknown>;
}

export interface ComfyUIHistoryEntry {
  prompt: [number, string, Record<string, unknown>, Record<string, string>];
  outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
  status: { status_str: string; completed: boolean };
}

export interface PipelineResult {
  videoUrl: string;
  scene: string;
  script: string;
}
