import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import redisClient from './redisClient.js';

// 環境変数を読み込み（開発環境では.env.developmentを使用）
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: envFile });

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [process.env.CLIENT_ORIGIN,
      "http://localhost:3000"
    ],
    methods: ["GET", "POST"]
  }
});

const MAX_MEMBERS = 6;

// クイズデータを格納する変数（初期は空配列）
let quizQuestions = [];

// クイズデータを外部APIから取得する関数
const fetchQuizQuestions = async () => {
  try {
    console.log('外部APIからクイズデータを取得中...');
    const response = await fetch(`${process.env.API_URL}/api/questions/random`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    quizQuestions = data.map((item) => ({
      questionid: item.questionid,
      question: item.question,
      options: [item.option1, item.option2, item.option3, item.option4],
      correctAnswer: item.answer === "A" ? 0 : item.answer === "B" ? 1 : item.answer === "C" ? 2 : 3, // デフォルトで最初の選択肢を正解とする（実際のAPIには正解情報がないため）
      level: item.level,
      explanation: item.explanation
    }));
    console.log("a", data)
    console.log(`${quizQuestions.length}問のクイズデータを取得しました`);
  } catch (error) {
    console.error('クイズデータの取得に失敗しました:', error);
  }
};

// サーバー起動時にクイズデータを取得
fetchQuizQuestions();

// 各ルームごとにタイマーを管理するためのオブジェクト
const roomTimers = {};

// 接続時の処理
// 各接続ごとにsocketというインスタンスが生成
io.on('connection', (socket) => {
  console.log(`接続したユーザーのSocketIdは...: ${socket.id}`);

  // ユーザーIDとユーザーネームを設定
  socket.on('setUserInfo', ({ userId, userName }) => {
    socket.userId = userId;
    socket.userName = userName;
    console.log(`ユーザーID: ${userId}, ユーザーネーム: ${userName}`);
  });

  // ルーム作成処理
  socket.on('createRoom', async ({ watchword, user }) => {
    console.log(`以下の合言葉を使って、ルームを作成しています: "${watchword}"`);

    socket.userId = user.id;
    socket.userName = user.name;

    const roomKey = `room:${watchword}`;
    const roomExists = await redisClient.exists(roomKey);

    if (roomExists) {
      socket.emit('error', { message: 'この合言葉は既に使用されています。' });
      return;
    }

    const roomInfo = {
      host: user.id,
      // ユーザー情報をJSON文字列に変換(Redisはハッシュだから)
      members: JSON.stringify([{ id: user.id, name: user.name }]),
      status: 'waiting',
    };

    // Redis のハッシュ（HSET）で以下の情報を保存
    //   キー: room:abcd1234
    // 　値（ハッシュ）:
    //   ├── host   => 'socket123'
    //   ├── members => '[{"id":"socket123","name":"たろう"}]'
    //   └── status => 'waiting'
    await redisClient.hset(roomKey, roomInfo);

    //socketをwatchwordという名前のルームに参加させる
    socket.join(watchword);
    socket.emit('roomCreated', { watchword });
    updateRoomInfo(watchword);
    console.log(`ルームの作成に成功しました！: "${watchword}"`);
  });

  // ルーム参加処理
  socket.on('joinRoom', async ({ watchword, user }) => {
    console.log(`ルームに参加するための合言葉は: "${watchword}", 参加するユーザーは:`, user);

    socket.userId = user.id;
    socket.userName = user.name;

    const roomKey = `room:${watchword}`;
    const roomExists = await redisClient.exists(roomKey);

    if (!roomExists) {
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }

    const membersJson = await redisClient.hget(roomKey, 'members');
    //JSON文字列で保存されているため、それをパース
    const members = JSON.parse(membersJson);

    // すでにMAX_MEMBERS（６人）の場合は、errorを返す
    // まだ５人しかいない場合は、人を追加
    if (members.length >= MAX_MEMBERS) {
      socket.emit('error', { message: 'このルームは満員です。' });
      return;
    }

    // ユーザーが既にそのルームに入っている場合
    // some(...): 配列の中に「条件を満たす要素が1つでもあるか」を判定するメソッド。
    if (members.some(member => member.id === user.id)) {
      socket.join(watchword);
      socket.emit('roomJoined', { watchword });
      updateRoomInfo(watchword);
      return;
    }

    // ユーザーが未だそのルームに入っていない場合
    const newMembers = [...members, { id: user.id, name: user.name }];
    await redisClient.hset(roomKey, 'members', JSON.stringify(newMembers));

    socket.join(watchword);
    socket.emit('roomJoined', { watchword });
    updateRoomInfo(watchword);
  });

  // ゲーム開始処理
  socket.on('startGame', async ({ watchword }) => {
    const roomKey = `room:${watchword}`;
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
      if (roomTimers[watchword]) {
        clearInterval(roomTimers[watchword]);
        delete roomTimers[watchword];
      }

      await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));

      // 全員にゲーム開始を通知
      io.to(watchword).emit('gameStarted');

      console.log(`以下の合言葉のルームでクイズを開始します: ${watchword}`);
    }
  });

  // ユーザーがゲームページに到達したことを通知
  socket.on('userReadyForGame', async ({ watchword, userId }) => {
    console.log(`userReadyForGame イベントを受信: watchword=${watchword}, userId=${userId}`);

    const roomKey = `room:${watchword}`;
    const gameStateJson = await redisClient.hget(roomKey, 'gameState');
    const membersJson = await redisClient.hget(roomKey, 'members');

    if (!gameStateJson || !membersJson) {
      console.log('ゲーム状態またはメンバー情報が見つかりません');
      return;
    }

    const gameState = JSON.parse(gameStateJson);
    const members = JSON.parse(membersJson);

    // ユーザーを準備完了リストに追加
    if (!gameState.usersReady.includes(userId)) {
      gameState.usersReady.push(userId);
      await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));
    }

    socket.join(watchword);

    console.log(`ユーザー ${userId} がゲームページに到達。準備完了: ${gameState.usersReady.length}/${members.length}`);

    // 全員が準備できているかチェック
    if (gameState.usersReady.length === members.length) {
      console.log('全員準備完了。最初の問題を開始します。');
      // 最初の問題を開始
      setTimeout(() => {
        startQuestion(watchword, 0);
      }, 1000); // 1秒後に開始
    } else {
      // 待機中の状態を送信
      const readyUserNames = members
        .filter(member => gameState.usersReady.includes(member.id))
        .map(member => member.name);

      socket.emit('gameStateUpdate', {
        gamePhase: 'waiting',
        waitingForUsers: readyUserNames,
        allUsersReady: false,
        message: `${gameState.usersReady.length}/${members.length} 人が準備完了`
      });
    }
  });

  // 回答送信処理
  socket.on('submitAnswer', async ({ watchword, userId, answerIndex, timeLeft }) => {
    const roomKey = `room:${watchword}`;
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
      processQuestionResults(watchword, currentQ);
    }
  });

  // その他の既存イベント
  socket.on('getRoomInfo', async ({ watchword, userId }) => {
    const roomKey = `room:${watchword}`;
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

    socket.join(watchword);
    updateRoomInfo(watchword);
  });

  socket.on('leaveRoom', async ({ watchword, userId }) => {
    const roomKey = `room:${watchword}`;
    const roomExists = await redisClient.exists(roomKey);

    if (!roomExists) {
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }

    const membersJson = await redisClient.hget(roomKey, 'members');
    const members = JSON.parse(membersJson);
    const hostId = await redisClient.hget(roomKey, 'host');

    // タイマーをクリア
    if (roomTimers[watchword]) {
      clearInterval(roomTimers[watchword]);
      delete roomTimers[watchword];
    }

    // ホストが退出する場合、ルーム全体を削除
    if (hostId === userId) {
      await redisClient.del(roomKey);
      io.to(watchword).emit('roomDeleted');
      console.log(`合言葉が ${watchword} のルームはホストが退出したため削除されました`);
    } else {
      const updatedMembers = members.filter(member => member.id !== userId);

      if (updatedMembers.length === 0) {
        await redisClient.del(roomKey);
        io.to(watchword).emit('roomDeleted');
        console.log(`合言葉が ${watchword} のルームは全員退出したため削除されました`);
      } else {
        await redisClient.hset(roomKey, 'members', JSON.stringify(updatedMembers));
        updateRoomInfo(watchword);
      }
    }

    socket.leave(watchword);
    socket.emit('roomLeft');
    console.log(`ユーザーIdが ${userId} のユーザーは合言葉が ${watchword} のルームを退出しました`);
  });

  socket.on('disconnect', async () => {
    console.log(`接続が切断されたユーザーのSocketIdは... ${socket.id}`);
  });
});

