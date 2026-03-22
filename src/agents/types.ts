import type { CharacterIdentity } from '../types.js';
import type { ContentLogEntry } from '../db.js';

// ── Config ────────────────────────────────────────────────────────────────────

export interface PipelineConfig {
  anthropicApiKey: string;
  tavilyApiKey: string;
  xaiApiKey: string;

  searchMaxResults?: number;       // default: 5
  scriptTargetDuration?: number;   // seconds, default: 30 (short-form)
  outputDir?: string;              // default: './output'
  onProgress?: (event: ProgressEvent) => void;
}

// ── Content Strategy ─────────────────────────────────────────────────────────

export type ContentType = 'continuation' | 'reaction' | 'story_beat' | 'wildcard';

export type ScriptTemplate = 'provocateur' | 'storyteller' | 'educator' | 'reactor';

export type HookStyle =
  | 'pattern_interrupt'    // "Stop scrolling if..."
  | 'identity_callout'    // "If you're a [type]..."
  | 'curiosity_gap'       // "Nobody talks about this but..."
  | 'controversy'         // "This is gonna make people mad..."
  | 'cliffhanger_payoff'; // "Remember when I said...?"

export interface ContentStrategy {
  contentType: ContentType;
  template: ScriptTemplate;
  hookStyle: HookStyle;
  narrativeThread: string | null;         // ongoing thread name, or null for standalone
  continuationContext: string | null;      // what to continue from (previous cliffhanger, etc.)
  directive: string;                      // the specific instruction for the script writer
  reasoning: string;                      // why this strategy was chosen (for logging)
  tokenUsage: TokenUsage;
  durationMs: number;
}

// ── Pipeline Context ──────────────────────────────────────────────────────────

export interface PipelineContext {
  query: string;
  influencer: CharacterIdentity;
  config: PipelineConfig;
  startedAt: Date;

  contentHistory?: ContentLogEntry[];
  strategy?: ContentStrategy;
  searchResults?: SearchResults;
  script?: VideoScript;
  video?: VideoOutput;
  traces: AgentTrace[];
}

// ── Web Search ────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
}

export interface SearchResults {
  query: string;
  results: SearchResult[];
  synthesis: string;
  keyFacts: string[];
  sources: string[];
  tokenUsage: TokenUsage;
  durationMs: number;
}

// ── Script Writer ─────────────────────────────────────────────────────────────

export interface ScriptSection {
  id: string;
  type: 'intro' | 'main' | 'transition' | 'outro';
  title: string;
  content: string;
  durationSeconds: number;
  visualNotes?: string;
}

export interface VideoScript {
  title: string;
  totalDurationSeconds: number;
  tone: 'educational' | 'casual' | 'professional' | 'energetic';
  sections: ScriptSection[];
  fullText: string;
  wordCount: number;
  hookLine: string;
  hasCliffhanger: boolean;
  cliffhangerText: string | null;
  tokenUsage: TokenUsage;
  durationMs: number;
}

// ── Audio Gen ─────────────────────────────────────────────────────────────────

export interface AudioOutput {
  filePath: string;
  buffer: Buffer;
  durationSeconds: number;
  fileSizeBytes: number;
  voice: string;
  model: string;
  durationMs: number;
}

// ── Video Gen ─────────────────────────────────────────────────────────────────

export interface VideoOutput {
  filePath: string;
  durationSeconds: number;
  sections: number;
  clipsGenerated: number;
  durationMs: number;
}

// ── Upload Result ─────────────────────────────────────────────────────────────

export interface UploadResult {
  uid: string;
  playbackUrl: string;
}

// ── Tracing ───────────────────────────────────────────────────────────────────

export interface AgentTrace {
  agentId: 'web-search' | 'content-strategy' | 'script-writer' | 'video-gen';
  agentName: string;
  status: 'success' | 'error';
  inputSummary: string;
  outputSummary: string;
  tokenUsage?: TokenUsage;
  costUsd?: number;
  durationMs: number;
  error?: string;
  startedAt: Date;
  completedAt: Date;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ── Pipeline Result ───────────────────────────────────────────────────────────

export interface AgentPipelineResult {
  query: string;
  strategy: ContentStrategy;
  searchResults: SearchResults;
  script: VideoScript;
  video: VideoOutput;
  traces: AgentTrace[];
  totalCostUsd: number;
  totalDurationMs: number;
}

// ── Progress Events ───────────────────────────────────────────────────────────

export type ProgressEvent =
  | { stage: 'loading-history';   message: string }
  | { stage: 'strategizing';     message: string }
  | { stage: 'searching';        message: string }
  | { stage: 'synthesizing';     message: string }
  | { stage: 'writing-script';   message: string }
  | { stage: 'generating-audio'; message: string }
  | { stage: 'generating-video'; message: string }
  | { stage: 'assembling-video'; message: string }
  | { stage: 'uploading';        message: string }
  | { stage: 'done';             message: string };

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly agent: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}
