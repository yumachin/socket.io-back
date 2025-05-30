import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import redisClient from './redisClient.js';

const app = express();
app.use(cors()); // フロントエンドからの接続を許可

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // Next.jsのURL
    methods: ["GET", "POST"]
  }
});

const MAX_MEMBERS = 6;

// 接続時の処理
io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // ルーム作成処理
  socket.on('createRoom', async ({ password, user }) => {
    const roomKey = `room:${password}`;
    const roomExists = await redisClient.exists(roomKey);

    if (roomExists) {
      socket.emit('error', { message: 'この合言葉は既に使用されています。' });
      return;
    }

    const roomInfo = {
      host: socket.id,
      members: JSON.stringify([{ id: socket.id, name: user.name }]),
      status: 'waiting',
    };

    await redisClient.hset(roomKey, roomInfo);
    socket.join(password);
    socket.emit('roomCreated', { password });
    updateRoomInfo(password);
  });

  // ルーム参加処理
  socket.on('joinRoom', async ({ password, user }) => {
    const roomKey = `room:${password}`;
    const roomExists = await redisClient.exists(roomKey);

    if (!roomExists) {
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }

    const membersJson = await redisClient.hget(roomKey, 'members');
    const members = JSON.parse(membersJson);

    if (members.length >= MAX_MEMBERS) {
      socket.emit('error', { message: 'このルームは満員です。' });
      return;
    }

    if (members.some(member => member.id === socket.id)) {
        // すでに参加済みの場合は何もしないか、あるいは再接続処理
        socket.join(password);
        socket.emit('roomJoined', { password });
        updateRoomInfo(password);
        return;
    }

    const newMembers = [...members, { id: socket.id, name: user.name }];
    await redisClient.hset(roomKey, 'members', JSON.stringify(newMembers));
    
    socket.join(password);
    socket.emit('roomJoined', { password });
    updateRoomInfo(password);
  });

  // ゲーム開始処理
  socket.on('startGame', async ({ password }) => {
      const roomKey = `room:${password}`;
      const hostId = await redisClient.hget(roomKey, 'host');
      const membersJson = await redisClient.hget(roomKey, 'members');
      const members = JSON.parse(membersJson);

      // ホストかつ2人以上の場合のみ開始可能
      if (socket.id === hostId && members.length >= 2) {
          await redisClient.hset(roomKey, 'status', 'playing');
          io.to(password).emit('gameStarted');
      }
  });

  // ルーム情報取得処理（参加はしない）
  socket.on('getRoomInfo', async ({ password }) => {
    const roomKey = `room:${password}`;
    const roomExists = await redisClient.exists(roomKey);

    if (!roomExists) {
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }

    // socketをルームに参加させる（通信のため）
    socket.join(password);
    
    // ルーム情報を送信
    updateRoomInfo(password);
  });

  // 切断時の処理
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.id}`);
    // ユーザーがどのルームにいたかを探し、退出処理を行う
    // (ここでは簡略化のため、クライアント側からの退出イベントを想定)
    // 本番環境では、全ルームをスキャンするか、socket.idとルーム名を紐付けるデータ構造が必要です
  });
});

// ルーム情報を更新して全員に通知するヘルパー関数
const updateRoomInfo = async (password) => {
  const roomKey = `room:${password}`;
  const roomInfo = await redisClient.hgetall(roomKey);
  const members = JSON.parse(roomInfo.members || '[]');
  
  io.to(password).emit('updateRoom', {
      host: roomInfo.host,
      members: members,
      status: roomInfo.status,
  });
};


const PORT = 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});