// 問題開始関数
const startQuestion = async (watchword, questionIndex) => {
  if (questionIndex >= quizQuestions.length) {
    endGame(watchword);
    return;
  }

  const question = quizQuestions[questionIndex];
  const roomKey = `room:${watchword}`;

  // 既存のタイマーをクリア
  if (roomTimers[watchword]) {
    clearInterval(roomTimers[watchword]);
  }

  const gameStateJson = await redisClient.hget(roomKey, 'gameState');
  if (!gameStateJson) return;

  const gameState = JSON.parse(gameStateJson);
  gameState.currentQuestion = questionIndex;
  gameState.startTime = Date.now();
  gameState.timeLeft = 15;
  await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));

  // 問題を送信
  io.to(watchword).emit('gameStateUpdate', {
    question: question.question,
    options: question.options,
    timeLeft: 30,
    gamePhase: 'showQuestion',
    questionNumber: questionIndex + 1,
    totalQuestions: quizQuestions.length,
    allUsersReady: true,
    level: question.level
  });

  // タイマーを開始（1秒ごとに更新）
  roomTimers[watchword] = setInterval(async () => {
    const currentGameStateJson = await redisClient.hget(roomKey, 'gameState');
    if (!currentGameStateJson) {
      clearInterval(roomTimers[watchword]);
      delete roomTimers[watchword];
      return;
    }

    const currentGameState = JSON.parse(currentGameStateJson);
    const elapsed = Math.floor((Date.now() - currentGameState.startTime) / 1000);
    const timeLeft = Math.max(0, 20 - elapsed); // 5秒表示 + 15秒回答

    currentGameState.timeLeft = Math.max(0, 15 - Math.max(0, elapsed - 5)); // 回答時間のカウントダウン
    await redisClient.hset(roomKey, 'gameState', JSON.stringify(currentGameState));

    // クライアントに時間更新を送信
    io.to(watchword).emit('timeUpdate', {
      timeLeft: currentGameState.timeLeft,
      totalTimeLeft: timeLeft
    });

    if (timeLeft <= 0) {
      clearInterval(roomTimers[watchword]);
      delete roomTimers[watchword];
      processQuestionResults(watchword, questionIndex);
    }
  }, 1000);
};

