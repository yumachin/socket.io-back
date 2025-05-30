import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import redisClient from './redisClient.js';

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const MAX_MEMBERS = 6;

// サンプルクイズデータ
const quizQuestions = [
  {
    question: "日本の首都はどこですか？",
    options: ["大阪", "東京", "京都", "名古屋"],
    correctAnswer: 1
  },
  {
    question: "2 + 2 = ?",
    options: ["3", "4", "5", "6"],
    correctAnswer: 1
  },
  {
    question: "世界で最も大きな海洋は？",
    options: ["大西洋", "インド洋", "太平洋", "北極海"],
    correctAnswer: 2
  }
];

// タイマー管理用のオブジェクト
const roomTimers = {};

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
    console.log(`Creating room with password: "${password}"`);
    
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
    console.log(`Join room request: "${password}", User:`, user);
    
    socket.userId = user.id;
    socket.userName = user.name;
    
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

    // ユーザーIDで重複チェック
    if (members.some(member => member.id === user.id)) {
        socket.join(password);
        socket.emit('roomJoined', { password });
        updateRoomInfo(password);
        return;
    }

    const newMembers = [...members, { id: user.id, name: user.name }];
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
      if (socket.userId === hostId && members.length >= 2) {
          await redisClient.hset(roomKey, 'status', 'playing');
          
          // ゲーム状態を初期化
          const gameState = {
            currentQuestion: 0,
            usersReady: [],
            answers: {},
            scores: {},
            startTime: null,
            timeLeft: 30
          };
          
          // 既存のタイマーをクリア
          if (roomTimers[password]) {
            clearInterval(roomTimers[password]);
            delete roomTimers[password];
          }
          
          await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));
          
          // 全員にゲーム開始を通知
          io.to(password).emit('gameStarted');
          console.log(`Game started for room: ${password}`);
      }
  });

  // ユーザーがゲームページに到達したことを通知
  socket.on('userReadyForGame', async ({ password, userId }) => {
    const roomKey = `room:${password}`;
    const gameStateJson = await redisClient.hget(roomKey, 'gameState');
    const membersJson = await redisClient.hget(roomKey, 'members');
    
    if (!gameStateJson || !membersJson) return;
    
    const gameState = JSON.parse(gameStateJson);
    const members = JSON.parse(membersJson);
    
    // ユーザーを準備完了リストに追加
    if (!gameState.usersReady.includes(userId)) {
      gameState.usersReady.push(userId);
      await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));
    }
    
    socket.join(password);
    
    // 全員が準備できているかチェック
    if (gameState.usersReady.length === members.length) {
      // 最初の問題を開始
      startQuestion(password, 0);
    } else {
      // 待機中の状態を送信
      const readyUserNames = members
        .filter(member => gameState.usersReady.includes(member.id))
        .map(member => member.name);
        
      io.to(password).emit('gameStateUpdate', {
        gamePhase: 'waiting',
        waitingForUsers: readyUserNames,
        allUsersReady: false
      });
    }
  });

  // 回答送信処理
  socket.on('submitAnswer', async ({ password, userId, answerIndex, timeLeft }) => {
    const roomKey = `room:${password}`;
    const gameStateJson = await redisClient.hget(roomKey, 'gameState');
    
    if (!gameStateJson) return;
    
    const gameState = JSON.parse(gameStateJson);
    const currentQ = gameState.currentQuestion;
    
    // 回答を記録
    if (!gameState.answers[currentQ]) {
      gameState.answers[currentQ] = {};
    }
    gameState.answers[currentQ][userId] = {
      answer: answerIndex,
      timeLeft: timeLeft
    };
    
    await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));
    
    // 全員が回答したかチェック
    const membersJson = await redisClient.hget(roomKey, 'members');
    const members = JSON.parse(membersJson);
    const answeredCount = Object.keys(gameState.answers[currentQ] || {}).length;
    
    if (answeredCount === members.length) {
      // 結果処理と次の問題へ
      processQuestionResults(password, currentQ);
    }
  });

  // その他の既存イベント
  socket.on('getRoomInfo', async ({ password, userId }) => {
    const roomKey = `room:${password}`;
    const roomExists = await redisClient.exists(roomKey);

    if (!roomExists) {
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }

    const membersJson = await redisClient.hget(roomKey, 'members');
    const members = JSON.parse(membersJson);
    
    const memberExists = members.some(member => member.id === userId);
    
    if (!memberExists) {
      socket.emit('error', { message: 'このルームのメンバーではありません。' });
      return;
    }

    socket.join(password);
    updateRoomInfo(password);
  });

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

    // タイマーをクリア
    if (roomTimers[password]) {
      clearInterval(roomTimers[password]);
      delete roomTimers[password];
    }

    // ホストが退出する場合、ルーム全体を削除
    if (hostId === userId) {
      await redisClient.del(roomKey);
      io.to(password).emit('roomDeleted');
      console.log(`Room ${password} deleted - host left`);
    } else {
      const updatedMembers = members.filter(member => member.id !== userId);
      
      if (updatedMembers.length === 0) {
        await redisClient.del(roomKey);
        io.to(password).emit('roomDeleted');
        console.log(`Room ${password} deleted - no members left`);
      } else {
        await redisClient.hset(roomKey, 'members', JSON.stringify(updatedMembers));
        updateRoomInfo(password);
      }
    }

    socket.leave(password);
    socket.emit('roomLeft');
    console.log(`User ${userId} left room ${password}`);
  });

  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// 問題開始関数
