import dotenv from "dotenv";
const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.development";
dotenv.config({ path: envFile });

import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("❌ REDIS_URL が設定されていません。環境変数を確認してください。");
}

// rediss:// なら TLS 必須（Upstash など）
const redisClient = new Redis(redisUrl, redisUrl.startsWith("rediss://") ? { tls: {} } : {});

// 接続イベントは 1 回だけログに出す
redisClient.once("connect", () => console.log("✅ Redis に接続されました"));
redisClient.on("error", err => console.error("❌ Redis クライアント接続エラー:", err));

export default redisClient;