/**
 * The Anthropic client and the usage numbers every call reports.
 *
 * Both capabilities need these — extraction prices two reads per page, the
 * agent prices one answer per turn — so they sit in agent-core rather than
 * being duplicated or re-exported through the extractor.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Non-zero once the tools+system prefix is long enough to cache. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function usageOf(u: Anthropic.Usage | undefined): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

export function clientFor(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    // Three attempts total. A page that still fails is skipped and reported
    // rather than sinking the whole report.
    maxRetries: 3,
  });
}
