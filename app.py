# app.py - CloudChat v12.1 (с фильтрами по полу и возрасту)
import os
import time
import uuid
import json
import re
import secrets
import base64
import mimetypes
import threading
import logging
import hashlib
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, render_template, send_from_directory, make_response, Response
from PIL import Image
import io
import sqlite3
from functools import wraps, lru_cache
import traceback
import queue

# ===== НАСТРОЙКА ЛОГИРОВАНИЯ =====
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Дополнительный файловый логгер для ошибок
file_handler = logging.FileHandler('cloudchat_errors.log', encoding='utf-8')
file_handler.setLevel(logging.ERROR)
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
logger.addHandler(file_handler)

# Инициализация mimetypes
mimetypes.init()

# ===== ИНИЦИАЛИЗАЦИЯ FLASK =====
app = Flask(__name__, template_folder='templates', static_folder='static')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', secrets.token_hex(32))
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB
app.config['JSON_AS_ASCII'] = False
app.config['JSON_SORT_KEYS'] = False
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 3600  # Кэширование статики 1 час

# ===== КОНФИГУРАЦИЯ СЕРВЕРА =====
DB_PATH = 'cloudchat.db'
MESSAGE_HISTORY_LIMIT = 500
INACTIVITY_TIMEOUT = 600  # 10 минут для автомосвобождения
MAX_SSE_CONNECTIONS = 100  # Максимум SSE соединений
SSE_CONNECTIONS = {}
SSE_LOCK = threading.RLock()

# Глобальные переменные с блокировками
ONLINE_USERS = set()
USER_LAST_ACTIVE = {}
USER_PREFERENCES = {}  # {username: {'gender': 'male', 'age_group': '18-25', 'search_gender': 'any', 'search_age': 'any'}}

# ===== ПРИВАТНЫЕ ЧАТЫ =====
PRIVATE_CHATS = {}  # {chat_id: {'users': set(user1, user2), 'messages': [], 'created_at': timestamp, 'last_activity': timestamp}}
USERS_IN_CHAT = {}  # {username: chat_id} - для быстрого поиска в каком чате пользователь
WAITING_USERS = []  # Очередь пользователей, ожидающих собеседника

# Очередь событий
event_queue = queue.Queue()

# Звуковые уведомления
LOGOUT_SOUND_DATA = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgoodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoAAAAA"
NOTIFICATION_SOUND_DATA = "data:audio/wav;base64,UklGRp4CAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgoodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoAAAAA"

# ===== КЛАСС ДЛЯ ОГРАНИЧЕНИЯ ЗАПРОСОВ =====
class RateLimiter:
    """Улучшенный ограничитель запросов с очисткой старых записей"""
    def __init__(self, max_requests=60, window=60):
        self.max_requests = max_requests
        self.window = window
        self.requests = {}
        self.lock = threading.RLock()
        
    def is_allowed(self, ip):
        now = time.time()
        with self.lock:
            if ip not in self.requests:
                self.requests[ip] = []
            
            # Удаляем старые запросы
            self.requests[ip] = [req_time for req_time in self.requests[ip] 
                               if now - req_time < self.window]
            
            if len(self.requests[ip]) < self.max_requests:
                self.requests[ip].append(now)
                return True
            
            return False
    
    def cleanup(self):
        """Очистка старых записей"""
        now = time.time()
        with self.lock:
            for ip in list(self.requests.keys()):
                self.requests[ip] = [req_time for req_time in self.requests[ip]
                                   if now - req_time < self.window]
                if not self.requests[ip]:
                    del self.requests[ip]

rate_limiter = RateLimiter(max_requests=100, window=60)

