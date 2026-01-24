from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor
import uuid
import json
from datetime import datetime
import base64

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'cloud-anon-chat-secret')
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# База данных
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://user:pass@localhost/cloudanonchat')

def get_db_connection():
    return psycopg2.connect(DATABASE_URL, sslmode='require')

# Инициализация БД
def init_db():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(50),
            age INTEGER,
            gender VARCHAR(10),
            search_gender VARCHAR(10),
            age_range VARCHAR(20),
            status VARCHAR(20) DEFAULT 'waiting',
            active_chat UUID,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS chats (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user1 UUID REFERENCES users(id),
            user2 UUID REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(20) DEFAULT 'active'
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            chat_id UUID REFERENCES chats(id),
            sender UUID REFERENCES users(id),
            content TEXT,
            message_type VARCHAR(20) DEFAULT 'text',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    cur.close()
    conn.close()

# Главная страница
@app.route('/')
def index():
    return render_template('index.html')

# API для поиска собеседника
@app.route('/api/find_match', methods=['POST'])
def find_match():
    data = request.json
    user_id = data['user_id']
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # Сохраняем/обновляем профиль пользователя
    cur.execute("""
        INSERT INTO users (id, name, age, gender, search_gender, age_range)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET 
        name = EXCLUDED.name, age = EXCLUDED.age, 
        gender = EXCLUDED.gender, search_gender = EXCLUDED.search_gender,
        age_range = EXCLUDED.age_range, status = 'waiting'
    """, (user_id, data['name'], data['age'], data['gender'], 
          data['search_gender'], data['age_range']))
    
    # Ищем подходящего собеседника
    cur.execute("""
        SELECT u.id, u.name, u.gender, u.age
        FROM users u
        WHERE u.status = 'waiting' 
        AND u.search_gender = %s
        AND u.age_range = %s
        AND u.id != %s
        AND NOT EXISTS (
            SELECT 1 FROM chats c 
            WHERE (c.user1 = u.id AND c.user2 = %s)
            OR (c.user2 = u.id AND c.user1 = %s)
        )
        ORDER BY u.created_at ASC
        LIMIT 1
    """, (data['gender'], data['age_range'], user_id, user_id, user_id))
    
    match = cur.fetchone()
    
    if match:
        # Создаем чат
        chat_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO chats (id, user1, user2) VALUES (%s, %s, %s)
        """, (chat_id, user_id, match['id']))
        
        # Обновляем статусы
        cur.execute("UPDATE users SET status = 'chatting', active_chat = %s WHERE id = %s", 
                   (chat_id, user_id))
        cur.execute("UPDATE users SET status = 'chatting', active_chat = %s WHERE id = %s", 
                   (chat_id, match['id']))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({'success': True, 'chat_id': chat_id, 'partner': match})
    else:
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'success': False, 'waiting': True})

# WebSocket события
@socketio.on('join_chat')
def on_join_chat(data):
    chat_id = data['chat_id']
    join_room(chat_id)
    emit('status', {'msg': 'Подключен к чату'}, room=chat_id)

@socketio.on('message')
def handle_message(data):
    chat_id = data['chat_id']
    sender_id = data['sender_id']
    content = data['content']
    msg_type = data.get('type', 'text')
    
    # Сохраняем сообщение
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO messages (chat_id, sender, content, message_type)
        VALUES (%s, %s, %s, %s)
    """, (chat_id, sender_id, content, msg_type))
    conn.commit()
    cur.close()
    conn.close()
    
    # Отправляем всем в чате
    emit('message', data, room=chat_id)

@socketio.on('end_chat')
def end_chat(data):
    chat_id = data['chat_id']
    
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE users SET status = 'waiting', active_chat = NULL WHERE active_chat = %s", (chat_id,))
    cur.execute("UPDATE chats SET status = 'ended' WHERE id = %s", (chat_id,))
    conn.commit()
    cur.close()
    conn.close()
    
    emit('chat_ended', {'msg': 'Диалог завершен'}, room=chat_id)
    leave_room(chat_id)

@socketio.on('load_messages')
def load_messages(data):
    chat_id = data['chat_id']
    last_id = data.get('last_id')
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    if last_id:
        cur.execute("""
            SELECT m.*, u.gender 
            FROM messages m 
            JOIN users u ON m.sender = u.id
            WHERE m.chat_id = %s AND m.id < %s
            ORDER BY m.created_at DESC
            LIMIT 20
        """, (chat_id, last_id))
    else:
        cur.execute("""
            SELECT m.*, u.gender 
            FROM messages m 
            JOIN users u ON m.sender = u.id
            WHERE m.chat_id = %s
            ORDER BY m.created_at DESC
            LIMIT 20
        """, (chat_id,))
    
    messages = cur.fetchall()
    cur.close()
    conn.close()
    
    emit('messages_loaded', {'messages': [dict(msg) for msg in messages]})

if __name__ == '__main__':
    init_db()
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
