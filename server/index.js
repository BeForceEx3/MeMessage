const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const userManager = require('./userManager');
const socketHandler = require('./socketHandler');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Статические файлы
app.use(express.static(path.join(__dirname, '../public')));

// API маршруты
app.get('/api/stats', (req, res) => {
  res.json({
    online: userManager.getOnlineCount(),
    chatting: userManager.getChattingCount()
  });
});

// Обработка сокетов
io.on('connection', (socket) => {
  socketHandler(io, socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
