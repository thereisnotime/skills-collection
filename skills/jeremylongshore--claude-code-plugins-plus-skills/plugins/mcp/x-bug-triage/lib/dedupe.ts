/**
 * Hybrid content-similarity deduplication for bug candidates.
 * Runs BEFORE clustering to tag duplicate groups with a canonical post.
 * Does NOT remove posts — groups them so the canonical goes forward.
 */

export interface DuplicateGroup {
  canonical_id: string;
  duplicate_ids: string[];
  similarity: number;
}

export interface DeduplicationResult {
  unique_count: number;
  duplicate_group_count: number;
  groups: DuplicateGroup[];
  /** Post IDs that are canonical or have no duplicates */
  forward_ids: Set<string>;
}

interface CandidateForDedup {
  post_id: string;
  text: string;
  public_metrics?: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
    quote_count: number;
  };
}

// ============================================================
// Similarity Functions
// ============================================================

/**
 * Character trigram similarity (Dice coefficient).
 * Fast approximation of string similarity.
 */
export function charTrigramSimilarity(a: string, b: string): number {
  const trigramsA = charTrigrams(a.toLowerCase());
  const trigramsB = charTrigrams(b.toLowerCase());

  if (trigramsA.size === 0 && trigramsB.size === 0) return 1;
  if (trigramsA.size === 0 || trigramsB.size === 0) return 0;

  let intersection = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) intersection++;
  }

  return (2 * intersection) / (trigramsA.size + trigramsB.size);
}

function charTrigrams(s: string): Set<string> {
  const trigrams = new Set<string>();
  for (let i = 0; i <= s.length - 3; i++) {
    trigrams.add(s.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * Token-level Jaccard similarity.
 * Handles paraphrased content where word order differs.
 */
export function tokenJaccardSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

// Trigram catches character-level edits (typos, minor rewording).
// Token Jaccard catches paraphrases where word order differs.
// Token gets higher weight because bug reports vary more in phrasing than spelling.
const TRIGRAM_WEIGHT = 0.4;
const TOKEN_JACCARD_WEIGHT = 0.6;

/**
 * Hybrid similarity combining trigram and token Jaccard.
 */
export function hybridSimilarity(a: string, b: string): number {
  const trigram = charTrigramSimilarity(a, b);
  const jaccard = tokenJaccardSimilarity(a, b);
  return TRIGRAM_WEIGHT * trigram + TOKEN_JACCARD_WEIGHT * jaccard;
}

// ============================================================
// Deduplication Pipeline
// ============================================================

/**
 * Deduplicate bug candidates by content similarity.
 * Groups similar posts and selects a canonical post (highest engagement).
 * Does NOT remove posts — tags them as duplicate groups.
 *
 * @param candidates - Posts to deduplicate
 * @param threshold - Similarity threshold for grouping (default 0.70)
 * @returns DeduplicationResult with groups and forward IDs
 */
export function deduplicateCandidates(
  candidates: CandidateForDedup[],
  threshold: number = 0.70,
): DeduplicationResult {
  if (candidates.length <= 1) {
    return {
      unique_count: candidates.length,
      duplicate_group_count: 0,
      groups: [],
      forward_ids: new Set(candidates.map((c) => c.post_id)),
    };
  }

  // Union-Find for grouping
  const parent = new Map<string, string>();
  for (const c of candidates) parent.set(c.post_id, c.post_id);

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression
    let curr = id;
    while (curr !== root) {
      const next = parent.get(curr)!;
      parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  // Pairwise comparison with similarity check
  const similarities = new Map<string, number>();
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const sim = hybridSimilarity(candidates[i].text, candidates[j].text);
      if (sim >= threshold) {
        union(candidates[i].post_id, candidates[j].post_id);
        const pairKey = `${candidates[i].post_id}:${candidates[j].post_id}`;
        similarities.set(pairKey, sim);
      }
    }
  }

  // Build groups from union-find
  const groupMap = new Map<string, CandidateForDedup[]>();
  for (const c of candidates) {
    const root = find(c.post_id);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root)!.push(c);
  }

  // Build result
  const groups: DuplicateGroup[] = [];
  const forwardIds = new Set<string>();

  for (const members of groupMap.values()) {
    if (members.length === 1) {
      forwardIds.add(members[0].post_id);
      continue;
    }

    // Canonical = highest engagement
    const canonical = members.reduce((best, curr) => {
      return engagementScore(curr) > engagementScore(best) ? curr : best;
    });

    forwardIds.add(canonical.post_id);

    const duplicateIds = members
      .filter((m) => m.post_id !== canonical.post_id)
      .map((m) => m.post_id);

    // Average similarity within group
    let totalSim = 0;
    let simCount = 0;
    for (const [key, sim] of similarities) {
      const [a, b] = key.split(":");
      if (members.some((m) => m.post_id === a) && members.some((m) => m.post_id === b)) {
        totalSim += sim;
        simCount++;
      }
    }

    groups.push({
      canonical_id: canonical.post_id,
      duplicate_ids: duplicateIds,
      similarity: simCount > 0 ? Math.round((totalSim / simCount) * 100) / 100 : threshold,
    });
  }

  return {
    unique_count: forwardIds.size,
    duplicate_group_count: groups.length,
    groups,
    forward_ids: forwardIds,
  };
}

function engagementScore(candidate: CandidateForDedup): number {
  const m = candidate.public_metrics;
  if (!m) return 0;
  return m.like_count + m.reply_count * 2 + m.retweet_count * 3 + m.quote_count * 4;
}
