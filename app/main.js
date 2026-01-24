import { initializeApp } from './auth.js';
import { initializeChat } from './chat.js';
import { initializeUI } from './ui.js';
import { initializeMedia } from './media.js';
import { updateStats, debounce } from './utils.js';

class MeMessageApp {
    constructor() {
        this.socket = null;
        this.user = null;
        this.partner = null;
        this.roomId = null;
        this.messages = [];
        this.isConnected = false;
        
        this.init();
    }

    async init() {
        // Инициализация UI
        initializeUI(this);
        
        // Инициализация аутентификации
        initializeApp(this);
        
        // Инициализация чата
        initializeChat(this);
        
        // Инициализация медиа
        initializeMedia(this);
        
        // Загрузка статистики
        this.loadStats();
        
        // Скрытие экрана загрузки
        setTimeout(() => {
            document.getElementById('loading-screen').classList.remove('active');
            document.getElementById('auth-screen').classList.add('active');
        }, 1000);
    }

    connectSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        
        this.socket = io(`${protocol}//${host}`, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        this.setupSocketListeners();
    }

    setupSocketListeners() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.isConnected = true;
        });

        this.socket.on('registered', () => {
            console.log('User registered');
            document.getElementById('filter-screen').classList.add('active');
            document.getElementById('auth-screen').classList.remove('active');
        });

        this.socket.on('searching', (data) => {
            console.log('Searching for partner:', data);
            document.getElementById('search-screen').classList.add('active');
            document.getElementById('filter-screen').classList.remove('active');
        });

        this.socket.on('partner_found', (data) => {
            console.log('Partner found:', data);
            this.partner = data.partner;
            this.roomId = data.roomId;
            
            document.getElementById('chat-screen').classList.add('active');
            document.getElementById('search-screen').classList.remove('active');
            
            // Обновляем информацию о собеседнике
            document.getElementById('partner-name').textContent = this.partner.name;
            document.getElementById('partner-status').textContent = 'online';
            
            // Воспроизводим звук уведомления
            const notificationSound = document.getElementById('notification-sound');
            notificationSound.currentTime = 0;
            notificationSound.play().catch(console.error);
        });

        this.socket.on('new_message', (message) => {
            this.addMessage(message, 'received');
            
            // Воспроизводим звук сообщения
            const messageSound = document.getElementById('message-sound');
            messageSound.currentTime = 0;
            messageSound.play().catch(console.error);
        });

        this.socket.on('new_audio', (audioData) => {
            this.addAudioMessage(audioData, 'received');
            
            const messageSound = document.getElementById('message-sound');
            messageSound.currentTime = 0;
            messageSound.play().catch(console.error);
        });

        this.socket.on('partner_typing', ({ isTyping }) => {
            const indicator = document.getElementById('typing-indicator');
            if (isTyping) {
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }
        });

        this.socket.on('chat_ended', (data) => {
            alert(data.message);
            this.endChat();
        });

        this.socket.on('partner_disconnected', () => {
            alert('Собеседник отключился');
            this.endChat();
        });

        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            alert(`Ошибка: ${error.message}`);
        });

        this.socket.on('disconnect', () => {
            this.isConnected = false;
            console.log('Disconnected from server');
        });
    }

    addMessage(messageData, type) {
        const message = {
            id: messageData.id,
            type: 'text',
            content: messageData.message,
            timestamp: messageData.timestamp,
            senderType: type
        };
        
        this.messages.push(message);
        this.renderMessage(message);
        
        // Виртуализация: ограничиваем количество DOM элементов
        this.virtualizeMessages();
    }

    addAudioMessage(audioData, type) {
        const message = {
            id: audioData.id,
            type: 'audio',
            audioData: audioData.audioData,
            duration: audioData.duration,
            timestamp: audioData.timestamp,
            senderType: type
        };
        
        this.messages.push(message);
        this.renderAudioMessage(message);
        this.virtualizeMessages();
    }

    renderMessage(message) {
        const messagesList = document.getElementById('messages-list');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.senderType}`;
        messageElement.dataset.id = message.id;
        
        const time = new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        messageElement.innerHTML = `
            <div class="message-content">${this.escapeHtml(message.content)}</div>
            <div class="message-time">${time}</div>
        `;
        
        messagesList.appendChild(messageElement);
        this.scrollToBottom();
    }

    renderAudioMessage(message) {
        const messagesList = document.getElementById('messages-list');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.senderType}`;
        messageElement.dataset.id = message.id;
        
        const time = new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        messageElement.innerHTML = `
            <div class="audio-message">
                <button class="play-btn" onclick="app.playAudio('${message.id}')">
                    <i class="fas fa-play"></i>
                </button>
                <div class="audio-player">
                    <div class="audio-duration">${this.formatDuration(message.duration)}</div>
                </div>
            </div>
            <div class="message-time">${time}</div>
        `;
        
        // Сохраняем аудио данные
        messageElement.dataset.audio = message.audioData;
        
        messagesList.appendChild(messageElement);
        this.scrollToBottom();
    }

    playAudio(messageId) {
        const messageElement = document.querySelector(`[data-id="${messageId}"]`);
        if (!messageElement) return;
        
        const audioData = messageElement.dataset.audio;
        const audioBlob = this.base64ToBlob(audioData, 'audio/webm');
        const audioUrl = URL.createObjectURL(audioBlob);
        
        const audio = new Audio(audioUrl);
        audio.play().catch(console.error);
    }

    base64ToBlob(base64, contentType) {
        const byteCharacters = atob(base64.split(',')[1]);
        const byteNumbers = new Array(byteCharacters.length);
        
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: contentType });
    }

    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    virtualizeMessages() {
        const messagesList = document.getElementById('messages-list');
        const messages = messagesList.children;
        
        // Если сообщений больше 100, удаляем старые
        if (messages.length > 100) {
            const toRemove = messages.length - 100;
            for (let i = 0; i < toRemove; i++) {
                messagesList.removeChild(messages[0]);
            }
        }
    }

    scrollToBottom() {
        const container = document.getElementById('messages-container');
        container.scrollTop = container.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    endChat() {
        if (this.roomId) {
            this.socket.emit('end_chat', { roomId: this.roomId });
        }
        
        this.partner = null;
        this.roomId = null;
        this.messages = [];
        
        // Очищаем список сообщений
        document.getElementById('messages-list').innerHTML = '';
        
        document.getElementById('filter-screen').classList.add('active');
        document.getElementById('chat-screen').classList.remove('active');
    }

    async loadStats() {
        try {
            const response = await fetch('/api/stats');
            const data = await response.json();
            updateStats(data.online, data.chatting);
        } catch (error) {
            console.error('Error loading stats:', error);
        }
        
        // Обновляем статистику каждые 30 секунд
        setTimeout(() => this.loadStats(), 30000);
    }
}

// Инициализация приложения
window.app = new MeMessageApp();
export default window.app;
