// 24-hour voting cycle utilities
// Each cycle runs from 00:00 UTC → 23:59:59 UTC

function getCurrentCycleStart() {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0
  ));
}

function getVotingWindowEnd() {
  const start = getCurrentCycleStart();
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function getTimeUntilVotingEnd() {
  const end = getVotingWindowEnd();
  const now = new Date();
  const ms = Math.max(0, end - now);
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return { days: 0, hours, minutes, total_ms: ms };
}

// Returns a stable key for the current 24h cycle (UTC date timestamp in ms)
function getCurrentWeekKey() {
  return getCurrentCycleStart().getTime();
}

module.exports = { getCurrentWeek: getCurrentCycleStart, getVotingWindowEnd, getTimeUntilVotingEnd, getCurrentWeekKey };
