const { User, Message } = require('./models');

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Регистрация пользователя
    socket.on('register', async (data) => {
      const { name, age, gender, preferredGender, ageGroup } = data;
      const user = await User.create(socket.id, name, age, gender, preferredGender, ageGroup);
      socket.emit('registered', user);

      // Поиск собеседника
      const match = await User.findMatch(preferredGender, ageGroup);
      if (match) {
        socket.emit('match_found', match);
        io.to(match.socket_id).emit('match_found', user);
      }
    });

    // Отправка текстового сообщения
    socket.on('text_message', async (data) => {
      const { receiverId, content } = data;
      const sender = await User.findBySocketId(socket.id);
      const message = await Message.create(sender.id, receiverId, content, false, null);
      io.to(receiverId).emit('new_message', message);
    });

    // Отправка голосового сообщения
    socket.on('voice_message', async (data) => {
      const { receiverId, audioBlob } = data;
      const sender = await User.findBySocketId(socket.id);
      // Здесь можно сохранить audioBlob в хранилище (например, S3) и получить URL
      const audioUrl = `/uploads/${Date.now()}.webm`;
      const message = await Message.create(sender.id, receiverId, null, true, audioUrl);
      io.to(receiverId).emit('new_voice_message', message);
    });

    // Завершение диалога
    socket.on('end_dialog', async () => {
      const user = await User.findBySocketId(socket.id);
      if (user) {
        socket.emit('dialog_ended');
        // Можно уведомить собеседника
      }
    });

    // Отключение
    socket.on('disconnect', async () => {
      await User.deleteBySocketId(socket.id);
      console.log('User disconnected:', socket.id);
    });
  });
};