const startQuestion = async (password, questionIndex) => {
  if (questionIndex >= quizQuestions.length) {
    endGame(password);
    return;
  }
  
  const question = quizQuestions[questionIndex];
  const roomKey = `room:${password}`;
  
  // 既存のタイマーをクリア
  if (roomTimers[password]) {
    clearInterval(roomTimers[password]);
  }
  
  const gameStateJson = await redisClient.hget(roomKey, 'gameState');
  if (!gameStateJson) return;
  
  const gameState = JSON.parse(gameStateJson);
  gameState.currentQuestion = questionIndex;
  gameState.startTime = Date.now();
  gameState.timeLeft = 30;
  await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));
  
  // 問題を送信
  io.to(password).emit('gameStateUpdate', {
    question: question.question,
    options: question.options,
    timeLeft: 30,
    gamePhase: 'showQuestion',
    questionNumber: questionIndex + 1,
    totalQuestions: quizQuestions.length,
    allUsersReady: true
  });
  
  // タイマーを開始（1秒ごとに更新）
  roomTimers[password] = setInterval(async () => {
    const currentGameStateJson = await redisClient.hget(roomKey, 'gameState');
    if (!currentGameStateJson) {
      clearInterval(roomTimers[password]);
      delete roomTimers[password];
      return;
    }
    
    const currentGameState = JSON.parse(currentGameStateJson);
    const elapsed = Math.floor((Date.now() - currentGameState.startTime) / 1000);
    const timeLeft = Math.max(0, 35 - elapsed); // 5秒表示 + 30秒回答
    
    currentGameState.timeLeft = Math.max(0, 30 - Math.max(0, elapsed - 5)); // 回答時間のカウントダウン
    await redisClient.hset(roomKey, 'gameState', JSON.stringify(currentGameState));
    
    // クライアントに時間更新を送信
    io.to(password).emit('timeUpdate', { 
      timeLeft: currentGameState.timeLeft,
      totalTimeLeft: timeLeft
    });
    
    if (timeLeft <= 0) {
      clearInterval(roomTimers[password]);
      delete roomTimers[password];
      processQuestionResults(password, questionIndex);
    }
  }, 1000);
};

// 問題結果処理関数
const processQuestionResults = async (password, questionIndex) => {
  const roomKey = `room:${password}`;
  const gameStateJson = await redisClient.hget(roomKey, 'gameState');
  
  // nullチェックを追加
  if (!gameStateJson) {
    console.error(`No game state found for room ${password}`);
    return;
  }
  
  const gameState = JSON.parse(gameStateJson);
  
  // answersが存在しない場合の初期化
  if (!gameState.answers) {
    gameState.answers = {};
  }
  
  // タイマーをクリア
  if (roomTimers[password]) {
    clearInterval(roomTimers[password]);
    delete roomTimers[password];
  }
  
  // スコア計算
  const correctAnswer = quizQuestions[questionIndex].correctAnswer;
  const answers = gameState.answers[questionIndex] || {};
  
  // scoresが存在しない場合の初期化
  if (!gameState.scores) {
    gameState.scores = {};
  }
  
  Object.keys(answers).forEach(userId => {
    if (!gameState.scores[userId]) {
      gameState.scores[userId] = 0;
    }
    
    if (answers[userId].answer === correctAnswer) {
      gameState.scores[userId] += 10;
    }
  });
  
  await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));
  
  // 結果表示
  io.to(password).emit('gameStateUpdate', {
    gamePhase: 'results',
    questionNumber: questionIndex + 1,
    totalQuestions: quizQuestions.length,
    correctAnswer: correctAnswer,
    correctAnswerText: quizQuestions[questionIndex].options[correctAnswer]
  });
  
  // 3秒後に次の問題へ
  setTimeout(() => {
    startQuestion(password, questionIndex + 1);
  }, 3000);
};

// ゲーム終了関数
const endGame = async (password) => {
  const roomKey = `room:${password}`;
  const gameStateJson = await redisClient.hget(roomKey, 'gameState');
  
  // タイマーをクリア
  if (roomTimers[password]) {
    clearInterval(roomTimers[password]);
    delete roomTimers[password];
  }
  
  if (!gameStateJson) return;
  
  const gameState = JSON.parse(gameStateJson);
  
  // ルーム状態をwaitingに戻す
  await redisClient.hset(roomKey, 'status', 'waiting');
  await redisClient.hdel(roomKey, 'gameState');
  
  io.to(password).emit('gameEnded', gameState.scores || {});
};

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