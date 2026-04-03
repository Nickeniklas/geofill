/**
 * fuzzy.js — Levenshtein distance and near-miss matching for geofill
 * No dependencies. Exposed as globals: normalize(), levenshtein(), findNearMiss()
 */

/**
 * Normalize a string for comparison:
 * - lowercase
 * - trim whitespace
 * - strip diacritics (é → e, ü → u, etc.)
 * - collapse multiple spaces
 * - strip punctuation except spaces
 */
function normalize(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritical marks
    .replace(/[^a-z0-9 ]/g, ' ')       // replace non-alphanumeric with space
    .replace(/\s+/g, ' ')              // collapse multiple spaces
    .trim();
}

/**
 * Compute Levenshtein edit distance between two strings.
 * Uses the standard DP approach, O(mn) time.
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  // Use two rows to save memory
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Given a typed input and an array of remaining country objects,
 * return the closest near-miss match within `threshold` edit distance.
 *
 * Each country object must have: { id, name, aliases: [] }
 *
 * Returns the best-matching country object (with a `.suggestion` property
 * set to the matched alias/name text), or null if no match is within threshold.
 *
 * Only runs if input is >= 3 chars to avoid spammy hints.
 */
function findNearMiss(input, countries, threshold) {
  threshold = threshold === undefined ? 2 : threshold;
  const normInput = normalize(input);

  if (normInput.length < 3) return null;

  let best = null;
  let bestDist = Infinity;

  for (const country of countries) {
    // Check the canonical name
    const nameDist = levenshtein(normInput, normalize(country.name));
    if (nameDist < bestDist) {
      bestDist = nameDist;
      best = country;
    }

    // Check each alias
    if (country.aliases) {
      for (const alias of country.aliases) {
        const aliasDist = levenshtein(normInput, normalize(alias));
        if (aliasDist < bestDist) {
          bestDist = aliasDist;
          best = country;
        }
      }
    }
  }

  if (best !== null && bestDist <= threshold && bestDist > 0) {
    return best;
  }
  return null;
}

/**
 * Check if input is an exact match (distance 0) against any country
 * name or alias. Returns the matching country object or null.
 */
function findExactMatch(input, countries) {
  const normInput = normalize(input);
  if (normInput.length === 0) return null;

  for (const country of countries) {
    if (normalize(country.name) === normInput) return country;
    if (country.aliases) {
      for (const alias of country.aliases) {
        if (normalize(alias) === normInput) return country;
      }
    }
  }
  return null;
}

// Expose globals
window.normalize = normalize;
window.levenshtein = levenshtein;
window.findNearMiss = findNearMiss;
window.findExactMatch = findExactMatch;
