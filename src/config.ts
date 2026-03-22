import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  // AI APIs
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  tavilyApiKey: required('TAVILY_API_KEY'),
  xaiApiKey: required('XAI_API_KEY'),

  // App
  appUrl: optional('APP_URL', 'http://localhost:3000'),
  pollIntervalMs: parseInt(optional('POLL_INTERVAL_MS', '5000'), 10),

  // Video defaults
  scriptTargetDuration: parseInt(optional('SCRIPT_TARGET_DURATION', '8'), 10),
  outputDir: optional('OUTPUT_DIR', './output'),

} as const;
