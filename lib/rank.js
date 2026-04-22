// Smart "For You" ranking. Pure scoring helpers — no DB.
//
// Score combines engagement strength with recency decay so fresh content
// surfaces while genuinely viral older content can still beat it.
//
//   engagement = likes*3 + saves*4 + reposts*5 + remixes*6 + shares*2
//                + views*0.4 + loops*0.3 + comments*2
//   recency    = exp(-ageHours / HALF_LIFE_HOURS) * 1000
//   penalty    = reportCount * 25
//
// Tunable per call via opts.

const HALF_LIFE_HOURS = 36;

function engagement(v) {
  return (v.likes || 0) * 3
    + (v.saves || 0) * 4
    + (v.reposts || 0) * 5
    + (v.remixCount || 0) * 6
    + (v.shares || 0) * 2
    + (v.views || 0) * 0.4
    + (v.loops || 0) * 0.3
    + (v.commentCount || 0) * 2;
}

function ageHours(v) {
  const created = v.createdAt ? new Date(v.createdAt).getTime() : Date.now();
  return Math.max(0, (Date.now() - created) / 3600000);
}

function recencyBoost(v, halfLife = HALF_LIFE_HOURS) {
  return Math.exp(-ageHours(v) / halfLife) * 1000;
}

function scoreVideo(v, opts = {}) {
  const halfLife = opts.halfLifeHours || HALF_LIFE_HOURS;
  const eng = engagement(v);
  const rec = recencyBoost(v, halfLife);
  const penalty = (v.reportCount || 0) * 25;
  const followedBoost = opts.followedIds && opts.followedIds.has(String(v.creator?._id || v.creator)) ? 250 : 0;
  return eng + rec + followedBoost - penalty;
}

function rankVideos(videos, opts = {}) {
  return videos
    .map(v => {
      const obj = typeof v.toObject === 'function' ? v.toObject() : v;
      obj._score = scoreVideo(obj, opts);
      return obj;
    })
    .sort((a, b) => b._score - a._score);
}

module.exports = { scoreVideo, rankVideos, engagement, recencyBoost };
