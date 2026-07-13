// Shared helpers for constructing session-window settings in tests.
//
// sessionOf() in checkInService.js uses non-wrapping start<=t<=end
// comparisons, so windows built from "now" must never cross midnight —
// clamp keeps every derived minute inside a single day.
const clamp = (v) => Math.min(1439, Math.max(0, v));

const hhmm = (v) => {
  const w = clamp(v);
  return `${String(Math.floor(w / 60)).padStart(2, '0')}:${String(w % 60).padStart(2, '0')}`;
};

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

// [start, end] offset from `mins` by [lo, hi] minutes, placed on whichever
// side of `mins` keeps the window from crossing midnight.
const awayWindow = (mins, lo, hi) => (mins < 720 ? [mins + lo, mins + hi] : [mins - hi, mins - lo]);

module.exports = { clamp, hhmm, nowMinutes, awayWindow };
