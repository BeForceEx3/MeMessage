const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const NodeCache = require('node-cache');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));
app.use('/media', express.static('public/media'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Слишком много запросов'
});
app.use('/api/', limiter);

// Кэш и очереди поиска
const messageCache = new NodeCache({ stdTTL: 3600 });
const searchQueues = {
  '12-16:male': [], '12-16:female': [],
  '18-26:male': [], '18-26:female': [],
  '26-35:male': [], '26-35:female': [],
  '35+:male': [], '35+:female': []
};
const activeChats = new Map();
const users = new Map();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  // Регистрация пользователя
  socket.on('register', (data) => {
    const userId = uuidv4();
    users.set(userId, {
      socketId: socket.id,
      name: data.name,
      age: data.age,
      gender: data.gender,
      filter: null,
      chatId: null
    });
    socket.emit('registered', { userId });
  });

  // Поиск собеседника
  socket.on('search', (filter) => {
    const userId = Array.from(users.values())
      .find(u => u.socketId === socket.id)?.userId;
    
    if (!userId) return;

    users.get(userId).filter = filter;
    searchQueues[filter].push(userId);

    // Поиск пары
    findMatch(socket, userId, filter);
  });

  // Отправка сообщения
  socket.on('message', (data) => {
    const userId = data.userId;
    const user = users.get(userId);
    if (!user || !user.chatId) return;

    const message = {
      id: uuidv4(),
      senderId: userId,
      text: data.text || null,
      type: data.type || 'text',
      timestamp: Date.now(),
      mediaId: data.mediaId || null
    };

    // Сохраняем в кэш чата
    const chatMessages = messageCache.get(user.chatId) || [];
    chatMessages.push(message);
    messageCache.set(user.chatId, chatMessages);

    // Отправляем собеседнику
    const partnerId = activeChats.get(user.chatId);
    const partner = users.get(partnerId);
    if (partner) {
      io.to(partner.socketId).emit('message', message);
    }
  });

  // Завершение диалога
  socket.on('endChat', () => {
    const userId = Array.from(users.values())
      .find(u => u.socketId === socket.id)?.userId;
    
    if (userId) {
      endChat(userId);
    }
  });

  socket.on('disconnect', () => {
    const userId = Array.from(users.values())
      .find(u => u.socketId === socket.id)?.userId;
    
    if (userId) {
      endChat(userId);
    }
    console.log('Пользователь отключился:', socket.id);
  });
});

function findMatch(socket, userId, filter) {
  const queue = searchQueues[filter];
  if (queue.length > 1) {
    // Нашли пару
    const partnerId = queue.splice(0, 1)[0];
    queue.splice(queue.indexOf(userId), 1);

    const chatId = uuidv4();
    activeChats.set(chatId, partnerId);
    users.get(userId).chatId = chatId;
    users.get(partnerId).chatId = chatId;

    socket.emit('matched', { 
      chatId, 
      partner: {
        name: users.get(partnerId).name,
        age: users.get(partnerId).age,
        gender: users.get(partnerId).gender
      }
    });

    const partnerSocket = users.get(partnerId).socketId;
    io.to(partnerSocket).emit('matched', {
      chatId,
      partner: {
        name: users.get(userId).name,
        age: users.get(userId).age,
        gender: users.get(userId).gender
      }
    });
  }
}

function endChat(userId) {
  const user = users.get(userId);
  if (!user || !user.chatId) return;

  // Очищаем чат
  messageCache.del(user.chatId);
  const partnerId = activeChats.get(user.chatId);
  activeChats.delete(user.chatId);

  if (partnerId) {
    const partner = users.get(partnerId);
    if (partner) {
      partner.chatId = null;
      io.to(partner.socketId).emit('chatEnded');
    }
  }

  user.chatId = null;
  user.filter = null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CloudAnonChat запущен на порту ${PORT}`);
});
