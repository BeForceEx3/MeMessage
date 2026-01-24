const userManager = require('./userManager');
const { v4: uuidv4 } = require('uuid');

module.exports = (io, socket) => {
  console.log('New connection:', socket.id);

  // Регистрация пользователя
  socket.on('register', (userData) => {
    userManager.addUser(socket.id, userData);
    socket.emit('registered', { success: true });
  });

  // Поиск собеседника
  socket.on('find_partner', (filters) => {
    const user = userManager.getUser(socket.id);
    if (!user) {
      socket.emit('error', { message: 'User not registered' });
      return;
    }

    // Добавляем в очередь ожидания
    userManager.addToWaiting(socket.id, filters);
    
    // Ищем пару
    const match = userManager.findMatch(socket.id, filters);
    
    if (match) {
      // Создаем комнату для чата
      const roomId = uuidv4();
      socket.join(roomId);
      match.socket.join(roomId);
      
      // Создаем пару
      const pair = userManager.createPair(socket.id, match.socketId, roomId);
      
      // Уведомляем обоих пользователей
      io.to(roomId).emit('partner_found', {
        roomId,
        partner: socket.id === match.socketId ? pair.user1 : pair.user2,
        user: socket.id === match.socketId ? pair.user2 : pair.user1
      });
    } else {
      socket.emit('searching', { message: 'Looking for partner...' });
    }
  });

  // Отправка текстового сообщения
  socket.on('send_message', ({ roomId, message, timestamp }) => {
    const messageData = {
      id: uuidv4(),
      senderId: socket.id,
      message,
      timestamp: timestamp || Date.now(),
      type: 'text'
    };
    
    socket.to(roomId).emit('new_message', messageData);
    socket.emit('message_sent', messageData);
  });

  // Отправка голосового сообщения
  socket.on('send_audio', ({ roomId, audioData, duration, timestamp }) => {
    const messageData = {
      id: uuidv4(),
      senderId: socket.id,
      audioData,
      duration,
      timestamp: timestamp || Date.now(),
      type: 'audio'
    };
    
    socket.to(roomId).emit('new_audio', messageData);
    socket.emit('audio_sent', messageData);
  });

  // Завершение диалога
  socket.on('end_chat', ({ roomId }) => {
    const partnerId = userManager.getPartner(socket.id);
    
    if (partnerId) {
      socket.to(roomId).emit('chat_ended', {
        reason: 'partner_left',
        message: 'Собеседник завершил диалог'
      });
      
      userManager.removePair(socket.id);
      socket.leave(roomId);
      socket.emit('chat_ended', {
        reason: 'you_left',
        message: 'Диалог завершен'
      });
    }
  });

  // Сообщение о наборе текста
  socket.on('typing', ({ roomId, isTyping }) => {
    socket.to(roomId).emit('partner_typing', { isTyping });
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    const partnerId = userManager.getPartner(socket.id);
    const roomId = userManager.getRoom(socket.id);
    
    if (partnerId && roomId) {
      socket.to(roomId).emit('partner_disconnected', {
        message: 'Собеседник отключился'
      });
    }
    
    userManager.removeUser(socket.id);
    console.log('User disconnected:', socket.id);
  });
};
