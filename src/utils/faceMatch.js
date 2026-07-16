/**
 * Pure server-side face-matching helpers — the authoritative re-scoring the
 * door unlock hangs on. Deliberately dependency-free and isolated (no DB, no
 * DOM, no network) so the "is this claimed match real?" decision is unit
 * testable in one place.
 *
 * This is a deliberate mirror of the kiosk's client/src/utils/faceMatching.js:
 * the same cosine definition and the same max-over-samples aggregation, so a
 * probe re-scored here lands on the same number the client computed. The
 * difference is one of trust, not arithmetic — the server recomputes from the
 * stored gallery rather than believing the client's self-reported score
 * (check-in trust model, handoff §3.9).
 */

const EMBEDDING_DIM = 128;

// True iff `v` is an array of exactly EMBEDDING_DIM finite numbers — the shape
// enrollment stores and the only shape we can honestly score against.
function isValidEmbedding(v) {
  return (
    Array.isArray(v) &&
    v.length === EMBEDDING_DIM &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

// Cosine similarity with defensive L2 normalization, identical to the kiosk's
// cosineSimilarity so scores are directly comparable. Returns -1 (never a
// false-high score) for a length mismatch or a zero-magnitude vector.
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? -1 : dot / denom;
}

// Best similarity between a probe and one member's enrolled samples. Max (not
// mean) so a single good-angle sample still scores high — enrollment captures
// distinct poses on purpose (matches the kiosk's scoreMember). An empty
// gallery yields -1, which denies against any real threshold.
function bestMatchScore(probe, samples) {
  let best = -1;
  for (const sample of samples) {
    const s = cosineSimilarity(probe, sample);
    if (s > best) best = s;
  }
  return best;
}

module.exports = { EMBEDDING_DIM, isValidEmbedding, cosineSimilarity, bestMatchScore };
