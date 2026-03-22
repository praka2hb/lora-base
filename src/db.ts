import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import type { CharacterIdentity, Job, JobStatus } from './types.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);

export async function claimNextJob(): Promise<Job | null> {
  const { data: jobs, error: fetchError } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (fetchError || !jobs || jobs.length === 0) return null;

  const job = jobs[0] as Job;

  const { error: updateError } = await supabase
    .from('jobs')
    .update({ status: 'processing' })
    .eq('id', job.id)
    .eq('status', 'pending');

  if (updateError) return null;

  return { ...job, status: 'processing' };
}

export async function getCharacter(influencerId: string): Promise<CharacterIdentity | null> {
  const { data, error } = await supabase
    .from('influencers')
    .select('id, name, persona, context, face_url, avatar_url, character_id, visual_description, tone, speaking_style, personality_traits, seed, character:characters(slug, name, category, image_path, visual_description)')
    .eq('id', influencerId)
    .single();

  if (error || !data) return null;

  // Supabase returns FK joins as single objects with .single(), but TS infers array.
  // Normalize: if character came back as an array, take the first element.
  const raw = data as Record<string, unknown>;
  if (Array.isArray(raw.character)) {
    raw.character = raw.character[0] ?? null;
  }

  return raw as unknown as CharacterIdentity;
}

export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  extra?: Partial<Pick<Job, 'scene' | 'script' | 'result_video_url' | 'error'>>
): Promise<void> {
  const { error } = await supabase
    .from('jobs')
    .update({ status, ...extra })
    .eq('id', jobId);

  if (error) console.error(`Failed to update job ${jobId} to ${status}:`, error.message);
}

export async function createPost(influencerId: string, videoUrl: string, caption: string): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .insert({ influencer_id: influencerId, video_url: videoUrl, caption });

  if (error) console.error('Failed to create post:', error.message);
}

// ── Content Log ────────────────────────────────────────────────────────────────

export interface ContentLogEntry {
  id: string;
  script_title: string;
  topic: string | null;
  content_type: string;
  narrative_thread: string | null;
  template_used: string | null;
  hook_style: string | null;
  audience_hook: string | null;
  has_cliffhanger: boolean;
  cliffhanger_text: string | null;
  full_script: string | null;
  created_at: string;
}

export async function getContentHistory(influencerId: string, limit = 10): Promise<ContentLogEntry[]> {
  const { data, error } = await supabase
    .from('influencer_content_log')
    .select('*')
    .eq('influencer_id', influencerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to fetch content history:', error.message);
    return [];
  }

  return (data ?? []) as ContentLogEntry[];
}

export async function logContent(entry: {
  influencer_id: string;
  script_title: string;
  topic: string | null;
  content_type: string;
  narrative_thread: string | null;
  template_used: string | null;
  hook_style: string | null;
  audience_hook: string | null;
  has_cliffhanger: boolean;
  cliffhanger_text: string | null;
  full_script: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('influencer_content_log')
    .insert(entry);

  if (error) console.error('Failed to log content:', error.message);
}
