const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidEmbedding, cosineSimilarity, bestMatchScore } = require('../../utils/faceMatch');

const dim = (fill) => Array.from({ length: 128 }, fill);

test('isValidEmbedding: accepts 128 finite numbers, rejects everything else', () => {
  assert.equal(isValidEmbedding(dim(() => 0.1)), true);
  assert.equal(isValidEmbedding(dim(() => 0)), true, 'zeros are finite');
  assert.equal(isValidEmbedding([1, 2, 3]), false, 'wrong length');
  assert.equal(isValidEmbedding(dim(() => NaN)), false, 'NaN not finite');
  assert.equal(isValidEmbedding(dim(() => Infinity)), false, 'Infinity not finite');
  assert.equal(isValidEmbedding(undefined), false);
  assert.equal(isValidEmbedding('nope'), false);
  const withString = dim(() => 1);
  withString[7] = '1';
  assert.equal(isValidEmbedding(withString), false, 'string element rejected');
});

test('cosineSimilarity: identical=1, orthogonal=0, opposite=-1, normalizes magnitude', () => {
  const a = [1, 0, 0, 0];
  const b = [1, 0, 0, 0];
  const orth = [0, 1, 0, 0];
  const opp = [-1, 0, 0, 0];
  assert.ok(Math.abs(cosineSimilarity(a, b) - 1) < 1e-12);
  assert.equal(cosineSimilarity(a, orth), 0);
  assert.ok(Math.abs(cosineSimilarity(a, opp) + 1) < 1e-12);
  // Direction, not magnitude: scaling one vector doesn't change the score.
  assert.ok(Math.abs(cosineSimilarity([2, 2], [5, 5]) - 1) < 1e-12);
});

test('cosineSimilarity: guards length mismatch and zero-magnitude with -1 (never false-high)', () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2]), -1, 'length mismatch');
  assert.equal(cosineSimilarity([0, 0, 0], [1, 2, 3]), -1, 'zero-magnitude probe');
  assert.equal(cosineSimilarity(null, [1]), -1);
});

test('bestMatchScore: returns the max over samples, -1 for an empty gallery', () => {
  const probe = [1, 0, 0];
  const samples = [
    [0, 1, 0], // 0
    [0.7, 0.7, 0], // ~0.707
    [1, 0, 0], // 1 (best)
  ];
  assert.ok(Math.abs(bestMatchScore(probe, samples) - 1) < 1e-12);
  assert.equal(bestMatchScore(probe, []), -1, 'empty gallery cannot match');
});
