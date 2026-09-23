/**
 * Anti-duplicate guard for `litecode ticket new`: compares a proposed title against every
 * existing ticket before the file is written.
 *
 * It exists because two tickets once described work that was already tracked and were
 * filed again as brand-new duplicates. Nothing upstream had asked whether the subject was
 * already covered; this check does, at draft time.
 *
 * The matching criterion is deliberately simple and explainable rather than an opaque
 * score: normalize away conventional-commit prefixes/punctuation/case, then either (a) an
 * exact match after normalization, or (b) the significant (non-stopword, length > 2) words
 * of one title are a subset of the other's, or (c) a Jaccard similarity over those
 * significant words clears the threshold. Every branch is testable with plain string
 * fixtures — no ML, no external service.
 */

export type DedupeSource = "local";

export type DedupeCandidate = {
  source: DedupeSource;
  /** Local ticket id, e.g. "0004-...". */
  ref: string;
  title: string;
};

export type DuplicateMatch = {
  candidate: DedupeCandidate;
  score: number;
  reason: string;
};

/** Score at/above which two titles are treated as covering the same subject. */
export const DUPLICATE_THRESHOLD = 0.6;

const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "for", "in", "on", "and", "or", "with", "before", "after",
  "into", "from", "via", "du", "de", "la", "le", "les", "un", "une", "des", "et", "pour",
  "avant", "apres", "dans", "sur",
]);

/** Strips a leading conventional-commit prefix like "feat(tickets): " before normalizing. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^[a-z]+(\([a-z0-9_/-]+\))?:\s*/i, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(title: string): Set<string> {
  return new Set(
    normalizeTitle(title)
      .split(" ")
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0) return false;
  for (const word of a) if (!b.has(word)) return false;
  return true;
}

/**
 * Returns the strongest match at/above `threshold`, or `undefined` if the proposed title
 * doesn't overlap any candidate closely enough. Picks the single best match (highest
 * score) rather than every match over threshold, so the resulting blocker message names
 * exactly one conflicting ticket/issue to act on.
 */
export function findDuplicate(
  title: string,
  candidates: DedupeCandidate[],
  threshold: number = DUPLICATE_THRESHOLD,
): DuplicateMatch | undefined {
  const normalized = normalizeTitle(title);
  const words = significantWords(title);

  let best: DuplicateMatch | undefined;
  for (const candidate of candidates) {
    const candidateNormalized = normalizeTitle(candidate.title);
    const candidateWords = significantWords(candidate.title);

    let score: number;
    let reason: string;
    if (normalized.length > 0 && normalized === candidateNormalized) {
      score = 1;
      reason = "identical title after normalization";
    } else if (isSubset(words, candidateWords) || isSubset(candidateWords, words)) {
      score = Math.max(jaccard(words, candidateWords), 0.75);
      reason = "significant words of one title are a subset of the other's";
    } else {
      score = jaccard(words, candidateWords);
      reason = `title word similarity ${score.toFixed(2)}`;
    }

    if (score >= threshold && (!best || score > best.score)) {
      best = { candidate, score, reason };
    }
  }
  return best;
}

/** Dedupe candidates drawn from the local ticket buffer, keyed by their file id. */
export function localDedupeCandidates(tickets: { id: string; title: string }[]): DedupeCandidate[] {
  return tickets.map((t) => ({ source: "local", ref: t.id, title: t.title }));
}