def rate_limit(f):
    """Декоратор для ограничения запросов"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        ip = request.remote_addr
        if not rate_limiter.is_allowed(ip):
            logger.warning(f"Rate limit exceeded for IP: {ip}")
            return jsonify({'error': 'Слишком много запросов. Подождите 1 минуту.'}), 429
        return f(*args, **kwargs)
    return wrapper

# ===== ФУНКЦИИ ДЛЯ ФИЛЬТРОВ ПОЛ/ВОЗРАСТ =====
# Доступные возрастные группы
AGE_GROUPS = ['12-18', '18-25', '25-35', '35-60']
SEARCH_AGE_GROUPS = ['12-18', '18-25', '25-35', '35-60', 'any']

def validate_age_group(age_group):
    """Валидация возрастной группы"""
    return age_group in AGE_GROUPS

def is_compatible_by_preferences(user1_prefs, user2_prefs):
    """Проверка совместимости по предпочтениям"""
    # user1 ищет user2
    search_gender1 = user1_prefs.get('search_gender', 'any')
    search_age1 = user1_prefs.get('search_age', 'any')
    gender2 = user2_prefs.get('gender', 'unknown')
    age_group2 = user2_prefs.get('age_group', 'unknown')
    
    # user2 ищет user1
    search_gender2 = user2_prefs.get('search_gender', 'any')
    search_age2 = user2_prefs.get('search_age', 'any')
    gender1 = user1_prefs.get('gender', 'unknown')
    age_group1 = user1_prefs.get('age_group', 'unknown')
    
    # Проверка для user1
    gender_ok1 = (search_gender1 == 'any' or gender2 == 'unknown' or 
                 search_gender1 == gender2)
    age_ok1 = (search_age1 == 'any' or age_group2 == 'unknown' or 
              search_age1 == age_group2)
    
    # Проверка для user2
    gender_ok2 = (search_gender2 == 'any' or gender1 == 'unknown' or 
                 search_gender2 == gender1)
    age_ok2 = (search_age2 == 'any' or age_group1 == 'unknown' or 
              search_age2 == age_group1)
    
    return gender_ok1 and age_ok1 and gender_ok2 and age_ok2

# ===== ФУНКЦИИ ДЛЯ ПРИВАТНЫХ ЧАТОВ =====
def create_private_chat(user1, user2):
    """Создание приватного чата между двумя пользователями"""
    chat_id = str(uuid.uuid4())
    now = time.time()
    
    with threading.RLock():
        PRIVATE_CHATS[chat_id] = {
            'users': {user1, user2},
            'messages': [],
            'created_at': now,
            'last_activity': now,
            'user1': user1,
            'user2': user2,
            'status': 'active'
        }
        USERS_IN_CHAT[user1] = chat_id
        USERS_IN_CHAT[user2] = chat_id
        
        # Удаляем пользователей из очереди ожидания
        if user1 in WAITING_USERS:
            WAITING_USERS.remove(user1)
        if user2 in WAITING_USERS:
            WAITING_USERS.remove(user2)
    
    # Сохраняем в БД
    threading.Thread(target=save_private_chat, args=(chat_id, user1, user2, now), daemon=True).start()
    
    logger.info(f"Создан приватный чат {chat_id} между {user1} и {user2}")
    return chat_id

def get_user_chat(username):
    """Получить ID чата пользователя"""
    with threading.RLock():
        return USERS_IN_CHAT.get(username)

def get_chat_partner(username):
    """Получить собеседника пользователя"""
    chat_id = get_user_chat(username)
    if chat_id:
        chat = PRIVATE_CHATS.get(chat_id)
        if chat:
            users = chat['users'].copy()
            users.discard(username)
            return next(iter(users), None)
    return None

def remove_user_from_all_queues(username):
    """Удалить пользователя из всех очередей и систем"""
    with threading.RLock():
        # Удаляем из онлайн пользователей
        if username in ONLINE_USERS:
            ONLINE_USERS.discard(username)
        
        # Удаляем из очереди ожидания
        if username in WAITING_USERS:
            WAITING_USERS.remove(username)
        
        # Удаляем предпочтения
        if username in USER_PREFERENCES:
            del USER_PREFERENCES[username]
        
        # Удаляем активность
        if username in USER_LAST_ACTIVE:
            del USER_LAST_ACTIVE[username]
        
        # Закрываем SSE соединение
        with SSE_LOCK:
            if username in SSE_CONNECTIONS:
                try:
                    SSE_CONNECTIONS.pop(username, None)
                except:
                    pass

def leave_private_chat(username):
    """Пользователь выходит из приватного чата"""
    chat_id = get_user_chat(username)
    if chat_id:
        with threading.RLock():
            chat = PRIVATE_CHATS.get(chat_id)
            if chat:
                chat['users'].discard(username)
                chat['last_activity'] = time.time()
                chat['status'] = 'inactive'
                
                # Уведомляем второго пользователя
                partner = get_chat_partner(username)
                if partner:
                    system_msg = {
                        'id': str(uuid.uuid4()),
                        'chat_id': chat_id,
                        'login': 'Система',
                        'text': f'{username} покинул чат',
                        'ts': time.time(),
                        'isvoice': False,
                        'mediatype': 'system',
                        'sound': LOGOUT_SOUND_DATA
                    }
                    
                    # Сохраняем системное сообщение
                    chat['messages'].append(system_msg)
                    
                    # Рассылаем уведомление
                    broadcast_to_chat(chat_id, system_msg, exclude_login=username)
                
                # Очищаем запись о пользователе
                USERS_IN_CHAT.pop(username, None)
                
                # Удаляем чат если оба пользователя вышли
                if len(chat['users']) == 0:
                    del PRIVATE_CHATS[chat_id]
                    # Обновляем статус в БД
                    threading.Thread(target=update_chat_status, args=(chat_id, 'closed'), daemon=True).start()
                else:
                    # Обновляем статус в БД
                    threading.Thread(target=update_chat_status, args=(chat_id, 'inactive'), daemon=True).start()
                
                logger.info(f"Пользователь {username} покинул чат {chat_id}")
                return True
    
    return False

def broadcast_to_chat(chat_id, message, exclude_login=None):
    """Отправка сообщения всем участникам приватного чата"""
    chat = PRIVATE_CHATS.get(chat_id)
    if not chat:
        return
    
    notification_data = {
        'type': 'private_message',
        'chat_id': chat_id,
        'data': message,
        'sound': message.get('sound', NOTIFICATION_SOUND_DATA)
    }
    
    for user in chat['users']:
        if user != exclude_login and user != message.get('login'):
            send_push_notification(user, notification_data)

def find_available_partner(username):
    """Найти свободного пользователя для чата с учетом предпочтений"""
    user_prefs = USER_PREFERENCES.get(username, {})
    
    with threading.RLock():
        # Ищем пользователей без активного чата
        for user in ONLINE_USERS:
            if (user != username and 
                user not in USERS_IN_CHAT and
                user in USER_PREFERENCES):
                
                partner_prefs = USER_PREFERENCES.get(user, {})
                
                # Проверяем совместимость по предпочтениям
                if not is_compatible_by_preferences(user_prefs, partner_prefs):
                    continue
                
                last_active = USER_LAST_ACTIVE.get(user, 0)
                if time.time() - last_active < 300:  # Активен в последние 5 минут
                    return user
        
        # Если не нашли, добавляем в очередь ожидания
        if username not in WAITING_USERS:
            WAITING_USERS.append(username)
            logger.info(f"Пользователь {username} добавлен в очередь ожидания. Размер очереди: {len(WAITING_USERS)}")
    
    return None

def match_waiting_users():
    """Сопоставление пользователей из очереди ожидания с учетом предпочтений"""
    with threading.RLock():
        # Создаем копию для безопасной итерации
        waiting_users_copy = WAITING_USERS.copy()
        
        for i, user1 in enumerate(waiting_users_copy):
            if user1 not in WAITING_USERS or user1 not in ONLINE_USERS:
                continue
                
            user1_prefs = USER_PREFERENCES.get(user1, {})
            
            for j, user2 in enumerate(waiting_users_copy[i+1:], i+1):
                if (user2 not in WAITING_USERS or 
                    user2 not in ONLINE_USERS or
                    user2 not in USER_PREFERENCES):
                    continue
                    
                user2_prefs = USER_PREFERENCES.get(user2, {})
                
                # Проверяем совместимость
                if is_compatible_by_preferences(user1_prefs, user2_prefs):
                    # Удаляем из очереди
                    try:
                        WAITING_USERS.remove(user1)
                        WAITING_USERS.remove(user2)
                    except ValueError:
                        continue
                    
                    # Создаем чат
                    chat_id = create_private_chat(user1, user2)
                    
                    # Системное сообщение о создании чата
                    system_msg = {
                        'id': str(uuid.uuid4()),
                        'chat_id': chat_id,
                        'login': 'Система',
                        'text': f'Чат создан между {user1} и {user2}',
                        'ts': time.time(),
                        'isvoice': False,
                        'mediatype': 'system',
                        'sound': NOTIFICATION_SOUND_DATA
                    }
                    
                    if chat_id in PRIVATE_CHATS:
                        PRIVATE_CHATS[chat_id]['messages'].append(system_msg)
                    
                    # Отправляем уведомления обоим пользователям
                    broadcast_to_chat(chat_id, system_msg)
                    
                    logger.info(f"Сопоставлены пользователи {user1} и {user2} из очереди")
                    return True
    
    return False

def cleanup_inactive_chats():
    """Очистка неактивных приватных чатов"""
    while True:
        time.sleep(60)  # Проверка каждую минуту
        try:
            now = time.time()
            inactive_chats = []
            
            with threading.RLock():
                for chat_id, chat_data in list(PRIVATE_CHATS.items()):
                    # Чат неактивен более 15 минут
                    if now - chat_data.get('last_activity', 0) > 900:
                        inactive_chats.append(chat_id)
            
            for chat_id in inactive_chats:
                with threading.RLock():
                    chat = PRIVATE_CHATS.pop(chat_id, None)
                    if chat:
                        for user in chat['users']:
                            USERS_IN_CHAT.pop(user, None)
                        
                        logger.info(f"Удален неактивный чат {chat_id}")
                        
        except Exception as e:
            logger.error(f"Ошибка очистки чатов: {e}")

# ===== ФУНКЦИИ ДЛЯ РАБОТЫ С БАЗОЙ ДАННЫХ =====
def init_db():
    """Инициализация БД с улучшенной обработкой ошибок"""
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
        conn.execute('PRAGMA journal_mode = WAL')
        conn.execute('PRAGMA synchronous = NORMAL')
        conn.execute('PRAGMA cache_size = -2000')
        conn.execute('PRAGMA foreign_keys = ON')
        conn.execute('PRAGMA busy_timeout = 5000')
        
        c = conn.cursor()
        
        # Таблица сообщений
        c.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT,  -- NULL для общих сообщений, ID чата для приватных
                login TEXT NOT NULL,
                text TEXT,
                ts REAL NOT NULL,
                isvoice INTEGER DEFAULT 0,
                mediatype TEXT,
                mediadata TEXT,
                filename TEXT,
                filesize INTEGER DEFAULT 0,
                delivered INTEGER DEFAULT 0,
                readcount INTEGER DEFAULT 0,
                sound_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Индексы для приватных чатов
        c.execute('CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, ts DESC)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts DESC)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_messages_login ON messages(login, ts DESC)')
        
        # Таблица приватных чатов
        c.execute('''
            CREATE TABLE IF NOT EXISTS private_chats (
                chat_id TEXT PRIMARY KEY,
                user1 TEXT NOT NULL,
                user2 TEXT NOT NULL,
                created_at REAL NOT NULL,
                last_activity REAL NOT NULL,
                status TEXT DEFAULT 'active',
                messages_count INTEGER DEFAULT 0
            )
        ''')
        
        # Индексы для приватных чатов
        c.execute('CREATE INDEX IF NOT EXISTS idx_chats_users ON private_chats(user1, user2)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_chats_activity ON private_chats(last_activity DESC)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_chats_status ON private_chats(status)')
        
        # Таблица пользователей (обновлена для фильтров)
        c.execute('''
            CREATE TABLE IF NOT EXISTS users (
                login TEXT PRIMARY KEY,
                gender TEXT DEFAULT 'unknown',
                age_group TEXT DEFAULT 'unknown',
                search_gender TEXT DEFAULT 'any',
                search_age TEXT DEFAULT 'any',
                last_seen REAL,
                last_heartbeat REAL,
                ip_address TEXT,
                user_agent TEXT,
                theme TEXT DEFAULT 'light',
                settings TEXT DEFAULT '{}',
                current_chat TEXT,
                chats_count INTEGER DEFAULT 0,
                waiting_since REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Индексы для пользователей
        c.execute('CREATE INDEX IF NOT EXISTS idx_users_gender ON users(gender)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_users_age ON users(age_group)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_users_search ON users(search_gender, search_age)')
        
        # Таблица сессий
        c.execute('''
            CREATE TABLE IF NOT EXISTS user_sessions (
                session_id TEXT PRIMARY KEY,
                login TEXT NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                last_activity REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Индексы для сессий
        c.execute('CREATE INDEX IF NOT EXISTS idx_sessions_login ON user_sessions(login)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_sessions_activity ON user_sessions(last_activity DESC)')
        
        conn.commit()
        logger.info("БД CloudChat инициализирована успешно")
        
    except Exception as e:
        logger.error(f"Ошибка инициализации БД: {e}")
        raise
    finally:
        if conn:
            conn.close()
    
    # Запускаем фоновые задачи
    threading.Thread(target=cleanup_inactive_users, daemon=True, name="cleanup_users").start()
    threading.Thread(target=auto_cleanup_old_messages, daemon=True, name="cleanup_messages").start()
    threading.Thread(target=cleanup_old_sessions, daemon=True, name="cleanup_sessions").start()
    threading.Thread(target=rate_limiter.cleanup, daemon=True, name="rate_limiter_cleanup").start()
    threading.Thread(target=cleanup_inactive_chats, daemon=True, name="cleanup_chats").start()
    threading.Thread(target=matchmaking_worker, daemon=True, name="matchmaking").start()
    threading.Thread(target=cleanup_old_users, daemon=True, name="cleanup_old_users").start()

def get_db_connection():
    """Получение соединения с БД с улучшенной обработкой ошибок"""
    conn = None
    for attempt in range(3):
        try:
            conn = sqlite3.connect(
                DB_PATH, 
                check_same_thread=False, 
                timeout=15,
                isolation_level=None
            )
            conn.execute('PRAGMA busy_timeout = 5000')
            conn.row_factory = sqlite3.Row
            return conn
        except sqlite3.OperationalError as e:
            logger.warning(f"Попытка {attempt+1} подключения к БД: {e}")
            if attempt == 2:
                logger.error(f"Не удалось подключиться к БД: {e}")
                try:
                    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
                    conn.row_factory = sqlite3.Row
                    return conn
                except Exception as e2:
                    logger.critical(f"Критическая ошибка БД: {e2}")
                    return None
            time.sleep(0.5 * (attempt + 1))
        except Exception as e:
            logger.error(f"Неожиданная ошибка БД: {e}")
            return None
    return None

def save_private_chat(chat_id, user1, user2, created_at):
    """Сохранение приватного чата в БД"""
    conn = None
    try:
        conn = get_db_connection()
        if not conn:
            return
        
        c = conn.cursor()
        c.execute('''
            INSERT INTO private_chats (chat_id, user1, user2, created_at, last_activity, status)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (chat_id, user1, user2, created_at, created_at, 'active'))
        
        # Обновляем информацию о пользователях
        c.execute('''
            UPDATE users SET current_chat = ?, chats_count = chats_count + 1 
            WHERE login IN (?, ?)
        ''', (chat_id, user1, user2))
        
        conn.commit()
        
    except Exception as e:
        logger.error(f"Ошибка сохранения приватного чата: {e}")
    finally:
        if conn:
            conn.close()

def update_chat_status(chat_id, status):
    """Обновление статуса чата в БД"""
    conn = None
    try:
        conn = get_db_connection()
        if not conn:
            return
        
        c = conn.cursor()
        c.execute('''
            UPDATE private_chats 
            SET status = ?, last_activity = ?
            WHERE chat_id = ?
        ''', (status, time.time(), chat_id))
        
        conn.commit()
        
    except Exception as e:
        logger.error(f"Ошибка обновления статуса чата: {e}")
    finally:
        if conn:
            conn.close()

def matchmaking_worker():
    """Фоновый процесс для сопоставления пользователей"""
    while True:
        time.sleep(5)  # Проверяем каждые 5 секунд
        try:
            match_waiting_users()
        except Exception as e:
            logger.error(f"Ошибка в matchmaking_worker: {e}")

def cleanup_old_users():
    """Очистка старых записей пользователей (более 30 дней)"""
    while True:
        time.sleep(86400)  # Каждые 24 часа
        try:
            conn = get_db_connection()
            if conn:
                c = conn.cursor()
                cutoff = time.time() - (30 * 24 * 3600)  # 30 дней
                c.execute("DELETE FROM users WHERE last_seen < ?", (cutoff,))
                deleted = c.rowcount
                if deleted > 0:
                    logger.info(f"Очистка пользователей: удалено {deleted} старых записей")
                conn.commit()
                conn.close()
        except Exception as e:
            logger.error(f"Ошибка очистки пользователей: {e}")

# ===== ФУНКЦИИ ДЛЯ РАБОТЫ С МЕДИА =====
@lru_cache(maxsize=128)
def compress_image(base64_data, max_size=(1200, 1200), quality=85):
    """Оптимизированное сжатие изображений"""
    try:
        if not base64_data or not isinstance(base64_data, str):
            return base64_data
        
        if not base64_data.startswith('data:'):
            return base64_data
        
        parts = base64_data.split(',', 1)
        if len(parts) != 2:
            return base64_data
        
        header, data = parts
        
        if 'image/svg+xml' in header:
            return base64_data
        
        try:
            img_data = base64.b64decode(data)
        except Exception:
            return base64_data
        
        # Проверяем размер
        if len(img_data) < 102400:
            return base64_data
        
        # Определяем формат
        img_format = 'JPEG'
        if 'image/png' in header:
            img_format = 'PNG'
        elif 'image/webp' in header:
            img_format = 'WEBP'
        
        # Обрабатываем изображение
        img = Image.open(io.BytesIO(img_data))
        
        if img_format == 'JPEG' and img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGB')
        
        # Масштабируем
        if max(img.size) > max(max_size):
            ratio = min(max_size[0] / img.size[0], max_size[1] / img.size[1])
            new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        
        # Сжимаем
        output = io.BytesIO()
        
        if img_format == 'PNG':
            img.save(output, format='PNG', optimize=True)
        elif img_format == 'WEBP':
            img.save(output, format='WEBP', quality=quality)
        else:
            img.save(output, format='JPEG', quality=quality, optimize=True)
        
        compressed = output.getvalue()
        
        if len(compressed) >= len(img_data):
            return base64_data
        
        mime_type = 'image/jpeg'
        if img_format == 'PNG':
            mime_type = 'image/png'
        elif img_format == 'WEBP':
            mime_type = 'image/webp'
        
        return f"data:{mime_type};base64,{base64.b64encode(compressed).decode()}"
    
    except Exception as e:
        logger.error(f"Ошибка сжатия изображения: {e}")
        return base64_data

def validate_base64_data(data, max_size_mb=100):
    """Валидация base64 данных"""
    if not data:
        return False
    
    try:
        estimated_size = len(data) * 3 / 4
        if estimated_size > max_size_mb * 1024 * 1024:
            return False
        
        if data.startswith('data:'):
            if ',' not in data:
                return False
            header, b64 = data.split(',', 1)
            if 'base64' not in header:
                return False
            
            # Проверяем MIME тип
            mime_match = re.match(r'data:(.+);base64', header)
            if mime_match:
                mime_type = mime_match.group(1)
                allowed_types = [
                    'image/', 'video/', 'audio/',
                    'application/pdf', 'text/plain',
                    'application/zip', 'application/x-rar-compressed'
                ]
                if not any(mime_type.startswith(allowed) for allowed in allowed_types):
                    return False
            
            decoded = base64.b64decode(b64, validate=True)
            
            if len(decoded) > max_size_mb * 1024 * 1024:
                return False
                
            return True
        else:
            decoded = base64.b64decode(data, validate=True)
            if len(decoded) > max_size_mb * 1024 * 1024:
                return False
            return True
    except Exception:
        return False

# ===== ФУНКЦИИ ДЛЯ РАБОТЫ С СООБЩЕНИЯМИ =====
def update_message_status(msgid, status_type, login=None):
    """Обновление статуса сообщения"""
    conn = None
    try:
        conn = get_db_connection()
        if not conn:
            return
        
        c = conn.cursor()
        
        if status_type == 'delivered':
            c.execute("UPDATE messages SET delivered = 1 WHERE id = ?", (msgid,))
                    
        elif status_type == 'read' and login:
            c.execute("""
                UPDATE messages 
                SET readcount = readcount + 1 
                WHERE id = ?
                RETURNING readcount
            """, (msgid,))
            
            result = c.fetchone()
        
        conn.commit()
        
    except Exception as e:
        logger.error(f"Ошибка обновления статуса сообщения {msgid}: {e}")
    finally:
        if conn:
            conn.close()

def send_push_notification(login, notification_data):
    """Отправка пуш-уведомления пользователю"""
    try:
        with SSE_LOCK:
            if login in SSE_CONNECTIONS:
                try:
                    sse_queue = SSE_CONNECTIONS[login]
                    sse_queue.put(notification_data)
                    return True
                except Exception as e:
                    logger.error(f"Ошибка отправки push-уведомления {login}: {e}")
                    # Удаляем нерабочую очередь
                    SSE_CONNECTIONS.pop(login, None)
                    return False
        return False
    except Exception as e:
        logger.error(f"Ошибка отправки пуш-уведомления: {e}")
        return False

def save_message(msg):
    """Сохранение сообщения в БД"""
    conn = None
    try:
        conn = get_db_connection()
        if not conn:
            logger.error("Не удалось подключиться к БД для сохранения сообщения")
            return
        
        c = conn.cursor()
        
        filesize = 0
        if msg.get('mediadata'):
            filesize = len(msg['mediadata']) * 3 // 4
        
        c.execute('''
            INSERT INTO messages (id, chat_id, login, text, ts, isvoice, mediatype, 
                               mediadata, filename, filesize, delivered, readcount, sound_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            msg['id'], msg.get('chat_id'), msg['login'], msg.get('text', ''),
            msg['ts'], int(msg.get('isvoice', 0)),
            msg.get('mediatype'), msg.get('mediadata', ''),
            msg.get('filename', ''), filesize,
            int(msg.get('delivered', 0)),
            int(msg.get('readcount', 0)),
            msg.get('sound')
        ))
        
        # Обновляем счетчик сообщений в чате
        if msg.get('chat_id'):
            c.execute('''
                UPDATE private_chats 
                SET messages_count = messages_count + 1, last_activity = ?
                WHERE chat_id = ?
            ''', (msg['ts'], msg['chat_id']))
        
        conn.commit()
        
    except Exception as e:
        logger.error(f"Ошибка сохранения сообщения: {e}")
    finally:
        if conn:
            conn.close()

def save_and_broadcast_message(msg):
    """Сохранение и рассылка сообщения (обновлено для приватных чатов)"""
    chat_id = msg.get('chat_id')
    
    if chat_id:
        # Это приватное сообщение
        chat = PRIVATE_CHATS.get(chat_id)
        if not chat:
            raise ValueError("Чат не найден")
        
        if msg['login'] not in chat['users']:
            raise ValueError("Вы не состоите в этом чате")
        
        with threading.RLock():
            chat['messages'].append(msg)
            chat['last_activity'] = time.time()
            
            if len(chat['messages']) > MESSAGE_HISTORY_LIMIT * 2:
                chat['messages'] = chat['messages'][-MESSAGE_HISTORY_LIMIT:]
        
        # Рассылаем в приватный чат
        broadcast_to_chat(chat_id, msg, exclude_login=msg['login'])
    
    # Сохраняем в БД
    threading.Thread(target=save_message, args=(msg,), daemon=True).start()
    
    return msg

# ===== ФУНКЦИИ ОЧИСТКИ =====
def cleanup_inactive_users():
    """Очистка неактивных пользователей"""
    while True:
        time.sleep(30)  # Проверка каждые 30 секунд
        try:
            now = time.time()
            expired_users = []
            
            # Собираем неактивных пользователей
            with threading.RLock():
                users_to_check = list(USER_LAST_ACTIVE.items())
            
            for user, last_active in users_to_check:
                if now - last_active > INACTIVITY_TIMEOUT:
                    expired_users.append(user)
            
            # Обрабатываем истекших пользователей
            if expired_users:
                logger.info(f"Автомосвобождение: {len(expired_users)} пользователей")
                
                for user in expired_users:
                    with threading.RLock():
                        if user in ONLINE_USERS:
                            ONLINE_USERS.discard(user)
                            USER_LAST_ACTIVE.pop(user, None)
                            USER_PREFERENCES.pop(user, None)
                    
                    # Выходим из чата если пользователь в нем
                    leave_private_chat(user)
                    
                    # Удаляем из очереди ожидания
                    if user in WAITING_USERS:
                        WAITING_USERS.remove(user)
                    
                    # Закрываем SSE соединение
                    with SSE_LOCK:
                        if user in SSE_CONNECTIONS:
                            SSE_CONNECTIONS.pop(user, None)
                
                # Удаляем сессии из БД
                conn = None
                try:
                    conn = get_db_connection()
                    if conn:
                        c = conn.cursor()
                        placeholders = ','.join('?' for _ in expired_users)
                        c.execute(f"DELETE FROM user_sessions WHERE login IN ({placeholders})", expired_users)
                        conn.commit()
                except Exception as e:
                    logger.error(f"Ошибка очистки сессий: {e}")
                finally:
                    if conn:
                        conn.close()
                    
        except Exception as e:
            logger.error(f"Ошибка очистки пользователей: {e}")

def cleanup_old_sessions():
    """Очистка старых сессий"""
    while True:
        time.sleep(3600)  # Каждый час
        try:
            conn = get_db_connection()
            if conn:
                c = conn.cursor()
                cutoff = time.time() - (7 * 24 * 3600)  # 7 дней
                c.execute("DELETE FROM user_sessions WHERE last_activity < ?", (cutoff,))
                deleted = c.rowcount
                if deleted > 0:
                    logger.info(f"Очистка сессий: удалено {deleted} старых сессий")
                conn.commit()
                conn.close()
        except Exception as e:
            logger.error(f"Ошибка очистки сессий: {e}")

def auto_cleanup_old_messages():
    """Автоматическая очистка старых сообщений"""
    while True:
        time.sleep(3600)  # Каждый час
        conn = None
        try:
            conn = get_db_connection()
            if not conn:
                continue
                
            c = conn.cursor()
            cutoff = time.time() - (30 * 24 * 3600)  # 30 дней
            c.execute("DELETE FROM messages WHERE ts < ?", (cutoff,))
            deleted_count = c.rowcount
            
            if deleted_count > 0:
                logger.info(f"Автоочистка: удалено {deleted_count} старых сообщений")
                conn.commit()
            
            # Оптимизация БД
            c.execute("VACUUM")
            
        except Exception as e:
            logger.error(f"Ошибка автоочистки сообщений: {e}")
        finally:
            if conn:
                conn.close()

# ===== ВАЛИДАЦИЯ И УТИЛИТЫ =====
def require_online_user(silent=True):
    """Проверка онлайн пользователя с проверкой активности"""
    data = request.get_json(silent=True) or {}
    login = data.get('login', '').strip()
    
    if not login:
        return jsonify({'error': 'Не авторизован'}), 401
    
    now = time.time()
    
    with threading.RLock():
        if login not in ONLINE_USERS:
            return jsonify({'error': 'Пользователь не в сети'}), 401
        
        last_active = USER_LAST_ACTIVE.get(login, 0)
        if now - last_active > INACTIVITY_TIMEOUT:
            ONLINE_USERS.discard(login)
            USER_LAST_ACTIVE.pop(login, None)
            USER_PREFERENCES.pop(login, None)
            leave_private_chat(login)
            
            return jsonify({'error': 'Сессия истекла из-за неактивности'}), 401
        
        USER_LAST_ACTIVE[login] = now
    
    return None

def validate_nickname(nick):
    """Валидация ника"""
    if not nick or len(nick) < 3 or len(nick) > 18:
        return False, "Ник должен быть от 3 до 18 символов"
    
    if not re.match(r'^[a-zA-Zа-яА-ЯёЁ0-9_]+$', nick):
        return False, "Разрешены только буквы, цифры и подчеркивание"
    
    forbidden_words = ['admin', 'system', 'root', 'moderator', 'support', 'система']
    if any(word in nick.lower() for word in forbidden_words):
        return False, "Этот ник зарезервирован"
    
    return True, ""

def format_username(login):
    """Форматирование имени пользователя"""
    safe_login = re.sub(r'[^a-zA-Zа-яА-ЯёЁ0-9_]', '', login[:18])
    return safe_login.strip()

# ===== МАРШРУТЫ =====
@app.route('/')
def index():
    """Главная страница CloudChat"""
    init_db()
    response = make_response(render_template('index.html'))
    
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    
    return response

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Отдача статических файлов"""
    response = send_from_directory(app.static_folder, filename, max_age=3600)
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return response

