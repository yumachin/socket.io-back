import Redis from 'ioredis';

// Redisクライアントのインスタンスを作成
// 環境変数などから接続情報を取得するのが一般的です
const redisClient = new Redis({
  host: 'localhost', // Redisサーバーのホスト
  port: 6379,      // Redisサーバーのポート
});

redisClient.on('connect', () => {
  console.log('Redisクライアントが接続されました');
});

redisClient.on('error', (err) => {
  console.error('Redisクライアントの接続エラー', err);
});

export default redisClient;