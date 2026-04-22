// Smart "For You" ranking.
//
// Per-video score:
//   base       = views*1 + likes*3 + comments*5 + saves*4 + shares*6
//   recency    = 0.5 ^ (ageHours / 24)               // multiplicative, 24h half-life
//   interaction= 1.5 if viewer has previously liked or commented on this creator,
//                1.2 if viewer only follows the creator,
//                1.0 otherwise (use the higher of the two when both apply)
//   score      = base * recency * interaction - reportPenalty
//
// After scoring, results pass through a diversity step: if the same creator
// would appear in two consecutive slots, the second copy is multiplied by
// 0.6; the third (or later) consecutive copy is multiplied by 0.3. The list
// is then re-sorted, so in practice no creator ever appears more than twice
// in a row.
//
// Anonymous callers don't go through ranking — the route hands back raw
// reverse-chronological so first-time visitors aren't fingerprinted.

const HALF_LIFE_HOURS = 24;
const INTERACTION_BONUS = 0.5;          // 1.5x
const FOLLOW_BONUS = 0.2;               // 1.2x
const REPORT_PENALTY_PER = 25;
const DIVERSITY_PENALTY_2ND = 0.6;
const DIVERSITY_PENALTY_3RD = 0.3;

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
  return Math.pow(0.5, ageHours(v) / halfLife);
}

function creatorIdOf(v) {
  return String(v.creator?._id || v.creator || '');
}

function interactionMultiplier(v, opts) {
  const cid = creatorIdOf(v);
  if (opts.interactedCreators && opts.interactedCreators.has(cid)) {
    return 1 + INTERACTION_BONUS;
  }
  if (opts.followedCreators && opts.followedCreators.has(cid)) {
    return 1 + FOLLOW_BONUS;
  }
  return 1;
}

function scoreVideo(v, opts = {}) {
  const halfLife = opts.halfLifeHours || HALF_LIFE_HOURS;
  const base = baseScore(v) || 1; // avoid pure-zero fresh upload sinking
  const rec = recencyDecay(v, halfLife);
  const interaction = interactionMultiplier(v, opts);
  const penalty = (v.reportCount || 0) * REPORT_PENALTY_PER;
  return base * rec * interaction - penalty;
}

// Two-stage diversity:
//   1. Soft penalty (kept for tunability): 2nd consecutive same creator gets
//      0.6x score, 3rd+ gets 0.3x, then re-sort.
//   2. Hard interleave: greedy pass over per-creator score-ordered queues
//      that GUARANTEES no creator appears more than twice in a row. At each
//      slot we pick the highest-scoring queue head; if choosing it would
//      create a 3rd-in-a-row, we pick the next best different-creator head.
//      Only when literally no other creator has remaining items do we allow
//      a 3rd in a row (degenerate single-creator pool).
function applyDiversityPenalty(scored) {
  let prev = null, run = 0;
  for (const v of scored) {
    const cid = creatorIdOf(v);
    if (cid === prev) {
      run++;
      if (run === 1) v._score *= DIVERSITY_PENALTY_2ND;
      else v._score *= DIVERSITY_PENALTY_3RD;
    } else { run = 0; prev = cid; }
  }
  scored.sort((a, b) => b._score - a._score);
  return scored;
}

function enforceConsecutiveCap(scored, cap = 2) {
  // Bucket by creator, preserving score order within each bucket.
  const buckets = new Map();
  for (const v of scored) {
    const cid = creatorIdOf(v);
    if (!buckets.has(cid)) buckets.set(cid, []);
    buckets.get(cid).push(v);
  }
  const out = [];
  let lastCid = null, runLen = 0;
  while (out.length < scored.length) {
    // Candidate creators with items remaining, sorted by next item's score.
    const heads = [];
    for (const [cid, list] of buckets) {
      if (list.length) heads.push({ cid, score: list[0]._score });
    }
    if (!heads.length) break;
    heads.sort((a, b) => b.score - a.score);

    // Pick best head that doesn't violate the cap. If picking the best
    // would create a (cap+1)-in-a-row and there is NO alternative creator
    // with items remaining, stop building the feed — a shorter feed that
    // honours the diversity guarantee is preferable to a long one that
    // breaks it. (In practice this only matters in the degenerate case
    // where one creator dominates the entire candidate pool.)
    let chosen = heads[0];
    if (chosen.cid === lastCid && runLen >= cap) {
      const alt = heads.find(h => h.cid !== lastCid);
      if (!alt) break;
      chosen = alt;
    }
    out.push(buckets.get(chosen.cid).shift());
    if (chosen.cid === lastCid) runLen++; else { lastCid = chosen.cid; runLen = 1; }
  }
  return out;
}

function rankVideos(videos, opts = {}) {
  const scored = videos.map(v => {
    const obj = typeof v.toObject === 'function' ? v.toObject() : v;
    obj._score = scoreVideo(obj, opts);
    return obj;
  }).sort((a, b) => b._score - a._score);
  const penalised = applyDiversityPenalty(scored);
  return enforceConsecutiveCap(penalised, 2);
}

module.exports = {
  scoreVideo, rankVideos, baseScore, recencyDecay,
  applyDiversityPenalty, enforceConsecutiveCap,
  HALF_LIFE_HOURS, INTERACTION_BONUS, FOLLOW_BONUS,
  DIVERSITY_PENALTY_2ND, DIVERSITY_PENALTY_3RD
};
