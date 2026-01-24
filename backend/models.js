const { pool } = require('./db');

const User = {
  create: async (socketId, name, age, gender, preferredGender, ageGroup) => {
    const res = await pool.query(
      `INSERT INTO users (socket_id, name, age, gender, preferred_gender, age_group)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [socketId, name, age, gender, preferredGender, ageGroup]
    );
    return res.rows[0];
  },
  findBySocketId: async (socketId) => {
    const res = await pool.query('SELECT * FROM users WHERE socket_id = $1', [socketId]);
    return res.rows[0];
  },
  findMatch: async (gender, ageGroup) => {
    const res = await pool.query(
      `SELECT * FROM users 
       WHERE gender = $1 AND age_group = $2 AND socket_id IS NOT NULL
       LIMIT 1`,
      [gender, ageGroup]
    );
    return res.rows[0];
  },
  deleteBySocketId: async (socketId) => {
    await pool.query('DELETE FROM users WHERE socket_id = $1', [socketId]);
  }
};

const Message = {
  create: async (senderId, receiverId, content, isAudio, audioUrl) => {
    const res = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content, is_audio, audio_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [senderId, receiverId, content, isAudio, audioUrl]
    );
    return res.rows[0];
  },
  getHistory: async (userId, partnerId, limit = 50, offset = 0) => {
    const res = await pool.query(
      `SELECT * FROM messages 
       WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY timestamp DESC
       LIMIT $3 OFFSET $4`,
      [userId, partnerId, limit, offset]
    );
    return res.rows.reverse();
  }
};

module.exports = { User, Message };