@app.route('/api/health')
def health_check():
    """Проверка здоровья сервера"""
    db_status = 'error'
    try:
        conn = get_db_connection()
        if conn:
            conn.execute('SELECT 1')
            conn.close()
            db_status = 'ok'
    except:
        pass
    
    with threading.RLock():
        online_count = len(ONLINE_USERS)
        private_chats_count = len(PRIVATE_CHATS)
        waiting_count = len(WAITING_USERS)
    
    return jsonify({
        'status': 'ok',
        'timestamp': time.time(),
        'version': '12.1-FILTERS',
        'app_name': 'CloudChat',
        'database': db_status,
        'online_users': online_count,
        'private_chats': private_chats_count,
        'waiting_users': waiting_count,
        'inactivity_timeout': INACTIVITY_TIMEOUT
    })

@app.route('/checknick', methods=['POST'])
@rate_limit
def check_nick():
    """Проверка доступности ника"""
    try:
        data = request.get_json() or {}
        nick = data.get('nick', '').strip()
        
        valid, reason = validate_nickname(nick)
        if not valid:
            return jsonify(available=False, reason=reason)
        
        with threading.RLock():
            nick_lower = nick.lower()
            if any(user.lower() == nick_lower for user in ONLINE_USERS):
                return jsonify(available=False, reason="Этот ник уже используется")
        
        return jsonify(available=True, nick=nick)
        
    except Exception as e:
        logger.error(f"Ошибка проверки ника: {e}")
        return jsonify(available=False, reason="Ошибка сервера"), 500

