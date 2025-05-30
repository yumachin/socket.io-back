import Redis from 'ioredis';

// Redisクライアントのインスタンスを作成
// 環境変数などから接続情報を取得するのが一般的です
const redisClient = new Redis({
  host: 'localhost', // Redisサーバーのホスト
  port: 6379,      // Redisサーバーのポート
});

redisClient.on('connect', () => {
  console.log('Redis client connected');
});

redisClient.on('error', (err) => {
  console.error('Redis connection error:', err);
});

export default redisClient;