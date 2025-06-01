// redisClient.js  —— Upstash REST ラッパー（ioredis 互換サブセット）

import { Redis } from "@upstash/redis";
import "dotenv/config";

// REST クライアント本体
const rest = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/* --- ioredis っぽい極小 API ラップ --- */
const redisClient = {
  /* HSET: 旧 (key, field, value) / (key, obj) の2パターン対応 */
  hset: async (key, field, value) => {
    if (typeof field === "object") {
      return rest.hset(key, field);              // (key, obj)
    }
    return rest.hset(key, { [field]: value });   // (key, field, value)
  },

  hget:      (key, field)         => rest.hget(key, field),
  hgetall:   (key)                => rest.hgetall(key),
  exists:    (key)                => rest.exists(key),
  del:       (key)                => rest.del(key),
};

/* ダミーイベントで server.js の .on('error') 呼び出しを回避 */
redisClient.on   = () => {};
redisClient.once = (_, cb) => setTimeout(cb, 0); // 即座に「接続成功」風ログを出す

export default redisClient;
export { redisClient };
