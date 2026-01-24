class CloudAnonChat {
    constructor() {
        this.socket = io();
        this.userId = null;
        this.currentChatId = null;
        this.messages = [];
        this.loadedMessages = 0;
        this.isRecording = false;
        this.mediaRecorder = null;

        this.initElements();
        this.bindEvents();
        this.socketEvents();
    }

    initElements() {
        this.screens = {
            profile: document.getElementById('profileScreen'),
            search: document.getElementById('searchScreen'),
            chat: document.getElementById('chatScreen')
        };

        this.elements = {
            nameInput: document.getElementById('nameInput'),
            ageInput: document.getElementById('ageInput'),
            genderBtns: document.querySelectorAll('.gender-btn'),
            nextBtn: document.getElementById('nextBtn'),
            filterBtns: document.querySelectorAll('.filter-btn'),
            backBtn: document.getElementById('backBtn'),
            messagesContainer: document.getElementById('messagesContainer'),
            messageInput: document.getElementById('messageInput'),
            sendBtn: document.getElementById('sendBtn'),
            voiceBtn: document.getElementById('voiceBtn'),
            endChatBtn: document.getElementById('endChatBtn'),
            partnerName: document.getElementById('partnerName'),
            partnerAge: document.getElementById('partnerAge'),
            partnerGender: document.getElementById('partnerGender')
        };
    }

    bindEvents() {
        // Профиль
        this.elements.genderBtns.forEach(btn => {
            btn.addEventListener('click', () => this.selectGender(btn));
        });
        
        this.elements.nameInput.addEventListener('input', () => this.validateProfile());
        this.elements.ageInput.addEventListener('input', () => this.validateProfile());
        this.elements.nextBtn.addEventListener('click', () => this.nextStep());

        // Поиск
        this.elements.filterBtns.forEach(btn => {
            btn.addEventListener('click', () => this.startSearch(btn.dataset.filter));
        });
        this.elements.backBtn.addEventListener('click', () => this.showProfile());

        // Чат
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        this.elements.voiceBtn.addEventListener('click', () => this.toggleVoice());
        this.elements.endChatBtn.addEventListener('click', () => this.endChat());

        // Infinite scroll
        this.elements.messagesContainer.addEventListener('scroll', () => {
            this.handleScroll();
        });
    }

    socketEvents() {
        this.socket.on('registered', (data) => {
            this.userId = data.userId;
        });

        this.socket.on('matched', (data) => {
            this.currentChatId = data.chatId;
            this.partner = data.partner;
            this.updatePartnerInfo();
            this.showChat();
            this.loadMessages();
        });

        this.socket.on('message', (message) => {
            this.messages.unshift(message);
            this.renderMessage(message);
            this.scrollToBottom();
        });

        this.socket.on('chatEnded', () => {
            this.showSearch();
        });
    }

    selectGender(btn) {
        this.elements.genderBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.gender = btn.dataset.gender;
        this.validateProfile();
    }

    validateProfile() {
        const name = this.elements.nameInput.value.trim();
        const age = parseInt(this.elements.ageInput.value);
        const valid = name && age >= 12 && age <= 100 && this.gender;
        
        this.elements.nextBtn.disabled = !valid;
    }

    nextStep() {
        const userData = {
            name: this.elements.nameInput.value.trim(),
            age: parseInt(this.elements.ageInput.value),
            gender: this.gender
        };

        this.socket.emit('register', userData);
        this.showSearch();
    }

    startSearch(filter) {
        this.socket.emit('search', filter);
        this.elements.messagesContainer.innerHTML = '<div class="loading">Ищем собеседника...</div>';
        this.showChat();
    }

    showScreen(screenName) {
        Object.values(this.screens).forEach(screen => {
            screen.classList.remove('active');
        });
        this.screens[screenName].classList.add('active');
    }

    showProfile() { this.showScreen('profile'); }
    showSearch() { this.showScreen('search'); }
    showChat() { this.showScreen('chat'); }

    updatePartnerInfo() {
        this.elements.partnerName.textContent = this.partner.name;
        this.elements.partnerAge.textContent = this.partner.age;
        if (this.partner.gender === 'male') {
            this.elements.partnerGender.textContent = 'М';
            this.elements.partnerGender.style.color = '#2196F3';
        } else {
            this.elements.partnerGender.textContent = 'Ж';
            this.elements.partnerGender.style.color = '#E91E63';
        }
    }

    async sendMessage() {
        const text = this.elements.messageInput.value.trim();
        if (!text) return;

        const message = { userId: this.userId, text };
        this.socket.emit('message', message);
        
        this.elements.messageInput.value = '';
    }

    async toggleVoice() {
        if (!this.isRecording) {
            await this.startRecording();
        } else {
            await this.stopRecording();
        }
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.recordedChunks = [];

            this.mediaRecorder.ondataavailable = (e) => {
                this.recordedChunks.push(e.data);
            };

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                this.uploadMedia(audioBlob, 'voice');
                stream.getTracks().forEach(track => track.stop());
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.elements.voiceBtn.textContent = '⏹️';
            this.elements.voiceBtn.style.background = '#ff4444';
        } catch (err) {
            console.error('Ошибка записи:', err);
        }
    }

    async stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.elements.voiceBtn.textContent = '🎤';
            this.elements.voiceBtn.style.background = '#ffeb3b';
        }
    }

    async uploadMedia(blob, type) {
        const formData = new FormData();
        const mediaId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        formData.append('media', blob, mediaId + '.' + (type === 'voice' ? 'webm' : 'png'));
        formData.append('type', type);

        // Имитация загрузки на Render (создаем папку public/media)
        const message = { 
            userId: this.userId, 
            type, 
            mediaId,
            text: type === 'voice' ? '[голосовое]' : '[фото]'
        };
        this.socket.emit('message', message);
    }

    renderMessage(message) {
        const isOwn = message.senderId === this.userId;
        const div = document.createElement('div');
        div.className = `message ${isOwn ? 'own' : 'other'}`;
        div.dataset.messageId = message.id;

        if (message.type === 'voice') {
            div.innerHTML = `
                <div class="voice-message">
                    <div>🎤 ${message.text}</div>
                    <audio controls src="/media/${message.mediaId}.webm"></audio>
                </div>
            `;
        } else {
            div.innerHTML = `<div class="message-bubble">${message.text}</div>`;
        }

        this.elements.messagesContainer.insertBefore(div, this.elements.messagesContainer.firstChild);
    }

    loadMessages() {
        // Загружаем последние 20 сообщений
        this.loadedMessages = Math.min(20, this.messages.length);
        for (let i = 0; i < this.loadedMessages; i++) {
            this.renderMessage(this.messages[i]);
        }
    }

    handleScroll() {
        if (this.elements.messagesContainer.scrollTop === 0 && 
            this.loadedMessages < this.messages.length) {
            // Загружаем еще сообщения при скролле вверх
            const newMessages = Math.min(20, this.messages.length - this.loadedMessages);
            for (let i = this.loadedMessages; i < this.loadedMessages + newMessages; i++) {
                this.renderMessage(this.messages[i]);
            }
            this.loadedMessages += newMessages;
        }
    }

    scrollToBottom() {
        this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
    }

    endChat() {
        this.socket.emit('endChat');
        this.showSearch();
        this.currentChatId = null;
        this.messages = [];
        this.loadedMessages = 0;
    }
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
    new CloudAnonChat();
});
