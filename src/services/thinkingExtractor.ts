// thinkingExtractor.ts
export type ThinkingMatch =
  | { kind: 'html-comment'; chunk: string }
  | { kind: 'xml-tag'; chunk: string }
  | { kind: 'fence'; chunk: string }
  | { kind: 'bracket'; chunk: string }
  | { kind: 'asterisk'; chunk: string };

const THINKING_RE = /^\uFEFF?\s*(?:<!--\s*thinking\s*-->\s*(?<think_html>[\s\S]*?)\s*<!--\s*\/\s*thinking\s*-->|<thinking\b[^>]*>\s*(?<think_xml>[\s\S]*?)\s*<\/thinking>|```(?:thinking|thoughts)\s*\r?\n(?<think_fence>[\s\S]*?)(?:\r?\n)?```|\[\s*THINK(?:ING)?\s*\]\s*(?<think_bracket>[\s\S]*?)\s*\[\s*\/\s*THINK(?:ING)?\s*\]|\*(?<think_asterisk>(?:(?!\*\*)[^\n*])+?)(?=(?:[A-Z][a-z]|Hello|Hi|Sure|Yes|No|OK|Okay)))/i;

/**
 * Extract a beginning-of-text thinking block (if present).
 * Returns the chunk + its type, or null if none.
 */
export function extractThinkingChunk(text: string): ThinkingMatch | null {
  if (!text) return null;

  // Fast path: if first non-ws char isn't '<', '[', '`', or '*', skip RE
  // (still handles BOM + whitespace)
  const firstVisible = text.replace(/^\uFEFF?[\s]*/, '').charAt(0);
  if (!firstVisible || (firstVisible !== '<' && firstVisible !== '[' && firstVisible !== '`' && firstVisible !== '*')) {
    return null;
  }

  const m = text.match(THINKING_RE);
  if (!m || !m.groups) return null;

  if (m.groups.think_html != null) return { kind: 'html-comment', chunk: m.groups.think_html };
  if (m.groups.think_xml  != null) return { kind: 'xml-tag',     chunk: m.groups.think_xml  };
  if (m.groups.think_fence!= null) return { kind: 'fence',        chunk: m.groups.think_fence};
  if (m.groups.think_bracket!=null) return { kind: 'bracket',     chunk: m.groups.think_bracket};
  if (m.groups.think_asterisk!=null) return { kind: 'asterisk',   chunk: m.groups.think_asterisk};

  return null;
}

/**
 * Remove the leading thinking block, if present.
 * Returns the cleaned text plus metadata of what was removed.
 */
export function stripThinkingAtStart(text: string): {
  cleaned: string;
  removed: boolean;
  match?: ThinkingMatch;
} {
  if (!text) return { cleaned: '', removed: false };

  const m = text.match(THINKING_RE);
  if (!m) return { cleaned: text, removed: false };

  const match = extractThinkingChunk(text)!;
  // Slice off exactly the matched wrapper + content
  const cleaned = text.slice(m[0].length).replace(/^\s*\n?/, ''); // trim one extra gap line if present
  return { cleaned, removed: true, match };
}

/**
 * Convenience: extract then filter in one go.
 * - `thinking`: the removed chunk (or null)
 * - `body`: the remaining visible answer
 * - `kind`: which wrapper matched (or null)
 */
export function takeThinkingThenBody(text: string): {
  thinking: string | null;
  kind: ThinkingMatch['kind'] | null;
  body: string;
} {
  const out = stripThinkingAtStart(text);
  return {
    thinking: out.removed ? out.match!.chunk : null,
    kind: out.removed ? out.match!.kind : null,
    body: out.cleaned,
  };
}
