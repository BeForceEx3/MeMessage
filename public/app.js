// MeMessage App - Все в одном файле для простоты развертывания

class MeMessageApp {
    constructor() {
        this.socket = null;
        this.user = null;
        this.partner = null;
        this.roomId = null;
        this.messages = [];
        this.isConnected = false;
        this.isRecording = false;
        this.mediaRecorder = null;
        
        this.init();
    }

    init() {
        console.log('MeMessage App initializing...');
        
        // Инициализация событий
        this.initEvents();
        
        // Подключение к серверу (позже, после регистрации)
        
        // Скрытие экрана загрузки через 1.5 секунды
        setTimeout(() => {
            this.showScreen('auth-screen');
            this.loadStats();
        }, 1500);
        
        // Обновление статистики каждые 30 секунд
        setInterval(() => this.loadStats(), 30000);
    }

    initEvents() {
        // Регистрация
        document.getElementById('auth-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.registerUser();
        });

        // Назад к регистрации
        document.getElementById('back-to-auth').addEventListener('click', () => {
            this.showScreen('auth-screen');
        });

        // Поиск собеседника
        document.getElementById('filter-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.findPartner();
        });

        // Отмена поиска
        document.getElementById('cancel-search').addEventListener('click', () => {
            this.showScreen('filter-screen');
        });

        // Отправка сообщения
        document.getElementById('send-message').addEventListener('click', () => {
            this.sendMessage();
        });

        // Отправка по Enter
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Завершение чата
        document.getElementById('end-chat').addEventListener('click', () => {
            if (confirm('Завершить диалог?')) {
                this.endChat();
            }
        });

        // Голосовые сообщения
        document.getElementById('record-audio').addEventListener('click', () => {
            this.startRecording();
        });

        document.getElementById('stop-recording').addEventListener('click', () => {
            this.stopRecording();
        });

        // Отслеживание длины сообщения
        document.getElementById('message-input').addEventListener('input', (e) => {
            const length = e.target.value.length;
            document.getElementById('message-length').textContent = `${length}/500`;
            
            if (length > 500) {
                document.getElementById('message-length').style.color = '#ef4444';
            } else {
                document.getElementById('message-length').style.color = '#cbd5e1';
            }
            
            // Индикатор набора
            if (this.roomId && this.socket) {
                this.socket.emit('typing', {
                    roomId: this.roomId,
                    isTyping: true
                });
                
                clearTimeout(this.typingTimeout);
                this.typingTimeout = setTimeout(() => {
                    if (this.roomId && this.socket) {
                        this.socket.emit('typing', {
                            roomId: this.roomId,
                            isTyping: false
                        });
                    }
                }, 1000);
            }
        });
    }

    showScreen(screenId) {
        // Скрыть все экраны
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        // Показать нужный экран
        document.getElementById(screenId).classList.add('active');
    }

    registerUser() {
        const name = document.getElementById('name').value.trim();
        const age = parseInt(document.getElementById('age').value);
        const gender = document.querySelector('input[name="gender"]:checked').value;

        if (!name || !age || !gender) {
            alert('Пожалуйста, заполните все поля');
            return;
        }

        if (age < 12 || age > 100) {
            alert('Возраст должен быть от 12 до 100 лет');
            return;
        }

        this.user = { name, age, gender };
        this.connectSocket();
        
        // Переход к фильтрам
        this.showScreen('filter-screen');
    }

    connectSocket() {
        // Автоматическое определение хоста
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        
        this.socket = io(`${protocol}//${host}`, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.isConnected = true;
            
            // Регистрация пользователя на сервере
            this.socket.emit('register', this.user);
        });

        this.socket.on('registered', () => {
            console.log('User registered successfully');
        });

        this.socket.on('searching', (data) => {
            console.log('Searching for partner...');
            this.showScreen('search-screen');
            
            // Запуск таймера поиска
            this.startSearchTimer();
        });

        this.socket.on('partner_found', (data) => {
            console.log('Partner found!', data);
            this.partner = data.partner;
            this.roomId = data.roomId;
            
            this.showScreen('chat-screen');
            document.getElementById('partner-name').textContent = this.partner.name || 'Собеседник';
            
            // Остановка таймера поиска
            this.stopSearchTimer();
            
            // Воспроизведение звука
            this.playNotificationSound();
        });

        this.socket.on('new_message', (message) => {
            this.addMessage(message, 'received');
            this.playMessageSound();
        });

        this.socket.on('new_audio', (audioData) => {
            this.addAudioMessage(audioData, 'received');
            this.playMessageSound();
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

    findPartner() {
        const targetGender = document.querySelector('input[name="target-gender"]:checked').value;
        const ageGroup = document.querySelector('input[name="age-group"]:checked').value;

        if (this.socket && this.isConnected) {
            this.socket.emit('find_partner', {
                targetGender,
                ageGroup
            });
        } else {
            alert('Нет соединения с сервером');
        }
    }

    startSearchTimer() {
        this.searchStartTime = Date.now();
        this.searchInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.searchStartTime) / 1000);
            document.getElementById('search-time').textContent = elapsed;
            
            // Обновляем счетчик проверенных профилей
            const checked = document.getElementById('profiles-checked');
            let current = parseInt(checked.textContent) || 0;
            checked.textContent = current + Math.floor(Math.random() * 3) + 1;
        }, 1000);
    }

    stopSearchTimer() {
        if (this.searchInterval) {
            clearInterval(this.searchInterval);
            this.searchInterval = null;
        }
    }

    sendMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();
        
        if (!message || !this.roomId || !this.socket) return;

        const timestamp = Date.now();
        
        this.socket.emit('send_message', {
            roomId: this.roomId,
            message,
            timestamp
        });

        // Добавляем сообщение локально
        this.addMessage({
            id: 'temp_' + Date.now(),
            message,
            timestamp,
            type: 'text'
        }, 'sent');

        // Очищаем поле ввода
        input.value = '';
        document.getElementById('message-length').textContent = '0/500';
    }

    addMessage(messageData, type) {
        const messagesList = document.getElementById('messages-list');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.dataset.id = messageData.id;
        
        const time = new Date(messageData.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        messageElement.innerHTML = `
            <div class="message-content">${this.escapeHtml(messageData.message)}</div>
            <div class="message-time">${time}</div>
        `;
        
        messagesList.appendChild(messageElement);
        this.scrollToBottom();
    }

    addAudioMessage(audioData, type) {
        const messagesList = document.getElementById('messages-list');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.dataset.id = audioData.id;
        messageElement.dataset.audio = audioData.audioData;
        
        const time = new Date(audioData.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const duration = this.formatDuration(audioData.duration || 0);
        
        messageElement.innerHTML = `
            <div class="audio-message">
                <button class="play-btn" onclick="app.playAudio('${audioData.id}')">
                    <i class="fas fa-play"></i>
                </button>
                <div class="audio-player">
                    <div class="audio-duration">${duration}</div>
                </div>
            </div>
            <div class="message-time">${time}</div>
        `;
        
        messagesList.appendChild(messageElement);
        this.scrollToBottom();
    }

    playAudio(messageId) {
        const messageElement = document.querySelector(`[data-id="${messageId}"]`);
        if (!messageElement) return;
        
        const audioData = messageElement.dataset.audio;
        const audioBlob = this.base64ToBlob(audioData);
        const audioUrl = URL.createObjectURL(audioBlob);
        
        const audio = new Audio(audioUrl);
        audio.play().catch(console.error);
    }

    base64ToBlob(base64) {
        const parts = base64.split(';base64,');
        const contentType = parts[0].split(':')[1];
        const raw = window.atob(parts[1]);
        const rawLength = raw.length;
        const uInt8Array = new Uint8Array(rawLength);

        for (let i = 0; i < rawLength; ++i) {
            uInt8Array[i] = raw.charCodeAt(i);
        }

        return new Blob([uInt8Array], { type: contentType });
    }

    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: true 
            });
            
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.sendAudioMessage(audioBlob);
                stream.getTracks().forEach(track => track.stop());
            };
            
            this.mediaRecorder.start();
            this.isRecording = true;
            
            // Показываем индикатор записи
            document.getElementById('recording-indicator').style.display = 'flex';
            document.getElementById('record-audio').style.display = 'none';
            
            // Запускаем таймер
            this.recordingStartTime = Date.now();
            this.updateRecordingTimer();
            this.recordingTimerInterval = setInterval(() => this.updateRecordingTimer(), 1000);
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Не удалось получить доступ к микрофону');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            
            // Скрываем индикатор
            document.getElementById('recording-indicator').style.display = 'none';
            document.getElementById('record-audio').style.display = 'flex';
            
            // Очищаем таймер
            clearInterval(this.recordingTimerInterval);
            document.getElementById('recording-timer').textContent = '0:00';
        }
    }

    updateRecordingTimer() {
        const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        document.getElementById('recording-timer').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        
        // Автоматическое завершение через 2 минуты
        if (elapsed >= 120) {
            this.stopRecording();
        }
    }

    sendAudioMessage(audioBlob) {
        if (!this.roomId || !this.socket) return;
        
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        
        reader.onloadend = () => {
            const base64Audio = reader.result;
            const duration = (Date.now() - this.recordingStartTime) / 1000;
            
            // Добавляем локально
            this.addAudioMessage({
                id: 'temp_audio_' + Date.now(),
                audioData: base64Audio,
                duration,
                timestamp: Date.now()
            }, 'sent');
            
            // Отправляем на сервер
            this.socket.emit('send_audio', {
                roomId: this.roomId,
                audioData: base64Audio,
                duration,
                timestamp: Date.now()
            });
        };
    }

    endChat() {
        if (this.roomId && this.socket) {
            this.socket.emit('end_chat', { roomId: this.roomId });
        }
        
        this.partner = null;
        this.roomId = null;
        this.messages = [];
        
        // Очищаем список сообщений
        document.getElementById('messages-list').innerHTML = '';
        
        this.showScreen('filter-screen');
        
        // Останавливаем запись если активна
        if (this.isRecording) {
            this.stopRecording();
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

    playMessageSound() {
        const sound = document.getElementById('message-sound');
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(() => {}); // Игнорируем ошибки воспроизведения
        }
    }

    playNotificationSound() {
        const sound = document.getElementById('notification-sound');
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(() => {});
        }
    }

    async loadStats() {
        try {
            const response = await fetch('/api/stats');
            const data = await response.json();
            
            document.getElementById('online-count').textContent = data.online || 0;
            document.getElementById('chatting-count').textContent = data.chatting || 0;
            
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }
}

// Инициализация приложения при загрузке страницы
window.addEventListener('DOMContentLoaded', () => {
    window.app = new MeMessageApp();
});
