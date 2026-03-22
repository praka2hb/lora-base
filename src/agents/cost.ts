const PRICING: Record<string, { input: number; output: number }> = {
  // xAI Grok models
  'grok-3-mini':               { input: 0.30,  output: 0.50  },
  'grok-3':                    { input: 3.00,  output: 15.00 },
  'grok-4.20-reasoning':       { input: 3.00,  output: 15.00 },
  // Claude models (kept for reference)
  'claude-opus-4-6':           { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00  },
};

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? PRICING['grok-3-mini'];
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

export function formatCost(usd: number): string {
  if (usd < 0.001) return '< $0.001';
  if (usd < 0.01)  return `$${usd.toFixed(4)}`;
  if (usd < 1)     return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