@app.route('/join', methods=['POST'])
@rate_limit
def join():
    """Вход пользователя в CloudChat с указанием пола и возраста"""
    try:
        data = request.get_json() or {}
        nick = data.get('nick', '').strip()
        gender = data.get('gender', 'unknown')
        age = data.get('age', '')
        search_gender = data.get('search_gender', 'any')
        search_age = data.get('search_age', 'any')
        
        valid, reason = validate_nickname(nick)
        if not valid:
            return jsonify(success=False, reason=reason)

        # Валидация возрастной группы
        if not validate_age_group(age):
            return jsonify(success=False, reason="Некорректная возрастная группа")
    
        age_group = age  # Теперь age уже является возрастной группой
        
        # Валидация пола
        if gender not in ['male', 'female', 'unknown']:
            gender = 'unknown'
        
        # Валидация параметров поиска
        if search_gender not in ['any', 'male', 'female']:
            search_gender = 'any'
        if search_age not in ['any', 'under18', '18-25', '26-35', '35plus']:
            search_age = 'any'
        
        nick = format_username(nick)
        
        with threading.RLock():
            nick_lower = nick.lower()
            
            # Проверяем, можно ли занять ник
            now = time.time()
            for user in list(ONLINE_USERS):
                if user.lower() == nick_lower:
                    last_active = USER_LAST_ACTIVE.get(user, 0)
                    if now - last_active > 30:
                        # Освобождаем неактивный ник
                        remove_user_from_all_queues(user)
                        leave_private_chat(user)
                        logger.info(f"Освобождение неактивного ника: {user}")
                    else:
                        return jsonify(success=False, reason="Этот ник уже используется")
            
            ONLINE_USERS.add(nick)
            USER_LAST_ACTIVE[nick] = now
            USER_PREFERENCES[nick] = {
                'gender': gender,
                'age_group': age_group,
                'search_gender': search_gender,
                'search_age': search_age
            }
            
            # Автоматически ищем собеседника
            partner = find_available_partner(nick)
            if partner:
                chat_id = create_private_chat(nick, partner)
                
                # Системное сообщение о создании чата
                system_msg = {
                    'id': str(uuid.uuid4()),
                    'chat_id': chat_id,
                    'login': 'Система',
                    'text': f'Вы подключены к {partner}',
                    'ts': now,
                    'isvoice': False,
                    'mediatype': 'system',
                    'sound': NOTIFICATION_SOUND_DATA,
                    'delivered': True,
                    'readcount': 0
                }
                
                if chat_id in PRIVATE_CHATS:
                    PRIVATE_CHATS[chat_id]['messages'].append(system_msg)
                
                # Отправляем уведомления обоим пользователям
                broadcast_to_chat(chat_id, system_msg)
                
                logger.info(f"Создан автоматический чат между {nick} и {partner}")
                
                result = {
                    'success': True, 
                    'nick': nick,
                    'in_chat': True,
                    'partner': partner,
                    'chat_id': chat_id,
                    'message': f'Вы подключены к {partner}'
                }
            else:
                # Добавляем в очередь ожидания
                if nick not in WAITING_USERS:
                    WAITING_USERS.append(nick)
                
                result = {
                    'success': True, 
                    'nick': nick,
                    'in_chat': False,
                    'partner': None,
                    'chat_id': None,
                    'message': 'Ищем собеседника...',
                    'waiting_position': len(WAITING_USERS)
                }
        
        # Сохраняем сессию и данные пользователя
        conn = None
        try:
            conn = get_db_connection()
            if conn:
                c = conn.cursor()
                ip_address = request.remote_addr
                user_agent = request.headers.get('User-Agent', '')
                
                session_id = str(uuid.uuid4())
                c.execute('''
                    INSERT INTO user_sessions (session_id, login, ip_address, user_agent, last_activity)
                    VALUES (?, ?, ?, ?, ?)
                ''', (session_id, nick, ip_address, user_agent, now))
                
                c.execute('''
                    INSERT OR REPLACE INTO users 
                    (login, gender, age_group, search_gender, search_age, last_seen, last_heartbeat, 
                     ip_address, user_agent, current_chat, waiting_since)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (nick, gender, age_group, search_gender, search_age, now, now, 
                      ip_address, user_agent, result.get('chat_id'), 
                      now if not result.get('in_chat') else None))
                
                conn.commit()
        except Exception as e:
            logger.error(f"Ошибка сохранения сессии: {e}")
        finally:
            if conn:
                conn.close()
        
        logger.info(f"Пользователь вошел: {nick} (пол: {gender}, возраст: {age_group})")
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Ошибка входа: {e}")
        return jsonify(success=False, reason="Ошибка сервера"), 500

@app.route('/update_preferences', methods=['POST'])
@rate_limit
def update_preferences():
    """Обновление предпочтений поиска"""
    error = require_online_user()
    if error:
        return error
    
    try:
        data = request.get_json() or {}
        login = data.get('login', '').strip()
        search_gender = data.get('search_gender', 'any')
        search_age = data.get('search_age', 'any')
        
        # Валидация
        if search_gender not in ['any', 'male', 'female']:
            search_gender = 'any'
        if search_age not in ['any', 'under18', '18-25', '26-35', '35plus']:
            search_age = 'any'
        
        with threading.RLock():
            if login in USER_PREFERENCES:
                USER_PREFERENCES[login]['search_gender'] = search_gender
                USER_PREFERENCES[login]['search_age'] = search_age
        
        # Обновляем в БД
        conn = None
        try:
            conn = get_db_connection()
            if conn:
                c = conn.cursor()
                c.execute('''
                    UPDATE users SET search_gender = ?, search_age = ?
                    WHERE login = ?
                ''', (search_gender, search_age, login))
                conn.commit()
        except Exception as e:
            logger.error(f"Ошибка обновления предпочтений: {e}")
        finally:
            if conn:
                conn.close()
        
        return jsonify({'success': True, 'message': 'Предпочтения обновлены'})
        
    except Exception as e:
        logger.error(f"Ошибка обновления предпочтений: {e}")
        return jsonify({'success': False, 'reason': 'Ошибка сервера'}), 500

@app.route('/find_partner', methods=['POST'])
@rate_limit
def find_partner():
    """Поиск собеседника для приватного чата"""
    error = require_online_user()
    if error:
        return error
    
    try:
        data = request.get_json() or {}
        login = data.get('login', '').strip()
        
        # Проверяем, не находится ли уже в чате
        if get_user_chat(login):
            return jsonify({
                'success': False,
                'reason': 'Вы уже находитесь в чате'
            })
        
        # Выходим из текущего чата если есть
        leave_private_chat(login)
        
        # Ищем доступного собеседника
        partner = find_available_partner(login)
        
        if partner:
            chat_id = create_private_chat(login, partner)
            
            # Системное сообщение
            system_msg = {
                'id': str(uuid.uuid4()),
                'chat_id': chat_id,
                'login': 'Система',
                'text': f'Вы подключены к {partner}',
                'ts': time.time(),
                'isvoice': False,
                'mediatype': 'system',
                'sound': NOTIFICATION_SOUND_DATA
            }
            
            with threading.RLock():
                if chat_id in PRIVATE_CHATS:
                    PRIVATE_CHATS[chat_id]['messages'].append(system_msg)
            
            broadcast_to_chat(chat_id, system_msg)
            
            # Обновляем информацию о пользователе в БД
            conn = None
            try:
                conn = get_db_connection()
                if conn:
                    c = conn.cursor()
                    c.execute('''
                        UPDATE users 
                        SET current_chat = ?, chats_count = chats_count + 1, waiting_since = NULL 
                        WHERE login = ?
                    ''', (chat_id, login))
                    conn.commit()
            except Exception as e:
                logger.error(f"Ошибка обновления пользователя: {e}")
            finally:
                if conn:
                    conn.close()
            
            return jsonify({
                'success': True,
                'partner': partner,
                'chat_id': chat_id,
                'message': f'Вы подключены к {partner}'
            })
        else:
            # Добавляем в очередь ожидания
            with threading.RLock():
                if login not in WAITING_USERS:
                    WAITING_USERS.append(login)
            
            # Обновляем время ожидания в БД
            conn = None
            try:
                conn = get_db_connection()
                if conn:
                    c = conn.cursor()
                    c.execute('UPDATE users SET waiting_since = ? WHERE login = ?', 
                             (time.time(), login))
                    conn.commit()
            except Exception as e:
                logger.error(f"Ошибка обновления ожидания: {e}")
            finally:
                if conn:
                    conn.close()
            
            return jsonify({
                'success': False,
                'reason': 'Нет доступных собеседников. Вы в очереди ожидания.',
                'waiting_position': len(WAITING_USERS)
            })
        
    except Exception as e:
        logger.error(f"Ошибка поиска собеседника: {e}")
        return jsonify({'success': False, 'reason': 'Ошибка сервера'}), 500

@app.route('/leave_chat', methods=['POST'])
@rate_limit
def leave_chat():
    """Выход из приватного чата"""
    error = require_online_user()
    if error:
        return error
    
    try:
        data = request.get_json() or {}
        login = data.get('login', '').strip()
        
        # Удаляем из очереди ожидания, если пользователь там
        with threading.RLock():
            if login in WAITING_USERS:
                WAITING_USERS.remove(login)
        
        if leave_private_chat(login):
            # Обновляем информацию о пользователе в БД
            conn = None
            try:
                conn = get_db_connection()
                if conn:
                    c = conn.cursor()
                    c.execute('UPDATE users SET current_chat = NULL, waiting_since = NULL WHERE login = ?', (login,))
                    conn.commit()
            except Exception as e:
                logger.error(f"Ошибка обновления пользователя: {e}")
            finally:
                if conn:
                    conn.close()
            
            return jsonify({
                'success': True,
                'message': 'Вы вышли из чата'
            })
        else:
            return jsonify({
                'success': False,
                'reason': 'Вы не находитесь в чате'
            })
        
    except Exception as e:
        logger.error(f"Ошибка выхода из чата: {e}")
        return jsonify({'success': False, 'reason': 'Ошибка сервера'}), 500

@app.route('/stop_search', methods=['POST'])
@rate_limit
def stop_search():
    """Полная остановка поиска собеседника"""
    error = require_online_user()
    if error:
        return error
    
    try:
        data = request.get_json() or {}
        login = data.get('login', '').strip()
        
        # Удаляем из очереди ожидания
        with threading.RLock():
            if login in WAITING_USERS:
                WAITING_USERS.remove(login)
        
        # Обновляем в БД
        conn = None
        try:
            conn = get_db_connection()
            if conn:
                c = conn.cursor()
                c.execute('UPDATE users SET waiting_since = NULL WHERE login = ?', (login,))
                conn.commit()
        except Exception as e:
            logger.error(f"Ошибка обновления поиска: {e}")
        finally:
            if conn:
                conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Поиск остановлен'
        })
        
    except Exception as e:
        logger.error(f"Ошибка остановки поиска: {e}")
        return jsonify({'success': False, 'reason': 'Ошибка сервера'}), 500

@app.route('/send_private', methods=['POST'])
@rate_limit
def send_private_message():
    """Отправка приватного сообщения"""
    error = require_online_user()
    if error:
        return error
    
    try:
        data = request.get_json() or {}
        login = data.get('login', '').strip()
        text = data.get('text', '').strip()
        chat_id = data.get('chat_id')
        
        if not chat_id:
            return jsonify({'error': 'Не указан ID чата'}), 400
        
        # Проверяем, что пользователь в этом чате
        chat = PRIVATE_CHATS.get(chat_id)
        if not chat or login not in chat['users']:
            return jsonify({'error': 'Вы не состоите в этом чате'}), 403
        
        if not text:
            return jsonify({'error': 'Сообщение не может быть пустым'}), 400
        
        if len(text) > 2000:
            return jsonify({'error': 'Сообщение не может превышать 2000 символов'}), 400
        
        msg = {
            'id': str(uuid.uuid4()),
            'chat_id': chat_id,
            'login': login,
            'text': text,
            'ts': time.time(),
            'isvoice': False,
            'delivered': False,
            'readcount': 0
        }
        
        saved_msg = save_and_broadcast_message(msg)
        return jsonify(saved_msg)
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.error(f"Ошибка отправки приватного сообщения: {e}")
        return jsonify({'error': 'Ошибка сервера'}), 500

@app.route('/poll_private', methods=['GET'])
@rate_limit
def poll_private_messages():
    """Опрос приватных сообщений"""
    try:
        login = request.args.get('login', '')
        chat_id = request.args.get('chat_id', '')
        since = float(request.args.get('since', 0))
        
        if not chat_id:
            return jsonify({'error': 'Не указан ID чата'}), 400
        
        # Проверяем доступ к чату
        chat = PRIVATE_CHATS.get(chat_id)
        if not chat or login not in chat['users']:
            return jsonify({'error': 'Доступ к чату запрещен'}), 403
        
        # Получаем сообщения из чата
        with threading.RLock():
            chat_messages = chat.get('messages', [])
            new_msgs = []
            
            for m in chat_messages[-100:]:
                if m.get('ts', 0) > since:
                    msg_copy = m.copy()
                    new_msgs.append(msg_copy)
        
        return jsonify({
            'messages': new_msgs,
            'chat_id': chat_id,
            'partner': get_chat_partner(login),
            'timestamp': time.time()
        })
        
    except Exception as e:
        logger.error(f"Ошибка опроса приватных сообщений: {e}")
        return jsonify({'error': 'Ошибка сервера'}), 500

@app.route('/chat_status', methods=['GET'])
@rate_limit
def get_chat_status():
    """Получить статус чата пользователя"""
    try:
        login = request.args.get('login', '')
        
        chat_id = get_user_chat(login)
        if chat_id:
            chat = PRIVATE_CHATS.get(chat_id)
            if chat:
                partner = get_chat_partner(login)
                return jsonify({
                    'in_chat': True,
                    'chat_id': chat_id,
                    'partner': partner,
                    'created_at': chat.get('created_at'),
                    'last_activity': chat.get('last_activity'),
                    'message_count': len(chat.get('messages', []))
                })
        
        # Проверяем, в очереди ли пользователь
        with threading.RLock():
            waiting_position = WAITING_USERS.index(login) + 1 if login in WAITING_USERS else 0
        
        return jsonify({
            'in_chat': False,
            'waiting': waiting_position > 0,
            'waiting_position': waiting_position,
            'message': 'Вы не в чате' + (f', позиция в очереди: {waiting_position}' if waiting_position > 0 else '')
        })
        
    except Exception as e:
        logger.error(f"Ошибка получения статуса чата: {e}")
        return jsonify({'error': 'Ошибка сервера'}), 500

@app.route('/logout', methods=['POST'])
@rate_limit
def logout():
    """🔥 УЛУЧШЕННЫЙ выход пользователя с очисткой всех данных"""
    try:
        data = request.get_json() or {}
        nick = data.get('nick', '').strip()
        
        if nick:
            # Выходим из чата
            leave_private_chat(nick)
            
            # Полностью удаляем пользователя из системы
            remove_user_from_all_queues(nick)
            
            # Обновляем БД
            conn = None
            try:
                conn = get_db_connection()
                if conn:
                    c = conn.cursor()
                    c.execute("DELETE FROM user_sessions WHERE login = ?", (nick,))
                    c.execute("UPDATE users SET current_chat = NULL, waiting_since = NULL WHERE login = ?", (nick,))
                    conn.commit()
            except Exception as e:
                logger.error(f"Ошибка очистки данных пользователя: {e}")
            finally:
                if conn:
                    conn.close()
            
            logger.info(f"Полный выход пользователя: {nick}")
        
        return jsonify(success=True)
        
    except Exception as e:
        logger.error(f"Ошибка выхода: {e}")
        return jsonify(success=True)

@app.route('/force_logout', methods=['POST'])
def force_logout():
    """Принудительный выход при закрытии браузера/вкладки"""
    try:
        data = request.get_json() or {}
        nick = data.get('nick', '').strip()
        
        if nick:
            logger.info(f"Принудительный выход (закрытие браузера): {nick}")
            
            # Используем sendBeacon для быстрой обработки
            threading.Thread(target=force_user_logout, args=(nick,), daemon=True).start()
        
        return jsonify(success=True)
        
    except Exception as e:
        logger.error(f"Ошибка force_logout: {e}")
        return jsonify(success=True)

def force_user_logout(nick):
    """Фоновая функция для принудительного выхода"""
    try:
        # Выходим из чата
        leave_private_chat(nick)
        
        # Полностью удаляем пользователя из системы
        remove_user_from_all_queues(nick)
        
        # Обновляем БД
        conn = None
        try:
            conn = get_db_connection()
            if conn:
                c = conn.cursor()
                c.execute("DELETE FROM user_sessions WHERE login = ?", (nick,))
                c.execute("UPDATE users SET current_chat = NULL, waiting_since = NULL WHERE login = ?", (nick,))
                conn.commit()
        except Exception as e:
            logger.error(f"Ошибка очистки данных пользователя: {e}")
        finally:
            if conn:
                conn.close()
        
        logger.info(f"Принудительный выход завершен: {nick}")
        
    except Exception as e:
        logger.error(f"Ошибка в force_user_logout: {e}")

@app.route('/voice', methods=['POST'])
@rate_limit
def send_voice():
    """Отправка голосового сообщения в приватный чат"""
    error = require_online_user()
    if error:
        return error
    
    try:
        data = request.get_json() or {}
        login = data.get('login', '').strip()
        audio_b64 = data.get('voice', '')
        chat_id = data.get('chat_id')
        
        if not chat_id:
            return jsonify({'error': 'Не указан ID чата'}), 400
        
        if not audio_b64:
            return jsonify({'error': 'Отсутствуют аудиоданные'}), 400
        
        if not validate_base64_data(audio_b64, max_size_mb=10):
            return jsonify({'error': 'Неверный формат аудио или превышен размер (макс. 10MB)'}), 400
        
        # Проверяем, что пользователь в этом чате
        chat = PRIVATE_CHATS.get(chat_id)
        if not chat or login not in chat['users']:
            return jsonify({'error': 'Вы не состоите в этом чате'}), 403
        
        if not audio_b64.startswith('data:'):
            formatted = f"data:audio/webm;base64,{audio_b64}"
        else:
            formatted = audio_b64
        
        msg = {
            'id': str(uuid.uuid4()),
            'chat_id': chat_id,
            'login': login,
            'text': '',
            'ts': time.time(),
            'isvoice': True,
            'mediatype': 'voice',
            'mediadata': formatted,
            'filename': 'voice.webm',
            'delivered': False,
            'readcount': 0
        }
        
        saved_msg = save_and_broadcast_message(msg)
        return jsonify(saved_msg)
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.error(f"Ошибка отправки голосового сообщения: {e}")
        return jsonify({'error': 'Ошибка сервера'}), 500

@app.route('/video', methods=['POST'])
@rate_limit
def send_video():
    """Отправка видео-записи в приватный чат"""
    error = require_online_user()
    if error:
        return error
    
    try:
        data = request.get_json() or {}
        login = data.get('login', '').strip()
        video_b64 = data.get('video', '')
        chat_id = data.get('chat_id')
        
        if not chat_id:
            return jsonify({'error': 'Не указан ID чата'}), 400
        
        if not video_b64:
            return jsonify({'error': 'Отсутствуют видеоданные'}), 400
        
        if not validate_base64_data(video_b64, max_size_mb=50):
            return jsonify({'error': 'Неверный формат видео или превышен размер (макс. 50MB)'}), 400
        
        # Проверяем, что пользователь в этом чате
        chat = PRIVATE_CHATS.get(chat_id)
        if not chat or login not in chat['users']:
            return jsonify({'error': 'Вы не состоите в этом чате'}), 403
        
        if not video_b64.startswith('data:'):
            formatted = f"data:video/webm;base64,{video_b64}"
        else:
            formatted = video_b64
        
        msg = {
            'id': str(uuid.uuid4()),
            'chat_id': chat_id,
            'login': login,
            'text': '',
            'ts': time.time(),
            'isvoice': False,
            'mediatype': 'video',
            'mediadata': formatted,
            'filename': 'video.webm',
            'delivered': False,
            'readcount': 0
        }
        
        saved_msg = save_and_broadcast_message(msg)
        return jsonify(saved_msg)
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.error(f"Ошибка отправки видео: {e}")
        return jsonify({'error': 'Ошибка сервера'}), 500

@app.route('/media', methods=['POST'])
@rate_limit
def send_media():
    """Отправка медиафайла в приватный чат"""
    error = require_online_user()
    if error:
        return error
    
    try:
        data = request.get_json() or {}
        login = data.get('login', '').strip()
        mediatype = data.get('type', 'file')
        media_data = data.get('data', '')
        filename = data.get('filename', 'file').strip() or 'file'
        chat_id = data.get('chat_id')
        
        if not chat_id:
            return jsonify({'error': 'Не указан ID чата'}), 400
        
        if not media_data:
            return jsonify({'error': 'Отсутствуют данные файла'}), 400
        
        # Проверяем, что пользователь в этом чате
        chat = PRIVATE_CHATS.get(chat_id)
        if not chat or login not in chat['users']:
            return jsonify({'error': 'Вы не состоите в этом чате'}), 403
        
        max_size_mb = 64
        if mediatype == 'image':
            max_size_mb = 20
        elif mediatype == 'video':
            max_size_mb = 50
        elif mediatype == 'music':
            max_size_mb = 30
        
        if not validate_base64_data(media_data, max_size_mb=max_size_mb):
            return jsonify({'error': f'Неверный формат или превышен размер (макс. {max_size_mb}MB)'}), 400
        
        formatted = media_data
        
        if media_data.startswith('data:'):
            header, b64_data = media_data.split(',', 1)
            mime_match = re.match(r'data:(.+);base64', header)
            
            if mime_match:
                mime_type = mime_match.group(1)
                
                if mediatype == 'image' and mime_type.startswith('image/'):
                    formatted = compress_image(media_data)
        else:
            mime_type = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
            formatted = f"data:{mime_type};base64,{media_data}"
        
        msg = {
            'id': str(uuid.uuid4()),
            'chat_id': chat_id,
            'login': login,
            'text': '',
            'ts': time.time(),
            'isvoice': False,
            'mediatype': mediatype,
            'mediadata': formatted,
            'filename': filename,
            'delivered': False,
            'readcount': 0
        }
        
        saved_msg = save_and_broadcast_message(msg)
        return jsonify(saved_msg)
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.error(f"Ошибка отправки медиа: {e}")
        return jsonify({'error': 'Ошибка сервера'}), 500

@app.route('/events')
def sse_events():
    """Server-Sent Events"""
    login = request.args.get('login', '')
    if not login:
        return jsonify({'error': 'Требуется логин'}), 400
    
    def event_stream():
        """Генератор событий SSE"""
        user_queue = queue.Queue()
        
        with SSE_LOCK:
            # Проверяем лимит соединений
            if len(SSE_CONNECTIONS) >= MAX_SSE_CONNECTIONS:
                # Удаляем самое старое соединение
                if SSE_CONNECTIONS:
                    oldest = list(SSE_CONNECTIONS.keys())[0]
                    SSE_CONNECTIONS.pop(oldest, None)
            
            SSE_CONNECTIONS[login] = user_queue
        
        try:
            yield f"data: {json.dumps({'type': 'connected', 'timestamp': time.time()})}\n\n"
            
            while True:
                try:
                    notification = user_queue.get(timeout=30)
                    yield f"data: {json.dumps(notification)}\n\n"
                except queue.Empty:
                    yield ":keepalive\n\n"
        except GeneratorExit:
            logger.info(f"SSE соединение закрыто для {login}")
        finally:
            with SSE_LOCK:
                if login in SSE_CONNECTIONS:
                    del SSE_CONNECTIONS[login]
    
    return Response(
        event_stream(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )

@app.route('/online')
@rate_limit
def get_online_users():
    """Список онлайн пользователей"""
    current_time = time.time()
    
    with threading.RLock():
        active_users = []
        for user in ONLINE_USERS:
            last_active = USER_LAST_ACTIVE.get(user, 0)
            if current_time - last_active <= INACTIVITY_TIMEOUT:
                active_users.append(user)
        
        users = sorted(active_users)
    
    return jsonify(users=users, count=len(users), timestamp=current_time)

@app.route('/heartbeat', methods=['POST'])
@rate_limit
def heartbeat_ping():
    """Сердцебиение с проверкой активности"""
    try:
        data = request.get_json() or {}
        login = data.get('login', '').strip()
        
        if not login:
            return jsonify({'error': 'Требуется логин'}), 400
        
        now = time.time()
        
        with threading.RLock():
            if login not in ONLINE_USERS:
                # Проверяем, не был ли он отключен недавно
                last_active = USER_LAST_ACTIVE.get(login, 0)
                if now - last_active < 30:  # 30 секунд - окно для восстановления
                    ONLINE_USERS.add(login)
                else:
                    return jsonify({
                        'status': 'error', 
                        'message': 'Сессия истекла. Пожалуйста, войдите заново.',
                        'requires_relogin': True
                    }), 401
            
            # Обновляем время активности
            USER_LAST_ACTIVE[login] = now
            
            # Обновляем сессию в БД
            conn = None
            try:
                conn = get_db_connection()
                if conn:
                    c = conn.cursor()
                    ip_address = request.remote_addr
                    user_agent = request.headers.get('User-Agent', '')
                    
                    # Обновляем сессию
                    c.execute('''
                        UPDATE user_sessions 
                        SET last_activity = ?, ip_address = ?, user_agent = ?
                        WHERE login = ?
                    ''', (now, ip_address, user_agent, login))
                    
                    # Если сессии нет - создаем (на случай восстановления)
                    if c.rowcount == 0:
                        session_id = str(uuid.uuid4())
                        c.execute('''
                            INSERT INTO user_sessions 
                            (session_id, login, ip_address, user_agent, last_activity)
                            VALUES (?, ?, ?, ?, ?)
                        ''', (session_id, login, ip_address, user_agent, now))
                    
                    # Обновляем пользователя
                    c.execute('''
                        UPDATE users 
                        SET last_heartbeat = ?, ip_address = ?, user_agent = ?
                        WHERE login = ?
                    ''', (now, ip_address, user_agent, login))
                    
                    conn.commit()
            except Exception as e:
                logger.error(f"Ошибка обновления heartbeat: {e}")
            finally:
                if conn:
                    conn.close()
            
            return jsonify({
                'status': 'ok', 
                'timestamp': now,
                'online': True,
                'inactivity_timeout': INACTIVITY_TIMEOUT,
                'inactivity_minutes': INACTIVITY_TIMEOUT // 60
            })
                
    except Exception as e:
        logger.error(f"Ошибка heartbeat: {e}")
        return jsonify({'status': 'error'}), 500

# ===== ОБРАБОТЧИКИ ОШИБОК =====
@app.errorhandler(404)
def not_found_error(error):
    return jsonify({'error': 'Ресурс не найден'}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Внутренняя ошибка сервера: {error}", exc_info=True)
    return jsonify({'error': 'Внутренняя ошибка сервера'}), 500

@app.errorhandler(429)
def rate_limit_error(error):
    return jsonify({'error': 'Слишком много запросов. Подождите немного.'}), 429

@app.errorhandler(413)
def request_too_large(error):
    return jsonify({'error': 'Файл слишком большой'}), 413

@app.errorhandler(Exception)
def handle_unexpected_error(error):
    """Глобальный обработчик непредвиденных ошибок"""
    logger.critical(f"Непредвиденная ошибка: {error}", exc_info=True)
    
    return jsonify({
        'error': 'Внутренняя ошибка сервера',
        'request_id': str(uuid.uuid4()),
        'timestamp': time.time()
    }), 500

# ===== ЗАПУСК СЕРВЕРА =====
if __name__ == '__main__':
    try:
        init_db()
        logger.info(f"🔥 CloudChat v12.1 запущен успешно (таймаут неактивности: {INACTIVITY_TIMEOUT//60} мин)")
        logger.info(f"🔥 Поддержка фильтров по полу и возрасту активна")
        logger.info(f"🔥 Сервис сопоставления пользователей запущен")
    except Exception as e:
        logger.error(f"Ошибка запуска сервера: {e}")
    
    app.run(
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 5000)),
        debug=False,
        threaded=True,
        use_reloader=False
    )
