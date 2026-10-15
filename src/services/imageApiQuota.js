function createImageApiQuota(db, { minuteLimit, dailyLimit }) {
  const read = db.prepare('SELECT * FROM image_api_usage WHERE key_hash = ?');
  const write = db.prepare(`
    INSERT INTO image_api_usage (key_hash, minute_start, minute_count, day_start, day_count)
    VALUES (@key_hash, @minute_start, @minute_count, @day_start, @day_count)
    ON CONFLICT(key_hash) DO UPDATE SET
      minute_start = excluded.minute_start, minute_count = excluded.minute_count,
      day_start = excluded.day_start, day_count = excluded.day_count
  `);
  return db.transaction((keyHash, now = Date.now()) => {
    const minuteStart = Math.floor(now / 60000) * 60000;
    const dayStart = Math.floor(now / 86400000) * 86400000;
    const previous = read.get(keyHash);
    const minuteCount = previous?.minute_start === minuteStart ? previous.minute_count : 0;
    const dayCount = previous?.day_start === dayStart ? previous.day_count : 0;
    const reset = dayCount >= dailyLimit ? dayStart + 86400000
      : minuteCount >= minuteLimit ? minuteStart + 60000 : null;
    if (reset) return { allowed: false, retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)) };
    write.run({
      key_hash: keyHash, minute_start: minuteStart, minute_count: minuteCount + 1,
      day_start: dayStart, day_count: dayCount + 1
    });
    return { allowed: true };
  });
}

module.exports = { createImageApiQuota };
