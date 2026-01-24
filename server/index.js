const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const userManager = require('./userManager');
const socketHandler = require('./socketHandler');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

// Безопасность и оптимизация
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.socket.io", "cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "cdnjs.cloudflare.com"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "https:"]
    }
  }
}));
app.use(compression());

// Лимит запросов
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: process.env.RATE_LIMIT_MAX || 100, // лимит запросов
  message: 'Слишком много запросов с этого IP'
});
app.use('/api/', limiter);

// Конфигурация Socket.io
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8 // 100MB для больших голосовых сообщений
});

// Статические файлы
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0'
}));

// API маршруты
app.get('/api/stats', (req, res) => {
  res.json({
    online: userManager.getOnlineCount(),
    chatting: userManager.getChattingCount(),
    server: process.env.SERVER_NAME || 'MeMessage Server',
    version: process.env.APP_VERSION || '1.0.0'
  });
});

// Health check для Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Обработка сокетов
io.on('connection', (socket) => {
  socketHandler(io, socket);
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message 
  });
});

// Получение порта из переменных окружения
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`
  🚀 MeMessage Server запущен!
  📍 URL: http://${HOST}:${PORT}
  ⚡ Режим: ${process.env.NODE_ENV || 'development'}
  📊 Socket.IO: готов к подключениям
  `);
});

// Обработка graceful shutdown
process.on('SIGTERM', () => {
  console.log('Получен SIGTERM, завершаем работу...');
  server.close(() => {
    console.log('Сервер завершил работу');
    process.exit(0);
  });
});
