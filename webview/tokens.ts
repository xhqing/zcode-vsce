/**
 * Live token estimate for the reasoning ("Thinking") header. The runtime
 * only reports an authoritative tokenCount at turn_complete — during
 * streaming there is no per-delta count, so the live figure is a client-side
 * estimate: CJK chars ≈ 1 token each, all other text ≈ 4 chars per token.
 */

export function estimateTokens(text: string): number {
  let cjk = 0;
  let rest = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) // CJK unified ideographs
      || (code >= 0x3040 && code <= 0x30ff) // kana
      || (code >= 0xac00 && code <= 0xd7af) // hangul
      || (code >= 0xff00 && code <= 0xffef) // fullwidth forms
    ) {
      cjk += 1;
    } else {
      rest += 1;
    }
  }
  return cjk + Math.ceil(rest / 4);
}

/** Thousands-separated display form: 999 → "999", 1000 → "1,000". */
export function formatTokenCount(value: number): string {
  return value.toLocaleString("en-US");
}
