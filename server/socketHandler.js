const userManager = require('./userManager');
const { v4: uuidv4 } = require('uuid');

module.exports = (io, socket) => {
  const MAX_MESSAGE_LENGTH = parseInt(process.env.MAX_MESSAGE_LENGTH) || 500;
  const MAX_AUDIO_DURATION = parseInt(process.env.MAX_AUDIO_DURATION) || 120; // секунды
  
  console.log(`New connection from: ${socket.handshake.address}`);

  // Регистрация пользователя
  socket.on('register', (userData) => {
    try {
      // Валидация данных
      if (!userData.name || !userData.age || !userData.gender) {
        throw new Error('Не все данные предоставлены');
      }
      
      if (userData.name.length > 20) {
        throw new Error('Имя слишком длинное');
      }
      
      if (userData.age < 12 || userData.age > 100) {
        throw new Error('Возраст должен быть от 12 до 100 лет');
      }
      
      userManager.addUser(socket.id, userData);
      socket.emit('registered', { 
        success: true,
        user: userManager.getSafeUserData(userManager.getUser(socket.id))
      });
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Поиск собеседника
  socket.on('find_partner', (filters) => {
    try {
      const user = userManager.getUser(socket.id);
      if (!user) {
        throw new Error('Пользователь не зарегистрирован');
      }

      // Валидация фильтров
      if (!filters.ageGroup || !filters.targetGender) {
        throw new Error('Не указаны фильтры поиска');
      }

      const validAgeGroups = ['12-16', '18-26', '26-35', '35+'];
      if (!validAgeGroups.includes(filters.ageGroup)) {
        throw new Error('Неверная возрастная группа');
      }

      // Добавляем в очередь ожидания
      userManager.addToWaiting(socket.id, filters);
      
      // Ищем пару
      const match = userManager.findMatch(socket.id, filters);
      
      if (match) {
        const roomId = uuidv4();
        socket.join(roomId);
        match.socket.join(roomId);
        
        const pair = userManager.createPair(socket.id, match.socketId, roomId);
        
        io.to(roomId).emit('partner_found', {
          roomId,
          partner: socket.id === match.socketId ? pair.user1 : pair.user2,
          user: socket.id === match.socketId ? pair.user2 : pair.user1,
          timestamp: Date.now()
        });
        
        console.log(`Created chat room ${roomId} for users: ${socket.id} and ${match.socketId}`);
      } else {
        socket.emit('searching', { 
          message: 'Ищем подходящего собеседника...',
          timestamp: Date.now()
        });
      }
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Отправка текстового сообщения
  socket.on('send_message', ({ roomId, message, timestamp }) => {
    try {
      if (!roomId) throw new Error('Не указана комната');
      
      if (!message || message.trim().length === 0) {
        throw new Error('Сообщение не может быть пустым');
      }
      
      if (message.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Сообщение слишком длинное (макс. ${MAX_MESSAGE_LENGTH} символов)`);
      }
      
      const user = userManager.getUser(socket.id);
      if (!user) throw new Error('Пользователь не найден');

      const messageData = {
        id: uuidv4(),
        senderId: socket.id,
        senderName: user.name,
        message: message.trim(),
        timestamp: timestamp || Date.now(),
        type: 'text'
      };
      
      socket.to(roomId).emit('new_message', messageData);
      socket.emit('message_sent', messageData);
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Отправка голосового сообщения
  socket.on('send_audio', ({ roomId, audioData, duration, timestamp }) => {
    try {
      if (!roomId) throw new Error('Не указана комната');
      
      if (!audioData) {
        throw new Error('Аудио данные отсутствуют');
      }
      
      if (duration > MAX_AUDIO_DURATION) {
        throw new Error(`Аудио слишком длинное (макс. ${MAX_AUDIO_DURATION} секунд)`);
      }
      
      // Проверяем размер аудио (грубо)
      const audioSize = (audioData.length * 3) / 4; // примерный размер base64
      const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 10485760; // 10MB по умолчанию
      
      if (audioSize > maxSize) {
        throw new Error(`Аудио файл слишком большой (макс. ${Math.round(maxSize / 1048576)}MB)`);
      }

      const user = userManager.getUser(socket.id);
      if (!user) throw new Error('Пользователь не найден');

      const messageData = {
        id: uuidv4(),
        senderId: socket.id,
        senderName: user.name,
        audioData,
        duration,
        timestamp: timestamp || Date.now(),
        type: 'audio'
      };
      
      socket.to(roomId).emit('new_audio', messageData);
      socket.emit('audio_sent', messageData);
      
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Завершение диалога
  socket.on('end_chat', ({ roomId }) => {
    try {
      const partnerId = userManager.getPartner(socket.id);
      
      if (partnerId) {
        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) {
          partnerSocket.emit('chat_ended', {
            reason: 'partner_left',
            message: 'Собеседник завершил диалог',
            timestamp: Date.now()
          });
        }
        
        userManager.removePair(socket.id);
        socket.leave(roomId);
        socket.emit('chat_ended', {
          reason: 'you_left',
          message: 'Диалог завершен',
          timestamp: Date.now()
        });
        
        console.log(`Chat ended in room ${roomId} by user ${socket.id}`);
      }
    } catch (error) {
      console.error('Error ending chat:', error);
    }
  });

  // Сообщение о наборе текста
  socket.on('typing', ({ roomId, isTyping }) => {
    socket.to(roomId).emit('partner_typing', { 
      isTyping,
      timestamp: Date.now()
    });
  });

  // Ping-понг для проверки подключения
  socket.on('ping', (callback) => {
    if (callback) callback(Date.now());
  });

  // Отключение пользователя
  socket.on('disconnect', (reason) => {
    console.log(`User ${socket.id} disconnected: ${reason}`);
    
    const partnerId = userManager.getPartner(socket.id);
    const roomId = userManager.getRoom(socket.id);
    
    if (partnerId && roomId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit('partner_disconnected', {
          message: 'Собеседник отключился',
          timestamp: Date.now()
        });
      }
    }
    
    userManager.removeUser(socket.id);
  });
};
