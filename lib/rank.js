// Smart "For You" ranking.
//
// Per-video score:
//   base       = views*1 + likes*3 + comments*5 + saves*4 + shares*6
//   recency    = exp(-ageHours / HALF_LIFE_HOURS)              // multiplicative
//   interaction= 1 + INTERACTION_WEIGHT  if viewer has previously
//                                        liked/commented/followed creator
//   score      = base * recency * interaction - reportPenalty
//
// After scoring, results are re-ordered to enforce diversity: the same
// creator may not appear twice in a row in the final feed (a video gets
// pushed back one slot until that constraint is satisfied).
//
// Anonymous callers don't go through ranking — the route hands back raw
// reverse-chronological so first-time visitors aren't fingerprinted.

const HALF_LIFE_HOURS = 36;
const INTERACTION_WEIGHT = 0.5;
const REPORT_PENALTY_PER = 25;

function baseScore(v) {
  return (v.views || 0) * 1
    + (v.likes || 0) * 3
    + (v.commentCount || 0) * 5
    + (v.saves || 0) * 4
    + (v.shares || 0) * 6;
}

function ageHours(v) {
  const created = v.createdAt ? new Date(v.createdAt).getTime() : Date.now();
  return Math.max(0, (Date.now() - created) / 3600000);
}

function recencyDecay(v, halfLife = HALF_LIFE_HOURS) {
  return Math.exp(-ageHours(v) / halfLife);
}

function creatorIdOf(v) {
  return String(v.creator?._id || v.creator || '');
}

function scoreVideo(v, opts = {}) {
  const halfLife = opts.halfLifeHours || HALF_LIFE_HOURS;
  const base = baseScore(v) || 1; // avoid pure-zero fresh upload sinking
  const rec = recencyDecay(v, halfLife);
  const interacted = opts.interactedCreators
    && opts.interactedCreators.has(creatorIdOf(v));
  const interaction = 1 + (interacted ? INTERACTION_WEIGHT : 0);
  const penalty = (v.reportCount || 0) * REPORT_PENALTY_PER;
  return base * rec * interaction - penalty;
}

// Re-order so the same creator never appears in two adjacent slots.
// Walks the list and, when a duplicate-creator collision is detected, swaps
// the offending video with the next eligible one further down the list.
function applyDiversity(videos) {
  const out = videos.slice();
  for (let i = 1; i < out.length; i++) {
    if (creatorIdOf(out[i]) !== creatorIdOf(out[i - 1])) continue;
    let swap = -1;
    for (let j = i + 1; j < out.length; j++) {
      if (creatorIdOf(out[j]) !== creatorIdOf(out[i - 1])
          && (j + 1 >= out.length || creatorIdOf(out[j]) !== creatorIdOf(out[i + 1] || {}))) {
        swap = j; break;
      }
    }
    if (swap !== -1) {
      const tmp = out[i]; out[i] = out[swap]; out[swap] = tmp;
    }
  }
  return out;
}

function rankVideos(videos, opts = {}) {
  const scored = videos.map(v => {
    const obj = typeof v.toObject === 'function' ? v.toObject() : v;
    obj._score = scoreVideo(obj, opts);
    return obj;
  }).sort((a, b) => b._score - a._score);
  return applyDiversity(scored);
}

module.exports = {
  scoreVideo, rankVideos, baseScore, recencyDecay, applyDiversity,
  HALF_LIFE_HOURS, INTERACTION_WEIGHT
};