// 問題結果処理関数
const processQuestionResults = async (watchword, questionIndex) => {
  const roomKey = `room:${watchword}`;
  const gameStateJson = await redisClient.hget(roomKey, 'gameState');

  if (!gameStateJson) {
    console.error(`合言葉が ${watchword} のルームに対応するゲームの状態が見つかりませんでした`);
    return;
  }

  const gameState = JSON.parse(gameStateJson);

  if (!gameState.answers) {
    gameState.answers = {};
  }

  if (roomTimers[watchword]) {
    clearInterval(roomTimers[watchword]);
    delete roomTimers[watchword];
  }

  const correctAnswer = quizQuestions[questionIndex].correctAnswer;
  const answers = gameState.answers[questionIndex] || {};

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

  // 結果表示（optionsも含める）
  io.to(watchword).emit('gameStateUpdate', {
    question: quizQuestions[questionIndex].question, // 質問も含める
    options: quizQuestions[questionIndex].options,   // オプションを含める
    gamePhase: 'results',
    questionNumber: questionIndex + 1,
    totalQuestions: quizQuestions.length,
    correctAnswer: correctAnswer,
    correctAnswerText: quizQuestions[questionIndex].options[correctAnswer],
    explanation: quizQuestions[questionIndex].explanation
  });

  // 3秒後に次の問題へ
  setTimeout(() => {
    startQuestion(watchword, questionIndex + 1);
  }, 3000);

  const zKey = `scores:${watchword}:${questionIndex + 1}`   // 1 始まり

  // 初回ならリセット
  await redisClient.del(zKey);

  // members 情報取得
  const membersJson = await redisClient.hget(roomKey, 'members');
  const members = JSON.parse(membersJson);   // [{id,name}...]

  for (const m of members) {
    const uid = m.id;
    const base = {
      id: uid,
      name: m.name,
      avatar: `https://api.dicebear.com/7.x/thumbs/svg?seed=${m.name}`,
      responseTime: (answers[uid]?.timeLeft ?? 0),
      totalQuestions: quizQuestions.length,
      isCurrentUser: false   // ←フロントで置き換えてもOK
    };
    const score = gameState.scores[uid] ?? 0;
    await redisClient.zadd(zKey, { score, member: JSON.stringify(base) });
  }
  // 通知
  io.to(watchword).emit('scoresUpdated');

};

// ゲーム終了関数
const endGame = async (watchword) => {
  const roomKey = `room:${watchword}`;
  const gameStateJson = await redisClient.hget(roomKey, 'gameState');

  // タイマーをクリア
  if (roomTimers[watchword]) {
    clearInterval(roomTimers[watchword]);
    delete roomTimers[watchword];
  }

  if (!gameStateJson) return;

  const gameState = JSON.parse(gameStateJson);

  // ルーム状態をwaitingに戻す
  await redisClient.hset(roomKey, 'status', 'waiting');
  await redisClient.hdel(roomKey, 'gameState');

  io.to(watchword).emit('gameEnded', gameState.scores || {});
};

// 特定のルームの最新情報をそのルームに属するすべてのクライアントに送信するヘルパー関数
const updateRoomInfo = async (watchword) => {
  const roomKey = `room:${watchword}`;
  // hgetall(roomKey): キーが”roomKey”のルームの、すべての情報を取得
  const roomInfo = await redisClient.hgetall(roomKey);

  let members = [];
  try {
    members = JSON.parse(roomInfo.members || '[]');
  } catch (err) {
    console.error('❌ membersのJSONパースに失敗:', roomInfo.members);
    members = [];
  }

  // to(): 特定のルーム（= watchword）に属するクライアント全員にメッセージを送信
  io.to(watchword).emit('updateRoom', {
    host: roomInfo.host,
    members: members,
    status: roomInfo.status,
  });
};

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`🚀 サーバーは ${PORT} 番ポートで準備しています`);
});


