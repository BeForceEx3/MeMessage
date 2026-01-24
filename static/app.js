class CloudAnonChat {
    constructor() {
        this.userId = this.generateUserId();
        this.socket = io();
        this.currentChatId = null;
        this.partnerInfo = null;
        this.messages = [];
        this.lastMessageId = null;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        
        this.initElements();
        this.bindEvents();
        this.initSocket();
        this.showProfileScreen();
    }

    generateUserId() {
        return 'user_' + Math.random().toString(36).substr(2, 9);
    }

    initElements() {
        this.profileScreen = document.getElementById('profile-screen');
        this.filterScreen = document.getElementById('filter-screen');
        this.chatScreen = document.getElementById('chat-screen');
        this.usernameInput = document.getElementById('username');
        this.ageInput = document.getElementById('age');
        this.nextBtn = document.getElementById('next-step');
        this.backProfileBtn = document.getElementById('back-profile');
        this.findMatchBtn = document.getElementById('find-match');
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.messagesContainer = document.getElementById('messages-container');
        this.endChatBtn = document.getElementById('end-chat');
        this.newChatBtn = document.getElementById('new-chat');
        this.partnerInfo = document.getElementById('partner-info');
        this.voiceRecord = document.getElementById('voice-record');
    }

    bindEvents() {
        this.nextBtn.onclick = () => this.showFilterScreen();
        this.backProfileBtn.onclick = () => this.showProfileScreen();
        this.findMatchBtn.onclick = () => this.findMatch();
        this.sendBtn.onclick = () => this.sendMessage();
        this.messageInput.onkeypress = (e) => {
            if (e.key === 'Enter') this.sendMessage();
        };
        this.endChatBtn.onclick = () => this.endChat();
        this.newChatBtn.onclick = () => this.startNewChat();
        this.voiceRecord.onclick = () => this.toggleVoiceRecord();
        
        // Infinite scroll
        this.messagesContainer.onscroll = () => this.handleScroll();
    }

    initSocket() {
        this.socket.on('connect', () => console.log('WebSocket подключен'));
        
        this.socket.on('status', (data) => {
            console.log(data.msg);
        });

        this.socket.on('message', (data) => {
            this.addMessage(data, false);
        });

        this.socket.on('messages_loaded', (data) => {
            data.messages.forEach(msg => this.addMessage(msg, msg.sender === this.userId));
        });

        this.socket.on('chat_ended', (data) => {
            this.showChatEnded();
        });
    }

    showProfileScreen() {
        this.hideAllScreens();
        this.profileScreen.classList.add('active');
    }

    showFilterScreen() {
        if (!this.validateProfile()) return;
        this.hideAllScreens();
        this.filterScreen.classList.add('active');
    }

    showChatScreen(chatId, partner) {
        this.hideAllScreens();
        this.chatScreen.classList.add('active');
        this.currentChatId = chatId;
        this.partnerInfo.textContent = `Возраст: ${partner.age}, Пол: ${partner.gender === 'male' ? 'Мужчина' : 'Женщина'}`;
        this.socket.emit('join_chat', { chat_id: chatId });
        this.loadMessages();
    }

    showChatEnded() {
        this.partnerInfo.textContent = 'Диалог завершен';
        this.endChatBtn.style.display = 'none';
        this.newChatBtn.style.display = 'inline-block';
        this.currentChatId = null;
    }

    hideAllScreens() {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
    }

    validateProfile() {
        const name = this.usernameInput.value.trim();
        const age = parseInt(this.ageInput.value);
        
        if (!name || name.length < 2) {
            alert('Введите имя (минимум 2 символа)');
            return false;
        }
        if (!age || age < 12 || age > 80) {
            alert('Введите корректный возраст (12-80)');
            return false;
        }
        return true;
    }

    async findMatch() {
        const profile = {
            user_id: this.userId,
            name: this.usernameInput.value.trim(),
            age: parseInt(this.ageInput.value),
            gender: document.querySelector('input[name="gender"]:checked').value,
            search_gender: document.querySelector('input[name="search_gender"]:checked').value,
            age_range: document.querySelector('input[name="age_range"]:checked').value
        };

        this.findMatchBtn.textContent = 'Ищем...';
        this.findMatchBtn.disabled = true;

        try {
            const response = await fetch('/api/find_match', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(profile)
            });

            const result = await response.json();
            
            if (result.success) {
                this.showChatScreen(result.chat_id, result.partner);
            } else {
                this.partnerInfo.textContent = 'Ожидаем собеседника...';
                setTimeout(() => this.findMatch(), 3000); // Повторный поиск
            }
        } catch (error) {
            console.error('Ошибка поиска:', error);
            alert('Ошибка подключения');
        } finally {
            this.findMatchBtn.textContent = '🔍 Найти собеседника';
            this.findMatchBtn.disabled = false;
        }
    }

    sendMessage() {
        const text = this.messageInput.value.trim();
        if (!text || !this.currentChatId) return;

        const message = {
            chat_id: this.currentChatId,
            sender_id: this.userId,
            content: text,
            type: 'text'
        };

        this.socket.emit('message', message);
        this.messageInput.value = '';
        this.addMessage(message, true);
    }

    async toggleVoiceRecord() {
        if (!this.currentChatId) return;

        if (!this.isRecording) {
            await this.startRecording();
        } else {
            this.stopRecording();
        }
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            this.startTime = Date.now();

            this.mediaRecorder.ondataavailable = (e) => {
                this.audioChunks.push(e.data);
            };

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                const reader = new FileReader();
                reader.onload = () => {
                    const base64Audio = reader.result.split(',')[1];
                    const message = {
                        chat_id: this.currentChatId,
                        sender_id: this.userId,
                        content: base64Audio,
                        type: 'voice'
                    };
                    this.socket.emit('message', message);
                    this.addMessage(message, true);
                };
                reader.readAsDataURL(audioBlob);
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.voiceRecord.classList.add('active');
            this.updateVoiceTimer();
        } catch (err) {
            console.error('Ошибка записи:', err);
            alert('Не удалось начать запись');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        this.isRecording = false;
        this.voiceRecord.classList.remove('active');
    }

    updateVoiceTimer() {
        if (!this.isRecording) return;
        
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        document.getElementById('voice-timer').textContent = 
            `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        setTimeout(() => this.updateVoiceTimer(), 100);
    }

    addMessage(data, isSent) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        
        if (data.type === 'voice') {
            messageDiv.innerHTML = `
                <div class="message-bubble voice-message" onclick="chat.playVoice(this)">
                    🎤 Голосовое (${Math.floor(data.content.length/1000)}с)
                </div>
                <div class="message-time">${new Date().toLocaleTimeString()}</div>
                <div style="display:none" class="voice-data">${data.content}</div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-bubble">${this.escapeHtml(data.content)}</div>
                <div class="message-time">${new Date().toLocaleTimeString()}</div>
            `;
        }
        
        this.messagesContainer.appendChild(messageDiv);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        this.lastMessageId = data.id;
    }

    loadMessages() {
        this.socket.emit('load_messages', {
            chat_id: this.currentChatId,
            last_id: this.lastMessageId
        });
    }

    handleScroll() {
        if (this.messagesContainer.scrollTop === 0 && this.currentChatId) {
            this.loadMoreMessages();
        }
    }

    loadMoreMessages() {
        this.socket.emit('load_messages', {
            chat_id: this.currentChatId,
            last_id: this.lastMessageId
        });
    }

    endChat() {
        if (this.currentChatId) {
            this.socket.emit('end_chat', { chat_id: this.currentChatId });
        }
    }

    startNewChat() {
        this.showProfileScreen();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    playVoice(element) {
        const audioData = element.nextElementSibling.nextElementSibling.textContent;
        const audio = new Audio(`data:audio/wav;base64,${audioData}`);
        audio.play();
    }
}

// Запуск приложения
const chat = new CloudAnonChat();
