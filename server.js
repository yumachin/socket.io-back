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

  // ユーザーIDを設定
  socket.on('setUserId', ({ userId, userName }) => {
    socket.userId = userId;
    socket.userName = userName;
    console.log(`User ID set: ${userId}, Name: ${userName}`);
  });

  // ルーム作成処理
  socket.on('createRoom', async ({ password, user }) => {
    console.log(`Creating room with password: "${password}" (length: ${password.length})`);
    
    socket.userId = user.id;
    socket.userName = user.name;
    
    const roomKey = `room:${password}`;
    const roomExists = await redisClient.exists(roomKey);

    if (roomExists) {
      socket.emit('error', { message: 'この合言葉は既に使用されています。' });
      return;
    }

    const roomInfo = {
      host: user.id,
      members: JSON.stringify([{ id: user.id, name: user.name }]),
      status: 'waiting',
    };

    await redisClient.hset(roomKey, roomInfo);
    socket.join(password);
    socket.emit('roomCreated', { password });
    updateRoomInfo(password);
    console.log(`Room created successfully: "${password}"`);
  });

  // ルーム参加処理
  socket.on('joinRoom', async ({ password, user }) => {
    console.log(`Join room request: "${password}" (length: ${password.length}), User:`, user);
    
    socket.userId = user.id;
    socket.userName = user.name;
    
    const roomKey = `room:${password}`;
    const roomExists = await redisClient.exists(roomKey);

    if (!roomExists) {
      console.log(`Room "${password}" not found`);
      console.log('Available rooms:', await redisClient.keys('room:*'));
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }

    const membersJson = await redisClient.hget(roomKey, 'members');
    const members = JSON.parse(membersJson);

    if (members.length >= MAX_MEMBERS) {
      console.log(`Room ${password} is full`);
      socket.emit('error', { message: 'このルームは満員です。' });
      return;
    }

    // ユーザーIDで重複チェック
    if (members.some(member => member.id === user.id)) {
        console.log(`User ${user.id} rejoining room ${password}`);
        socket.join(password);
        socket.emit('roomJoined', { password });
        updateRoomInfo(password);
        return;
    }

    console.log(`Adding user ${user.id} to room ${password}`);
    const newMembers = [...members, { id: user.id, name: user.name }];
    await redisClient.hset(roomKey, 'members', JSON.stringify(newMembers));
    
    socket.join(password);
    socket.emit('roomJoined', { password });
    updateRoomInfo(password);
    console.log(`User ${user.id} successfully joined room ${password}`);
  });

  // ルーム退出処理
  socket.on('leaveRoom', async ({ password, userId }) => {
    const roomKey = `room:${password}`;
    const roomExists = await redisClient.exists(roomKey);

    if (!roomExists) {
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }

    const membersJson = await redisClient.hget(roomKey, 'members');
    const members = JSON.parse(membersJson);
    const hostId = await redisClient.hget(roomKey, 'host');

    // ホストが退出する場合、ルーム全体を削除
    if (hostId === userId) {
      // ルーム削除
      await redisClient.del(roomKey);
      // 全メンバーにルーム削除を通知
      io.to(password).emit('roomDeleted');
      console.log(`Room ${password} deleted - host left`);
    } else {
      // ホスト以外のメンバーが退出する場合
      const updatedMembers = members.filter(member => member.id !== userId);
      
      if (updatedMembers.length === 0) {
        // 最後のメンバーが退出した場合、ルームを削除
        await redisClient.del(roomKey);
        io.to(password).emit('roomDeleted');
        console.log(`Room ${password} deleted - no members left`);
      } else {
        // メンバーリストを更新
        await redisClient.hset(roomKey, 'members', JSON.stringify(updatedMembers));
        // ルーム情報を更新
        updateRoomInfo(password);
      }
    }

    // 退出したユーザーにのみ退出完了を通知
    socket.leave(password);
    socket.emit('roomLeft');
    console.log(`User ${userId} left room ${password}`);
  });

  // ゲーム開始処理
  socket.on('startGame', async ({ password }) => {
      const roomKey = `room:${password}`;
      const hostId = await redisClient.hget(roomKey, 'host');
      const membersJson = await redisClient.hget(roomKey, 'members');
      const members = JSON.parse(membersJson);

      // ホストかつ2人以上の場合のみ開始可能
      if (socket.userId === hostId && members.length >= 2) {
          await redisClient.hset(roomKey, 'status', 'playing');
          io.to(password).emit('gameStarted');
      }
  });

  // ルーム情報取得処理
  socket.on('getRoomInfo', async ({ password, userId }) => {
    console.log(`Get room info request: "${password}" (length: ${password.length}), User: ${userId}`);
    
    const roomKey = `room:${password}`;
    const roomExists = await redisClient.exists(roomKey);

    if (!roomExists) {
      console.log(`Room "${password}" not found for getRoomInfo`);
      console.log('Available rooms:', await redisClient.keys('room:*'));
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }

    const membersJson = await redisClient.hget(roomKey, 'members');
    const members = JSON.parse(membersJson);
    
    // ユーザーIDがメンバーリストにあるかチェック
    const memberExists = members.some(member => member.id === userId);
    
    if (!memberExists) {
      socket.emit('error', { message: 'このルームのメンバーではありません。' });
      return;
    }

    // socketをルームに参加させる（通信のため）
    socket.join(password);
    
    // ルーム情報を送信
    updateRoomInfo(password);
  });

  // 切断時の処理
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.id} (UserID: ${socket.userId})`);
    
    // 接続が切断された場合も自動的にルームから退出させる
    if (socket.userId) {
      // 全ルームをスキャンしてユーザーを探す（簡略化された実装）
      const keys = await redisClient.keys('room:*');
      for (const roomKey of keys) {
        const membersJson = await redisClient.hget(roomKey, 'members');
        if (membersJson) {
          const members = JSON.parse(membersJson);
          if (members.some(member => member.id === socket.userId)) {
            const password = roomKey.replace('room:', '');
            socket.emit('leaveRoom', { password, userId: socket.userId });
            break;
          }
        }
      }
    }
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