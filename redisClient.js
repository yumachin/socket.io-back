// redisClient.ts
import { Redis } from "@upstash/redis";
import "dotenv/config";

const rest = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/* 文字列化ヘルパ */
const toStr = (v) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));

const redisClient = {
  /* ---------- HASH ---------- */
  hset: async (key, field, value) => {
    if (typeof field === "object") return rest.hset(key, field);
    return rest.hset(key, { [field]: value });
  },
  hget: async (key, field) => toStr(await rest.hget(key, field)),
  hgetall: async (key) => {
    const data = await rest.hgetall(key);
    const obj = {};
    for (const k in data) obj[k] = toStr(data[k]);
    return obj;
  },
  hdel: async (key, field) => {
    return rest.hdel(key, [field]); // Upstashの仕様：第2引数は配列
  },

  /* ---------- KEY ---------- */
  exists: (key) => rest.exists(key),
  del: (key) => rest.del(key),

  /* ---------- SORTED SET ---------- */
  zadd: (key, { score, member }) =>
    rest.zadd(key, { score, member }),
  zincrby: (key, increment, member) =>
    rest.zincrby(key, increment, member),
};

export default redisClient;
export { redisClient };
