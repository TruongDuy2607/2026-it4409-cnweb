// Bộ giới hạn đăng nhập sai trong bộ nhớ, khóa theo cặp địa chỉ IP và email.
// Phù hợp một tiến trình duy nhất. Nếu chạy nhiều tiến trình cần lưu bộ đếm ở Redis hoặc MongoDB.
function createLoginLimiter({ maxAttempts, windowMs }) {
  const hits = new Map(); // key -> { count, resetAt }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, v] of hits) if (v.resetAt <= now) hits.delete(key);
  }, 60 * 1000);
  sweep.unref();

  return {
    // Trả về số giây phải chờ nếu đã vượt ngưỡng, ngược lại trả về 0
    retryAfter(key) {
      const v = hits.get(key);
      if (!v || v.resetAt <= Date.now() || v.count < maxAttempts) return 0;
      return Math.ceil((v.resetAt - Date.now()) / 1000);
    },
    recordFailure(key) {
      const now = Date.now();
      const v = hits.get(key);
      if (!v || v.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
      else v.count += 1;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

module.exports = { createLoginLimiter };
