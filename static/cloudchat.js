// static/cloudchat.js - CloudChat v12.1 (с фильтрами по полу и возрасту)
class CloudChat {
    constructor() {
        // Основные переменные
        this.login = null;
        this.chatId = null;
        this.partner = null;
        this.lastTs = 0;
        this.isRecording = false;
        this.isSending = false;
        this.connectionStatus = 'disconnected';
        this.theme = localStorage.getItem('chatTheme') || 'light';
        this.autoScrollEnabled = true;
        
        // Фильтры
        this.userGender = 'unknown';
        this.userAgeGroup = 'unknown';
        this.searchGender = 'any';
        this.searchAge = 'any';
        
        // Таймеры
        this.inactivityTimer = null;
        this.INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 минут
        
        // Оптимизированные структуры данных
        this.messageCache = new Map();
        this.activeMedia = new Map();
        this.pendingMessages = new Set();
        this.messageStatus = new Map();
        
        // Интервалы и соединения
        this.heartbeatInterval = null;
        this.sseConnection = null;
        this.recordingTimer = null;
        this.recordingTimerInterval = null;
        this.chatPollInterval = null;
        this.waitingCheckInterval = null;
        
        // Запись медиа
        this.mediaRecorder = null;
        this.mediaStream = null;
        this.mediaChunks = [];
        this.recordingType = null;
        this.recordingSeconds = 0;
        this.recordingMaxSeconds = 60;
        
        // DOM элементы
        this.elements = {};
        
        // Инициализация
        this.initElements();
        this.bindEvents();
        this.initTheme();
        this.initSounds();
        this.setupInactivityTracking();
        this.setupBrowserCloseHandler();
        this.showNickModal();
    }
    
    initElements() {
        this.elements = {
            // Модальное окно входа
            nickModal: document.getElementById('nick-modal'),
            nickInput: document.getElementById('nick-input'),
            joinBtn: document.getElementById('join-btn'),
            genderSelect: document.getElementById('gender-select'),
            ageSelect: document.getElementById('age-select'),
            searchGenderSelect: document.getElementById('search-gender-select'),
            searchAgeSelect: document.getElementById('search-age-select'),
            
            // Основной интерфейс
            main: document.getElementById('main'),
            chat: document.getElementById('chat'),
            msgInput: document.getElementById('msg-input'),
            
            // Кнопки действий
            mediaBtn: document.getElementById('media-btn'),
            voiceBtn: document.getElementById('voice-btn'),
            videoBtn: document.getElementById('video-btn'),
            sendBtn: document.getElementById('send-btn'),
            
            // Управление чатом
            themeToggleBtn: document.getElementById('theme-toggle'),
            settingsBtn: document.getElementById('settings-btn'),
            nextPartnerBtn: document.getElementById('next-partner-btn'),
            leaveChatBtn: document.getElementById('leave-chat-btn'),
            stopSearchBtn: document.createElement('button'), // Новая кнопка остановки поиска
            
            // Статус и информация
            chatStatusIndicator: document.getElementById('chat-status-indicator'),
            chatStatusText: document.querySelector('#chat-status-indicator .status-text'),
            chatStatusDot: document.querySelector('#chat-status-indicator .status-dot'),
            
            // Подключение
            connectionDot: document.getElementById('connection-dot'),
            connectionText: document.getElementById('connection-text'),
            
            // Счетчик символов
            charCounter: document.querySelector('.char-counter'),
            charCount: document.getElementById('char-count'),
            
            // Модальные окна
            fullscreenModal: document.getElementById('fullscreen-modal'),
            fullscreenImage: document.getElementById('fullscreen-image'),
            closeFullscreen: document.getElementById('close-fullscreen'),
            
            // Настройки
            settingsModal: document.getElementById('settings-modal'),
            settingsGenderSelect: document.getElementById('settings-gender-select'),
            settingsAgeSelect: document.getElementById('settings-age-select'),
            closeSettings: document.getElementById('close-settings'),
            saveSettings: document.getElementById('save-settings'),
            cancelSettings: document.getElementById('cancel-settings'),
            
            // Запись
            recordingPreview: document.getElementById('recording-preview'),
            recordingTypeText: document.getElementById('recording-type-text'),
            recordingTimer: document.getElementById('recording-timer'),
            cancelRecordingBtn: document.getElementById('cancel-recording-btn'),
            sendRecordingBtn: document.getElementById('send-recording-btn'),
            videoPreviewElement: document.getElementById('video-preview-element'),
            videoPreviewContainer: document.getElementById('video-preview-container'),
        };
        
        // Создаем кнопку остановки поиска
        this.createStopSearchButton();
    }

    createStopSearchButton() {
        const stopSearchBtn = document.createElement('button');
        stopSearchBtn.id = 'stop-search-btn';
        stopSearchBtn.className = 'theme-toggle-btn hidden';
        stopSearchBtn.title = 'Остановить поиск';
        stopSearchBtn.innerHTML = '⏹️';
        stopSearchBtn.style.marginRight = '8px';
        
        // Добавляем кнопку в header-right
        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
            headerRight.insertBefore(stopSearchBtn, headerRight.firstChild);
            this.elements.stopSearchBtn = stopSearchBtn;
        }
    }

    bindEvents() {
        // Модальное окно входа
        this.elements.joinBtn.onclick = () => this.joinChat();
        this.elements.nickInput.onkeydown = (e) => {
            if (e.key === 'Enter') this.joinChat();
        };
        
        // Поле ввода сообщений
        this.elements.msgInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        };
        
        this.elements.msgInput.oninput = () => this.debouncedUpdateCharCount();

        // Кнопки управления чатом
        this.elements.nextPartnerBtn.onclick = () => this.findPartner();
        this.elements.leaveChatBtn.onclick = () => this.leaveChat();
        if (this.elements.stopSearchBtn) {
            this.elements.stopSearchBtn.onclick = () => this.stopSearch();
        }
        
        // Кнопки медиа
        this.elements.mediaBtn.onclick = () => this.selectMedia();
        this.elements.voiceBtn.onclick = () => this.startRecording('voice');
        this.elements.videoBtn.onclick = () => this.startRecording('video');
        this.elements.sendBtn.onclick = () => this.sendMessage();

        // Тема
        if (this.elements.themeToggleBtn) {
            this.elements.themeToggleBtn.onclick = () => this.toggleTheme();
        }
        
        // Настройки
        if (this.elements.settingsBtn) {
            this.elements.settingsBtn.onclick = () => this.showSettings();
        }
        if (this.elements.closeSettings) {
            this.elements.closeSettings.onclick = () => this.hideSettings();
        }
        if (this.elements.saveSettings) {
            this.elements.saveSettings.onclick = () => this.saveSettings();
        }
        if (this.elements.cancelSettings) {
            this.elements.cancelSettings.onclick = () => this.hideSettings();
        }

        // Запись
        if (this.elements.cancelRecordingBtn) {
            this.elements.cancelRecordingBtn.onclick = () => this.cancelRecording();
        }
        if (this.elements.sendRecordingBtn) {
            this.elements.sendRecordingBtn.onclick = () => this.finishRecording();
        }

        // Полноэкранный просмотр
        if (this.elements.closeFullscreen) {
            this.elements.closeFullscreen.onclick = () => {
                this.elements.fullscreenModal.style.display = 'none';
            };
        }

        // Делегирование событий в чате
        this.elements.chat.addEventListener('click', (e) => this.handleChatClick(e));
        
        // Глобальные события
        window.addEventListener('beforeunload', () => this.handleBrowserClose());
        window.addEventListener('pagehide', () => this.handleBrowserClose());
        document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
        
        // Оптимизация скролла
        let scrollTimeout;
        this.elements.chat.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                this.throttledScrollHandler();
            }, 100);
        });
        
        // Инициализация звуков
        this.initSounds();
    }

    setupBrowserCloseHandler() {
        // Используем sendBeacon для гарантированной отправки при закрытии
        this.browserCloseHandler = () => {
            if (this.login) {
                const data = JSON.stringify({ nick: this.login });
                
                // Пробуем sendBeacon для быстрой отправки
                if (navigator.sendBeacon) {
                    navigator.sendBeacon('/force_logout', data);
                } else {
                    // Fallback для старых браузеров
                    fetch('/force_logout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: data,
                        keepalive: true // Важно для отправки при закрытии
                    }).catch(() => {});
                }
            }
        };
    }

    handleBrowserClose() {
        this.browserCloseHandler();
        this.cleanup();
    }

    async stopSearch() {
        if (!this.login) return;
        
        try {
            const response = await this.apiRequest('/stop_search', { login: this.login });
            
            if (response.success) {
                this.showToast('Поиск остановлен', 'success');
                
                // Останавливаем проверку очереди
                if (this.waitingCheckInterval) {
                    clearInterval(this.waitingCheckInterval);
                    this.waitingCheckInterval = null;
                }
                
                // Обновляем UI
                this.updateChatUI(false);
                this.elements.stopSearchBtn.classList.add('hidden');
                
                // Показываем приветственное сообщение
                this.showWelcomeMessage();
            }
        } catch (error) {
            console.error('Ошибка остановки поиска:', error);
            this.showToast('Ошибка остановки поиска', 'error');
        }
    }

    // ===== ВХОД И АВТОРИЗАЦИЯ =====
    
    showNickModal() {
        this.elements.nickModal.style.display = 'flex';
        this.elements.main.style.display = 'none';
        
        const savedNick = localStorage.getItem('chatNick');
        if (savedNick) {
            this.elements.nickInput.value = savedNick;
        }
        
        setTimeout(() => {
            this.elements.nickInput.focus();
            this.elements.nickInput.select();
        }, 100);
    }

    async joinChat() {
        const nick = this.elements.nickInput.value.trim();
        const gender = this.elements.genderSelect.value;
        const age = this.elements.ageSelect.value;
        const searchGender = this.elements.searchGenderSelect.value;
        const searchAge = this.elements.searchAgeSelect.value;
        
        if (nick.length < 3 || nick.length > 18) {
            this.showToast('Псевдоним: 3-18 символов', 'error');
            return;
        }
        
        if (!gender) {
            this.showToast('Укажите пол', 'error');
            return;
        }
        
        if (!age) {
            this.showToast('Укажите возраст', 'error');
            return;
        }

        try {
            // Проверка ника
            const checkRes = await this.apiRequest('/checknick', { nick });
            if (!checkRes.available) {
                this.showToast(checkRes.reason || 'Псевдоним недоступен', 'error');
                return;
            }

            // Вход в CloudChat с фильтрами
            const joinRes = await this.apiRequest('/join', { 
                nick, 
                gender,
                age,
                search_gender: searchGender,
                search_age: searchAge
            });
            
            if (!joinRes.success) {
                this.showToast(joinRes.reason || 'Ошибка входа', 'error');
                return;
            }

            this.login = nick;
            this.userGender = gender;
            this.userAgeGroup = this.getAgeGroup(parseInt(age));
            this.searchGender = searchGender;
            this.searchAge = searchAge;
            
            localStorage.setItem('chatNick', nick);
            localStorage.setItem('userGender', gender);
            localStorage.setItem('searchGender', searchGender);
            localStorage.setItem('searchAge', searchAge);
            
            // Обновление интерфейса
            this.elements.nickModal.style.display = 'none';
            this.elements.main.style.display = 'flex';
            
            // Обновляем статус подключения
            this.updateConnectionStatus('connected');
            
            if (joinRes.in_chat) {
                // Пользователь сразу попал в чат
                this.chatId = joinRes.chat_id;
                this.partner = joinRes.partner;
                this.updateChatUI(true);
                this.showToast(`Соединено с ${this.partner}`, 'success');
                this.startChatPolling();
            } else {
                // Пользователь в очереди ожидания
                this.updateChatUI(false);
                const position = joinRes.waiting_position || 1;
                this.showToast(`Ищем собеседника... Очередь: ${position}`, 'info');
                this.startWaitingForPartner();
            }
            
            // Запуск фоновых процессов
            this.startBackgroundProcesses();
            setTimeout(() => this.elements.msgInput.focus(), 200);
            
        } catch (error) {
            console.error('Ошибка входа:', error);
            this.showToast('Ошибка сервера', 'error');
            this.updateConnectionStatus('disconnected');
        }
    }
    
    this.userAgeGroup = age;  // Теперь age уже является возрастной группой

    // ===== НАСТРОЙКИ ФИЛЬТРОВ =====
    
    showSettings() {
        // Загружаем текущие настройки
        this.elements.settingsGenderSelect.value = this.searchGender;
        this.elements.settingsAgeSelect.value = this.searchAge;
        
        this.elements.settingsModal.style.display = 'flex';
    }
    
    hideSettings() {
        this.elements.settingsModal.style.display = 'none';
    }
    
    async saveSettings() {
        if (!this.login) return;
        
        const searchGender = this.elements.settingsGenderSelect.value;
        const searchAge = this.elements.settingsAgeSelect.value;
        
        try {
            const response = await this.apiRequest('/update_preferences', {
                login: this.login,
                search_gender: searchGender,
                search_age: searchAge
            });
            
            if (response.success) {
                this.searchGender = searchGender;
                this.searchAge = searchAge;
                
                localStorage.setItem('searchGender', searchGender);
                localStorage.setItem('searchAge', searchAge);
                
                this.showToast('Настройки сохранены', 'success');
                this.hideSettings();
                
                // Если пользователь в очереди, обновляем поиск
                if (!this.chatId) {
                    this.showToast('Настройки применятся при следующем поиске', 'info');
                }
            }
        } catch (error) {
            console.error('Ошибка сохранения настроек:', error);
            this.showToast('Ошибка сохранения настроек', 'error');
        }
    }

    // ===== УПРАВЛЕНИЕ ЧАТОМ =====
    
    async findPartner() {
        if (!this.login) return;
        
        try {
            // Выходим из текущего чата
            if (this.chatId) {
                await this.leaveChat();
                this.showToast('Покидаем чат...', 'info');
            }
            
            // Показываем индикатор поиска
            this.updateChatStatus('connecting', 'Поиск собеседника...');
            this.elements.nextPartnerBtn.disabled = true;
            
            const response = await this.apiRequest('/find_partner', { login: this.login });
            
            if (response.success) {
                this.chatId = response.chat_id;
                this.partner = response.partner;
                this.updateChatUI(true);
                this.showToast(`Соединено с ${this.partner}`, 'success');
                
                // Очищаем старые сообщения
                this.clearChat();
                this.startChatPolling();
                
                // Останавливаем проверку очереди и скрываем кнопку остановки
                if (this.waitingCheckInterval) {
                    clearInterval(this.waitingCheckInterval);
                    this.waitingCheckInterval = null;
                }
                this.elements.stopSearchBtn.classList.add('hidden');
            } else {
                if (response.waiting_position) {
                    // Пользователь в очереди
                    this.updateChatUI(false);
                    this.showToast(`Ищем собеседника... Позиция: ${response.waiting_position}`, 'info');
                    this.startWaitingForPartner();
                    
                    // Показываем кнопку остановки поиска
                    this.elements.stopSearchBtn.classList.remove('hidden');
                } else {
                    this.showToast(response.reason || 'Подходящий собеседник не найден', 'warning');
                    this.updateChatStatus('disconnected', 'Собеседник не найден');
                }
            }
        } catch (error) {
            console.error('Ошибка поиска:', error);
            this.showToast('Ошибка сервера', 'error');
        } finally {
            this.elements.nextPartnerBtn.disabled = false;
        }
    }
    
    async leaveChat() {
        if (!this.login || !this.chatId) return;
        
        try {
            const response = await this.apiRequest('/leave_chat', { login: this.login });
            
            if (response.success) {
                this.chatId = null;
                this.partner = null;
                this.updateChatUI(false);
                this.showToast('Вы вышли из чата', 'info');
                this.clearChat();
                
                // Останавливаем опрос чата
                if (this.chatPollInterval) {
                    clearInterval(this.chatPollInterval);
                    this.chatPollInterval = null;
                }
                
                // Останавливаем проверку очереди
                if (this.waitingCheckInterval) {
                    clearInterval(this.waitingCheckInterval);
                    this.waitingCheckInterval = null;
                }
                
                // Скрываем кнопку остановки поиска
                this.elements.stopSearchBtn.classList.add('hidden');
                
                // Показываем приветственное сообщение
                this.showWelcomeMessage();
            }
        } catch (error) {
            console.error('Ошибка выхода:', error);
        }
    }
    
    updateChatUI(inChat) {
        if (inChat && this.partner) {
            // Пользователь в чате
            this.updateChatStatus('online', `Собеседник найден`);
            this.elements.nextPartnerBtn.classList.remove('hidden');
            this.elements.leaveChatBtn.classList.remove('hidden');
            this.elements.msgInput.disabled = false;
            this.elements.msgInput.placeholder = `Сообщение...`;
            this.elements.sendBtn.style.display = 'flex';
            this.elements.mediaBtn.classList.remove('hidden');
            this.elements.voiceBtn.classList.remove('hidden');
            this.elements.videoBtn.classList.remove('hidden');
            this.elements.stopSearchBtn.classList.add('hidden');
        } else {
            // Пользователь не в чате
            this.updateChatStatus('connecting', 'Поиск собеседника...');
            this.elements.nextPartnerBtn.classList.add('hidden');
            this.elements.leaveChatBtn.classList.add('hidden');
            this.elements.msgInput.disabled = true;
            this.elements.msgInput.placeholder = 'Найдите собеседника...';
            this.elements.sendBtn.style.display = 'none';
            this.elements.mediaBtn.classList.add('hidden');
            this.elements.voiceBtn.classList.add('hidden');
            this.elements.videoBtn.classList.add('hidden');
        }
    }
    
    updateChatStatus(status, text) {
        if (!this.elements.chatStatusDot || !this.elements.chatStatusText) return;
        
        this.elements.chatStatusDot.className = 'status-dot';
        
        switch (status) {
            case 'online':
                this.elements.chatStatusDot.classList.add('online');
                this.elements.chatStatusText.textContent = text;
                this.elements.chatStatusText.style.color = 'var(--tg-green)';
                break;
            case 'connecting':
                this.elements.chatStatusDot.classList.add('connecting');
                this.elements.chatStatusText.textContent = text;
                this.elements.chatStatusText.style.color = 'var(--tg-orange)';
                break;
            case 'disconnected':
                this.elements.chatStatusDot.classList.add('offline');
                this.elements.chatStatusText.textContent = text;
                this.elements.chatStatusText.style.color = 'var(--tg-red)';
                break;
        }
    }
    
    updateConnectionStatus(status) {
        this.connectionStatus = status;
        
        if (!this.elements.connectionDot || !this.elements.connectionText) return;
        
        this.elements.connectionDot.className = 'status-dot';
        
        switch (status) {
            case 'connected':
                this.elements.connectionDot.classList.add('online');
                this.elements.connectionText.textContent = 'В сети';
                this.elements.connectionText.style.color = 'var(--tg-green)';
                break;
            case 'connecting':
                this.elements.connectionDot.classList.add('connecting');
                this.elements.connectionText.textContent = 'Подключение...';
                this.elements.connectionText.style.color = 'var(--tg-orange)';
                break;
            case 'disconnected':
                this.elements.connectionDot.classList.add('offline');
                this.elements.connectionText.textContent = 'Подключение отсутствует';
                this.elements.connectionText.style.color = 'var(--tg-red)';
                break;
        }
    }
    
    startWaitingForPartner() {
        if (this.waitingCheckInterval) clearInterval(this.waitingCheckInterval);
        
        this.waitingCheckInterval = setInterval(async () => {
            if (!this.login) return;
            
            try {
                const response = await fetch(`/chat_status?login=${this.login}`);
                const status = await response.json();
                
                if (status.in_chat) {
                    // Найден собеседник
                    clearInterval(this.waitingCheckInterval);
                    this.waitingCheckInterval = null;
                    
                    this.chatId = status.chat_id;
                    this.partner = status.partner;
                    this.updateChatUI(true);
                    this.showToast(`Соединено с ${this.partner}`, 'success');
                    
                    // Очищаем чат и начинаем опрос
                    this.clearChat();
                    this.startChatPolling();
                    
                    // Скрываем кнопку остановки поиска
                    this.elements.stopSearchBtn.classList.add('hidden');
                }
            } catch (error) {
                console.error('Ошибка проверки очереди:', error);
            }
        }, 3000);
    }
    
    startChatPolling() {
        if (this.chatPollInterval) clearInterval(this.chatPollInterval);
        
        this.chatPollInterval = setInterval(async () => {
            if (!this.login || !this.chatId) return;
            
            try {
                const response = await fetch(`/poll_private?login=${this.login}&chat_id=${this.chatId}&since=${this.lastTs}`);
                const data = await response.json();
                
                if (data.error) {
                    // Ошибка доступа к чату
                    if (data.error.includes('Доступ к чату запрещен') || data.error.includes('Вы не состоите в этом чате')) {
                        this.chatId = null;
                        this.partner = null;
                        this.updateChatUI(false);
                        this.showToast('Собеседник покинул чат', 'warning');
                        clearInterval(this.chatPollInterval);
                        this.chatPollInterval = null;
                        return;
                    }
                }
                
                if (data.messages?.length) {
                    data.messages.forEach(msg => {
                        if (msg.ts > this.lastTs) {
                            this.renderMessage(msg);
                            this.lastTs = msg.ts;
                            
                            // Воспроизводим звук для новых сообщений (кроме своих)
                            if (msg.login !== this.login && msg.login !== 'Система') {
                                this.playNotificationSound();
                            }
                        }
                    });
                }
                
                // Обновляем информацию о партнере
                if (data.partner && data.partner !== this.partner) {
                    this.partner = data.partner;
                    this.updateChatUI(true);
                }
                
            } catch (error) {
                console.error('Ошибка опроса чата:', error);
            }
        }, 2000);
    }
    
    // ===== ЗАПИСЬ МЕДИА =====
    
    async startRecording(type) {
        if (this.isRecording) return;
        
        try {
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 48000
                },
                video: type === 'video' ? {
                    width: { ideal: 640 },
                    height: { ideal: 640 },
                    facingMode: 'user',
                    frameRate: { ideal: 30 }
                } : false
            };
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints)
                .catch(error => {
                    console.error('Media access error:', error);
                    let message = 'Доступ к камере/микрофону запрещен';
                    
                    if (error.name === 'NotFoundError') {
                        message = 'Устройство не найдено';
                    } else if (error.name === 'NotAllowedError') {
                        message = 'Разрешение не предоставлено';
                    }
                    
                    throw new Error(message);
                });
            
            this.setupRecording(stream, type);
            
        } catch (error) {
            console.error('Recording setup error:', error);
            this.showToast(error.message || 'Ошибка доступа к устройству', 'error');
        }
    }
    
    setupRecording(stream, type) {
        this.isRecording = true;
        this.recordingType = type;
        this.mediaStream = stream;
        this.mediaChunks = [];
        this.recordingSeconds = 0;
        
        // Для видео записываем и аудио, и видео
        const mimeType = type === 'voice' ? 'audio/webm;codecs=opus' : 'video/webm;codecs=vp9,opus';
        this.mediaRecorder = new MediaRecorder(stream, { 
            mimeType: mimeType,
            videoBitsPerSecond: 2500000,
            audioBitsPerSecond: 128000
        });
        
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.mediaChunks.push(e.data);
        };
        
        this.mediaRecorder.start(100);
        this.startRecordingTimer();
        
        // Показываем улучшенное превью
        this.showRecordingPreview(type);
        
        // Скрываем кнопки голос/видео
        this.elements.voiceBtn.style.display = 'none';
        this.elements.videoBtn.style.display = 'none';
        this.elements.sendBtn.style.display = 'none';
    }
    
    showRecordingPreview(type) {
        this.elements.recordingTypeText.textContent = 
            type === 'voice' ? 'Запись голосового сообщения' : 'Запись видео сообщения';
        this.elements.recordingTimer.textContent = '0:00';
        
        // Для видео показываем превью
        if (type === 'video' && this.mediaStream) {
            this.elements.videoPreviewElement.srcObject = this.mediaStream;
            this.elements.videoPreviewElement.play();
        } else {
            // Скрываем видео превью для голосовых сообщений
            this.elements.videoPreviewContainer.style.display = 'none';
        }
        
        this.elements.recordingPreview.classList.add('show');
    }
    
    startRecordingTimer() {
        if (this.recordingTimerInterval) clearInterval(this.recordingTimerInterval);
        
        this.recordingTimerInterval = setInterval(() => {
            this.recordingSeconds++;
            
            // Обновляем таймер
            const minutes = Math.floor(this.recordingSeconds / 60);
            const seconds = this.recordingSeconds % 60;
            this.elements.recordingTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            // Предупреждение о конце записи
            if (this.recordingSeconds >= 55 && this.recordingSeconds < 60) {
                const remaining = 60 - this.recordingSeconds;
                this.showToast(`Осталось ${remaining} секунд`, 'warning');
            }
            
            // Автозавершение записи
            if (this.recordingSeconds >= this.recordingMaxSeconds) {
                this.finishRecording();
            }
        }, 1000);
    }
    
    async finishRecording() {
        if (!this.isRecording) return;

        // Останавливаем таймер
        if (this.recordingTimerInterval) {
            clearInterval(this.recordingTimerInterval);
            this.recordingTimerInterval = null;
        }
        
        // Скрываем превью
        this.elements.recordingPreview.classList.remove('show');
        this.elements.videoPreviewContainer.style.display = 'block';
        
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        
        await new Promise(resolve => {
            this.mediaRecorder.onstop = resolve;
        });
        
        const blob = new Blob(this.mediaChunks, {
            type: this.recordingType === 'voice' ? 'audio/webm' : 'video/webm'
        });
        
        const base64 = await this.blobToBase64(blob);
        const endpoint = this.recordingType === 'voice' ? '/voice' : '/video';
        
        try {
            await this.apiRequest(endpoint, {
                login: this.login,
                chat_id: this.chatId,
                [this.recordingType]: base64.split(',')[1]
            });
            
            this.showToast(`${this.recordingType === 'voice' ? 'Голосовое' : 'Видео'} сообщение отправлено`, 'success');
            
        } catch (error) {
            console.error('Ошибка отправки записи:', error);
            this.showToast('Ошибка отправки', 'error');
            
        } finally {
            this.resetRecording();
        }
    }
    
    cancelRecording() {
        if (!this.isRecording) return;

        // Останавливаем таймер
        if (this.recordingTimerInterval) {
            clearInterval(this.recordingTimerInterval);
            this.recordingTimerInterval = null;
        }
        
        // Скрываем превью
        this.elements.recordingPreview.classList.remove('show');
        this.elements.videoPreviewContainer.style.display = 'block';
        
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        
        this.resetRecording();
        this.showToast('Запись отменена', 'warning');
    }
    
    resetRecording() {
        this.isRecording = false;
        this.recordingType = null;
        
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        this.mediaChunks = [];
        this.recordingSeconds = 0;
        
        // Восстанавливаем кнопки
        if (this.chatId) {
            this.elements.voiceBtn.style.display = 'flex';
            this.elements.videoBtn.style.display = 'flex';
            this.elements.sendBtn.style.display = 'flex';
        }
    }
    
    // ===== ОТПРАВКА СООБЩЕНИЙ =====
    
    async sendMessage() {
        if (!this.login || !this.chatId || this.isRecording || this.isSending) return;

        const text = this.elements.msgInput.value.trim();
        if (!text) return;

        const optimisticId = `opt${Date.now()}${Math.random().toString(36).slice(2, 9)}`;
        const optimisticMsg = {
            id: optimisticId,
            chat_id: this.chatId,
            login: this.login,
            text: text,
            ts: Date.now() / 1000,
            isvoice: false,
            delivered: false,
            read: false,
            readcount: 0
        };

        this.pendingMessages.add(optimisticId);
        this.messageStatus.set(optimisticId, {
            delivered: false,
            read: false,
            readCount: 0
        });
        
        this.renderMessage(optimisticMsg);
        this.elements.msgInput.value = '';
        this.updateCharCount();
        this.isSending = true;

        try {
            const response = await this.apiRequest('/send_private', { 
                login: this.login,
                chat_id: this.chatId,
                text 
            });
            
            this.replaceOptimisticMessage(optimisticId, response);
            
        } catch (error) {
            console.error('Ошибка отправки:', error);
            this.removeOptimisticMessage(optimisticId);
            this.elements.msgInput.value = text;
            this.updateCharCount();
            this.showToast('Ошибка отправки', 'error');
            
        } finally {
            this.isSending = false;
            this.pendingMessages.delete(optimisticId);
            this.elements.msgInput.focus();
        }
    }
    
    replaceOptimisticMessage(optId, serverMsg) {
        const optElement = this.elements.chat.querySelector(`[data-msg-id="${optId}"]`);
        if (optElement) optElement.remove();
        
        this.messageCache.delete(optId);
        this.messageStatus.delete(optId);
        this.renderMessage(serverMsg);
    }
    
    removeOptimisticMessage(optId) {
        const optElement = this.elements.chat.querySelector(`[data-msg-id="${optId}"]`);
        if (optElement) optElement.remove();
        this.messageCache.delete(optId);
        this.messageStatus.delete(optId);
    }
    
    // ===== РЕНДЕРИНГ СООБЩЕНИЙ =====
    
    renderMessage(msg) {
        // Проверка на дублирование
        if (this.messageCache.has(msg.id)) return;
        
        const isMine = msg.login === this.login;
        const isSystem = msg.login === 'Система';
        const msgElement = this.createMessageElement(msg, isMine, isSystem);
        
        // Плавное появление
        msgElement.style.opacity = '0';
        
        // Добавляем в правильное место
        this.elements.chat.appendChild(msgElement);
        
        requestAnimationFrame(() => {
            msgElement.style.transition = 'opacity 150ms ease';
            msgElement.style.opacity = '1';
        });
        
        // Кэширование
        this.messageCache.set(msg.id, msgElement);
        
        // Автоскролл для новых сообщений
        if (isMine || msg.ts > this.lastTs) {
            this.autoScroll();
        }
        
        // Обновление времени последнего сообщения
        this.lastTs = Math.max(this.lastTs, msg.ts);
    }
    
    createMessageElement(msg, isMine, isSystem) {
        const div = document.createElement('div');
        div.className = `msg ${isMine ? 'me' : 'other'}`;
        if (isSystem) div.className = 'msg system';
        div.dataset.msgId = msg.id;
        
        const fragment = document.createDocumentFragment();
        fragment.appendChild(this.createMessageContent(msg, isMine, isSystem));
        div.appendChild(fragment);
        
        return div;
    }
    
    createMessageContent(msg, isMine, isSystem) {
        const content = document.createElement('div');
        content.className = 'msg-content';
        
        const time = new Date(msg.ts * 1000).toLocaleTimeString('ru-RU', {
            hour: '2-digit', 
            minute: '2-digit'
        });
        
        if (isSystem) {
            content.innerHTML = `
                <div class="text-message system-message">
                    ${this.escapeHtml(msg.text)}
                </div>
                <div class="msg-footer">
                    <span class="msg-time">${time}</span>
                </div>
            `;
            return content;
        }
        
        content.innerHTML = `
            <div class="msg-header">
                <span class="msg-username">${isMine ? 'Вы' : this.escapeHtml(msg.login)}</span>
            </div>
            <div class="msg-body">
                ${this.createMessageBody(msg)}
            </div>
            <div class="msg-footer">
                <span class="msg-time">${time}</span>
            </div>
        `;
        
        return content;
    }
    
    createMessageBody(msg) {
        if (msg.mediatype === 'voice') {
            return this.createVoiceMessage(msg);
        } else if (msg.mediatype === 'video') {
            return this.createVideoMessage(msg);
        } else if (msg.mediatype === 'image') {
            return this.createImageMessage(msg);
        } else if (msg.mediatype === 'music') {
            return this.createAudioMessage(msg);
        } else if (msg.mediatype === 'file') {
            return this.createFileMessage(msg);
        } else {
            return `<div class="text-message">${this.escapeHtml(msg.text)}</div>`;
        }
    }
    
    createVoiceMessage(msg) {
        return `
            <div class="telegram-voice-message" data-voice-id="${msg.id}">
                <div class="voice-controls">
                    <button class="voice-play-btn" type="button">▶</button>
                    <div class="voice-progress-container">
                        <div class="voice-progress">
                            <div class="voice-progress-fill" style="width: 0%"></div>
                        </div>
                    </div>
                    <span class="voice-duration">0:00</span>
                </div>
                <audio src="${msg.mediadata}" preload="metadata"></audio>
            </div>
        `;
    }
    
    createVideoMessage(msg) {
        const isCircle = !msg.filename || !msg.filename.includes('.mp4');
        
        if (isCircle) {
            return `
                <div class="telegram-video-circle" data-video-id="${msg.id}">
                    <video class="video-circle-player" muted playsinline preload="metadata" style="transform: scaleX(-1);">
                        <source src="${msg.mediadata}" type="video/webm">
                    </video>
                    <div class="video-circle-overlay">
                        <button class="video-circle-play-btn" type="button">▶</button>
                        <div class="video-circle-progress-container">
                            <div class="video-circle-progress">
                                <div class="video-circle-progress-fill" style="width: 0%"></div>
                            </div>
                        </div>
                        <div class="video-circle-duration">0:00</div>
                    </div>
                </div>
            `;
        } else {
            return `
                <div class="telegram-video-file" data-video-id="${msg.id}">
                    <video class="video-file-player" preload="metadata" playsinline>
                        <source src="${msg.mediadata}" type="video/mp4">
                    </video>
                    <div class="video-file-controls">
                        <button class="video-file-play-btn" type="button">▶</button>
                        <div class="video-file-progress-container">
                            <div class="video-file-progress">
                                <div class="video-file-progress-fill" style="width: 0%"></div>
                            </div>
                        </div>
                        <div class="video-file-time">0:00 / 0:00</div>
                    </div>
                    <div class="video-file-info">
                        <div class="file-icon">📽️</div>
                        <div class="file-info">
                            <div class="file-name">${msg.filename || 'video.mp4'}</div>
                        </div>
                    </div>
                </div>
            `;
        }
    }
    
    createAudioMessage(msg) {
        return `
            <div class="telegram-audio-player" data-audio-id="${msg.id}">
                <div class="audio-controls">
                    <button class="audio-play-btn" type="button">▶</button>
                    <div class="audio-info">
                        <div class="audio-title">${msg.filename || 'Аудио'}</div>
                        <div class="audio-progress-container">
                            <div class="audio-progress">
                                <div class="audio-progress-fill" style="width: 0%"></div>
                            </div>
                        </div>
                    </div>
                    <div class="audio-time">0:00 / 0:00</div>
                </div>
                <audio src="${msg.mediadata}" preload="metadata"></audio>
            </div>
        `;
    }
    
    createImageMessage(msg) {
        return `
            <div class="image-message-container">
                <img src="${msg.mediadata}" 
                     class="telegram-photo" 
                     alt="Фото" 
                     loading="lazy"
                     onclick="window.cloudChat.showFullscreenImage(this.src)">
                <div class="file-menu">
                    <button class="file-menu-btn" type="button">⋮</button>
                    <div class="file-menu-dropdown">
                        <a href="${msg.mediadata}" 
                           download="${msg.filename || 'image.jpg'}" 
                           class="download-link">
                            Скачать
                        </a>
                    </div>
                </div>
            </div>
        `;
    }
    
    createFileMessage(msg) {
        const fileSize = this.formatFileSize(msg.mediadata ? msg.mediadata.length * 3 / 4 : 0);
        return `
            <div class="telegram-file">
                <div class="file-icon">📄</div>
                <div class="file-info">
                    <div class="file-name">${msg.filename || 'file'}</div>
                    <div class="file-size">${fileSize}</div>
                </div>
                <div class="file-menu">
                    <button class="file-menu-btn" type="button">⋮</button>
                    <div class="file-menu-dropdown">
                        <a href="${msg.mediadata}" 
                           download="${msg.filename || 'file'}" 
                           class="download-link">
                            Скачать
                        </a>
                    </div>
                </div>
            </div>
        `;
    }
    
    // ===== ОБРАБОТКА КЛИКОВ =====
    
    handleChatClick(e) {
        const target = e.target;
        
        // Предотвращаем действия для системных сообщений
        if (target.closest('.system-message')) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        
        // Меню файлов
        if (target.closest('.file-menu-btn')) {
            e.stopPropagation();
            this.toggleFileMenu(target.closest('.file-menu-btn'));
            return;
        }
        
        // Закрытие меню при клике вне
        if (!target.closest('.file-menu')) {
            document.querySelectorAll('.file-menu-dropdown').forEach(menu => {
                menu.style.display = 'none';
            });
        }
        
        // Управление аудио
        if (target.closest('.audio-play-btn')) {
            this.toggleAudioPlayback(target.closest('.audio-play-btn'));
        }
        
        // Управление видео
        if (target.closest('.video-circle-play-btn')) {
            this.toggleVideoCirclePlayback(target.closest('.video-circle-play-btn'));
        } else if (target.closest('.video-file-play-btn')) {
            this.toggleVideoFilePlayback(target.closest('.video-file-play-btn'));
        }
        
        // Управление голосовыми
        if (target.closest('.voice-play-btn')) {
            this.toggleVoicePlayback(target.closest('.voice-play-btn'));
        }
        
        // Полноэкранный просмотр изображений
        if (target.classList.contains('telegram-photo')) {
            this.showFullscreenImage(target.src);
        }
        
        // Обработка кликов на прогресс-бары
        if (target.classList.contains('voice-progress')) {
            this.seekVoice(e, target.closest('[data-voice-id]')?.dataset.voiceId);
        } else if (target.classList.contains('audio-progress')) {
            this.seekAudio(e, target.closest('[data-audio-id]')?.dataset.audioId);
        } else if (target.classList.contains('video-circle-progress')) {
            this.seekVideoCircle(e, target.closest('[data-video-id]')?.dataset.videoId);
        } else if (target.classList.contains('video-file-progress')) {
            this.seekVideoFile(e, target.closest('[data-video-id]')?.dataset.videoId);
        }
    }
    
    toggleFileMenu(button) {
        const menu = button.nextElementSibling;
        const isVisible = menu.style.display === 'block';
        
        // Закрываем все меню
        document.querySelectorAll('.file-menu-dropdown').forEach(m => {
            m.style.display = 'none';
        });
        
        // Открываем/закрываем текущее меню
        menu.style.display = isVisible ? 'none' : 'block';
    }
    
    toggleAudioPlayback(button) {
        const player = button.closest('.telegram-audio-player');
        const audio = player.querySelector('audio');
        
        if (!audio) return;
        
        // Останавливаем другое аудио
        this.activeMedia.forEach((media, key) => {
            if (media !== audio && media.tagName === 'AUDIO') {
                media.pause();
                const prevBtn = media.closest('.telegram-audio-player')?.querySelector('.audio-play-btn');
                if (prevBtn) {
                    prevBtn.classList.remove('playing');
                    prevBtn.innerHTML = '▶';
                }
            }
        });
        
        if (audio.paused) {
            audio.play().then(() => {
                button.classList.add('playing');
                button.innerHTML = '⏸';
                this.activeMedia.set(audio.dataset.id || 'audio', audio);
                
                // Обновление прогресса
                const updateProgress = () => {
                    if (!isNaN(audio.duration)) {
                        const percent = (audio.currentTime / audio.duration) * 100;
                        const progressFill = player.querySelector('.audio-progress-fill');
                        const timeElement = player.querySelector('.audio-time');
                        
                        if (progressFill) progressFill.style.width = `${percent}%`;
                        if (timeElement) {
                            timeElement.textContent = 
                                `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`;
                        }
                    }
                };
                
                audio.ontimeupdate = updateProgress;
                audio.onended = () => {
                    button.classList.remove('playing');
                    button.innerHTML = '▶';
                    this.activeMedia.delete(audio.dataset.id || 'audio');
                };
            }).catch(console.error);
        } else {
            audio.pause();
            button.classList.remove('playing');
            button.innerHTML = '▶';
            this.activeMedia.delete(audio.dataset.id || 'audio');
        }
    }
    
    toggleVideoCirclePlayback(button) {
        const container = button.closest('.telegram-video-circle');
        const video = container.querySelector('.video-circle-player');
        const durationElement = container.querySelector('.video-circle-duration');
        const progressFill = container.querySelector('.video-circle-progress-fill');
        
        if (!video) return;
        
        if (video.paused) {
            video.play().then(() => {
                button.classList.add('playing');
                button.innerHTML = '⏸';
                this.activeMedia.set(video.dataset.id || 'video', video);
                
                // Обновление прогресса
                const updateProgress = () => {
                    if (!isNaN(video.duration)) {
                        const percent = (video.currentTime / video.duration) * 100;
                        if (progressFill) progressFill.style.width = `${percent}%`;
                        if (durationElement) {
                            durationElement.textContent = this.formatTime(video.currentTime);
                        }
                    }
                };
                
                video.ontimeupdate = updateProgress;
                video.onended = () => {
                    button.classList.remove('playing');
                    button.innerHTML = '▶';
                    this.activeMedia.delete(video.dataset.id || 'video');
                };
            }).catch(console.error);
        } else {
            video.pause();
            button.classList.remove('playing');
            button.innerHTML = '▶';
            this.activeMedia.delete(video.dataset.id || 'video');
        }
    }
    
    toggleVideoFilePlayback(button) {
        const container = button.closest('.telegram-video-file');
        const video = container.querySelector('.video-file-player');
        const timeElement = container.querySelector('.video-file-time');
        const progressFill = container.querySelector('.video-file-progress-fill');
        
        if (!video) return;
        
        // Останавливаем другое видео
        this.activeMedia.forEach((media, key) => {
            if (media !== video && media.tagName === 'VIDEO') {
                media.pause();
                const prevBtn = media.closest('.telegram-video-file')?.querySelector('.video-file-play-btn');
                if (prevBtn) {
                    prevBtn.classList.remove('playing');
                    prevBtn.innerHTML = '▶';
                }
            }
        });
        
        if (video.paused) {
            video.play().then(() => {
                button.classList.add('playing');
                button.innerHTML = '⏸';
                this.activeMedia.set(video.dataset.id || 'video', video);
                
                // Обновление прогресса
                const updateProgress = () => {
                    if (!isNaN(video.duration)) {
                        const percent = (video.currentTime / video.duration) * 100;
                        if (progressFill) progressFill.style.width = `${percent}%`;
                        if (timeElement) {
                            timeElement.textContent = 
                                `${this.formatTime(video.currentTime)} / ${this.formatTime(video.duration)}`;
                        }
                    }
                };
                
                video.ontimeupdate = updateProgress;
                video.onended = () => {
                    button.classList.remove('playing');
                    button.innerHTML = '▶';
                    this.activeMedia.delete(video.dataset.id || 'video');
                };
            }).catch(console.error);
        } else {
            video.pause();
            button.classList.remove('playing');
            button.innerHTML = '▶';
            this.activeMedia.delete(video.dataset.id || 'video');
        }
    }
    
    toggleVoicePlayback(button) {
        const message = button.closest('.telegram-voice-message');
        const audio = message.querySelector('audio');
        
        if (!audio) return;
        
        if (audio.paused) {
            audio.play().then(() => {
                button.classList.add('playing');
                button.innerHTML = '⏸';
                this.activeMedia.set(audio.dataset.id || 'voice', audio);
                
                // Обновление прогресса
                const updateProgress = () => {
                    if (!isNaN(audio.duration)) {
                        const percent = (audio.currentTime / audio.duration) * 100;
                        const progressFill = message.querySelector('.voice-progress-fill');
                        const durationElement = message.querySelector('.voice-duration');
                        
                        if (progressFill) progressFill.style.width = `${percent}%`;
                        if (durationElement) {
                            durationElement.textContent = this.formatTime(audio.currentTime);
                        }
                    }
                };
                
                audio.ontimeupdate = updateProgress;
                audio.onended = () => {
                    button.classList.remove('playing');
                    button.innerHTML = '▶';
                    this.activeMedia.delete(audio.dataset.id || 'voice');
                };
            }).catch(console.error);
        } else {
            audio.pause();
            button.classList.remove('playing');
            button.innerHTML = '▶';
            this.activeMedia.delete(audio.dataset.id || 'voice');
        }
    }
    
    // ПОЛЗУНКИ ДЛЯ УПРАВЛЕНИЯ ВРЕМЕНЕМ
    seekVoice(e, msgId) {
        if (!msgId) return;
        const message = document.querySelector(`[data-voice-id="${msgId}"]`);
        if (!message) return;
        
        const audio = message.querySelector('audio');
        if (!audio || isNaN(audio.duration)) return;
        
        const progressBar = e.target.closest('.voice-progress');
        if (!progressBar) return;
        
        const rect = progressBar.getBoundingClientRect();
        const clickPosition = e.clientX - rect.left;
        const percentage = (clickPosition / rect.width) * 100;
        
        audio.currentTime = (percentage / 100) * audio.duration;
    }
    
    seekAudio(e, msgId) {
        if (!msgId) return;
        const player = document.querySelector(`[data-audio-id="${msgId}"]`);
        if (!player) return;
        
        const audio = player.querySelector('audio');
        if (!audio || isNaN(audio.duration)) return;
        
        const progressBar = e.target.closest('.audio-progress');
        if (!progressBar) return;
        
        const rect = progressBar.getBoundingClientRect();
        const clickPosition = e.clientX - rect.left;
        const percentage = (clickPosition / rect.width) * 100;
        
        audio.currentTime = (percentage / 100) * audio.duration;
    }
    
    seekVideoCircle(e, msgId) {
        if (!msgId) return;
        const container = document.querySelector(`[data-video-id="${msgId}"]`);
        if (!container) return;
        
        const video = container.querySelector('.video-circle-player');
        if (!video || isNaN(video.duration)) return;
        
        const progressBar = e.target.closest('.video-circle-progress');
        if (!progressBar) return;
        
        const rect = progressBar.getBoundingClientRect();
        const clickPosition = e.clientX - rect.left;
        const percentage = (clickPosition / rect.width) * 100;
        
        video.currentTime = (percentage / 100) * video.duration;
    }
    
    seekVideoFile(e, msgId) {
        if (!msgId) return;
        const container = document.querySelector(`[data-video-id="${msgId}"]`);
        if (!container) return;
        
        const video = container.querySelector('.video-file-player');
        if (!video || isNaN(video.duration)) return;
        
        const progressBar = e.target.closest('.video-file-progress');
        if (!progressBar) return;
        
        const rect = progressBar.getBoundingClientRect();
        const clickPosition = e.clientX - rect.left;
        const percentage = (clickPosition / rect.width) * 100;
        
        video.currentTime = (percentage / 100) * video.duration;
    }
    
    // ===== SSE И УВЕДОМЛЕНИЯ =====
    
    connectSSE() {
        if (!this.login) return;
        
        if (this.sseConnection) {
            this.sseConnection.close();
        }
        
        this.sseConnection = new EventSource(`/events?login=${this.login}`);
        
        this.sseConnection.onopen = () => {
            console.log('SSE соединение установлено');
            this.updateConnectionStatus('connected');
        };
        
        this.sseConnection.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'private_message') {
                    this.handlePrivateMessage(data);
                } else if (data.type === 'connected') {
                    console.log('SSE подключен');
                }
            } catch (e) {
                console.error('Ошибка обработки SSE:', e);
            }
        };
        
        this.sseConnection.onerror = (error) => {
            console.error('SSE ошибка:', error);
            this.updateConnectionStatus('disconnected');
            
            // Переподключение
            if (this.sseConnection) {
                this.sseConnection.close();
            }
            setTimeout(() => this.connectSSE(), 5000);
        };
    }
    
    handlePrivateMessage(data) {
        const message = data.data;
        
        // Проверяем, что сообщение для нашего чата
        if (message.chat_id === this.chatId) {
            this.renderMessage(message);
            this.playNotificationSound();
        }
    }
    
    playNotificationSound() {
        if (this.notificationSound && !document.hidden) {
            this.notificationSound.currentTime = 0;
            this.notificationSound.play().catch(() => {});
        }
    }
    
    // ===== ТЕМА И ИНТЕРФЕЙС =====
    
    initTheme() {
        document.body.setAttribute('data-theme', this.theme);
        this.updateThemeButton();
    }
    
    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        document.body.setAttribute('data-theme', this.theme);
        localStorage.setItem('chatTheme', this.theme);
        this.updateThemeButton();
        this.showToast(`Тема: ${this.theme === 'dark' ? 'Темная' : 'Светлая'}`, 'info');
    }
    
    updateThemeButton() {
        if (this.elements.themeToggleBtn) {
            this.elements.themeToggleBtn.innerHTML = this.theme === 'dark' ? '☀️' : '🌙';
            this.elements.themeToggleBtn.title = 
                this.theme === 'dark' ? 'Светлая тема' : 'Темная тема';
        }
    }
    
    updateCharCount() {
        if (!this.elements.charCounter || !this.elements.charCount) return;
        
        const count = this.elements.msgInput.value.length;
        this.elements.charCount.textContent = count;
        
        if (count > 0) {
            this.elements.charCounter.classList.remove('hidden');
            
            if (count > 1900) {
                this.elements.charCounter.style.color = 'var(--tg-red)';
            } else if (count > 1500) {
                this.elements.charCounter.style.color = 'var(--tg-orange)';
            } else {
                this.elements.charCounter.style.color = 'var(--tg-text-secondary)';
            }
        } else {
            this.elements.charCounter.classList.add('hidden');
        }
    }
    
    debouncedUpdateCharCount = this.debounce(() => {
        this.updateCharCount();
    }, 150);
    
    // ===== ФОНОВЫЕ ПРОЦЕССЫ =====
    
    startBackgroundProcesses() {
        // Устанавливаем статус подключения
        this.updateConnectionStatus('connecting');
        
        // SSE соединение
        this.connectSSE();
        
        // Сердцебиение
        this.startHeartbeat();
    }
    
    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        
        this.heartbeatInterval = setInterval(() => {
            if (this.login) {
                this.sendHeartbeat();
            }
        }, 30000);
        
        // Первый heartbeat
        this.sendHeartbeat();
    }
    
    sendHeartbeat() {
        if (!this.login) return;
        
        fetch('/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: this.login }),
            keepalive: true,
            priority: 'low'
        }).then(response => {
            if (response.ok) {
                this.updateConnectionStatus('connected');
                // Сбрасываем таймер неактивности
                if (this.inactivityTimer) {
                    clearTimeout(this.inactivityTimer);
                    this.setupInactivityTracking();
                }
            } else {
                response.json().then(data => {
                    if (data.requires_relogin) {
                        this.forceLogout(data.message);
                    }
                }).catch(() => {
                    this.updateConnectionStatus('disconnected');
                });
            }
        }).catch(() => {
            this.updateConnectionStatus('disconnected');
        });
    }
    
    setupInactivityTracking() {
        const resetInactivityTimer = () => {
            if (this.inactivityTimer) {
                clearTimeout(this.inactivityTimer);
            }
            
            if (this.login) {
                this.inactivityTimer = setTimeout(() => {
                    this.checkUserActivity();
                }, this.INACTIVITY_TIMEOUT);
            }
        };
        
        // События активности
        const activityEvents = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
        
        activityEvents.forEach(event => {
            document.addEventListener(event, resetInactivityTimer, { passive: true });
        });
        
        resetInactivityTimer();
    }
    
    async checkUserActivity() {
        if (!this.login) return;
        
        try {
            const response = await fetch('/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login: this.login })
            });
            
            if (!response.ok) {
                this.forceLogout('Сессия истекла из-за неактивности');
            }
        } catch (error) {
            console.error('Activity check error:', error);
        }
    }
    
    handleVisibilityChange() {
        if (document.hidden) {
            // Страница скрыта
        } else {
            // Страница видна
            if (this.login) {
                this.sendHeartbeat();
            }
        }
    }
    
    throttledScrollHandler() {
        if (!this.autoScrollEnabled) return;
        
        const chat = this.elements.chat;
        const isNearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 100;
        
        if (isNearBottom) {
            this.autoScrollEnabled = true;
        } else {
            this.autoScrollEnabled = false;
        }
    }
    
    // ===== УТИЛИТЫ =====
    
    showToast(message, type = 'info', duration = 750) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        
        toast.innerHTML = `
            <div class="toast-icon">${icons[type] || 'ℹ'}</div>
            <div class="toast-content">${message}</div>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 10);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
        
        return toast;
    }
    
    async apiRequest(endpoint, data) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        return await response.json();
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    async blobToBase64(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }
    
    async readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
    
    async selectMedia() {
        if (!this.login || !this.chatId || this.isRecording) return;

        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.rar';
            
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return resolve();
                
                if (file.size > 64 * 1024 * 1024) {
                    this.showToast('Файл: макс. 64MB', 'error');
                    return resolve();
                }
                
                try {
                    const base64 = await this.readFileAsBase64(file);
                    const mediaType = this.detectMediaType(file);
                    
                    await this.apiRequest('/media', {
                        login: this.login,
                        chat_id: this.chatId,
                        type: mediaType,
                        data: base64.split(',')[1],
                        filename: file.name
                    });
                    
                    this.showToast('Файл отправлен', 'success');
                } catch (error) {
                    console.error('Ошибка загрузки:', error);
                    this.showToast('Ошибка загрузки', 'error');
                }
                
                resolve();
            };
            
            input.click();
        });
    }
    
    detectMediaType(file) {
        if (file.type.startsWith('image/')) return 'image';
        if (file.type.startsWith('video/')) return 'video';
        if (file.type.startsWith('audio/')) return 'music';
        return 'file';
    }
    
    showFullscreenImage(src) {
        if (this.elements.fullscreenImage && this.elements.fullscreenModal) {
            this.elements.fullscreenImage.src = src;
            this.elements.fullscreenModal.style.display = 'flex';
        }
    }
    
    autoScroll() {
        if (this.elements.chat && this.autoScrollEnabled) {
            requestAnimationFrame(() => {
                this.elements.chat.scrollTop = this.elements.chat.scrollHeight;
            });
        }
    }
    
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
    
    throttle(func, limit) {
        let inThrottle;
        return (...args) => {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
    
    clearChat() {
        this.elements.chat.innerHTML = '';
        this.messageCache.clear();
        this.messageStatus.clear();
        this.pendingMessages.clear();
        this.lastTs = 0;
    }
    
    showWelcomeMessage() {
        this.clearChat();
        
        const welcomeDiv = document.createElement('div');
        welcomeDiv.className = 'welcome-message';
        welcomeDiv.innerHTML = `
            <div class="welcome-content">
                <h3>⚠️ CloudChat ⚠️</h3>
                <p>Нажмите "Найти собеседника" чтобы начать беседу.</p>
                
                <div class="action-buttons" style="justify-content: center; margin-top: 30px;">
                    <button id="start-search-btn" class="action-btn">
                        <span>🔍</span>
                        Найти собеседника
                    </button>
                    <button id="open-settings-btn" class="action-btn warning">
                        <span>⚙️</span>
                        Настройки поиска
                    </button>
                </div>
            </div>
        `;
        
        this.elements.chat.appendChild(welcomeDiv);
        
        // Добавляем обработчики для новых кнопок
        setTimeout(() => {
            const startSearchBtn = document.getElementById('start-search-btn');
            const openSettingsBtn = document.getElementById('open-settings-btn');
            
            if (startSearchBtn) {
                startSearchBtn.onclick = () => this.findPartner();
            }
            if (openSettingsBtn) {
                openSettingsBtn.onclick = () => this.showSettings();
            }
        }, 100);
    }
    
    // ===== ОЧИСТКА И ВЫХОД =====
    
    forceLogout(reason = 'Сессия истекла') {
        this.showToast(reason, 'warning');
        
        // Звук отключения
        if (this.logoutSound) {
            this.logoutSound.currentTime = 0;
            this.logoutSound.play().catch(() => {});
        }
        
        // Очищаем данные
        this.cleanup();
        
        // Показываем модальное окно входа
        this.showNickModal();
    }
    
    cleanup() {
        // Отправляем logout через sendBeacon
        if (this.login) {
            const data = JSON.stringify({ nick: this.login });
            if (navigator.sendBeacon) {
                navigator.sendBeacon('/logout', data);
            } else {
                // Fallback для старых браузеров
                fetch('/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: data,
                    keepalive: true
                }).catch(() => {});
            }
        }
        
        // Очищаем интервалы
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.recordingTimerInterval) clearInterval(this.recordingTimerInterval);
        if (this.chatPollInterval) clearInterval(this.chatPollInterval);
        if (this.waitingCheckInterval) clearInterval(this.waitingCheckInterval);
        if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
        
        // Закрываем SSE соединение
        if (this.sseConnection) {
            this.sseConnection.close();
        }
        
        // Останавливаем медиа
        this.activeMedia.forEach(media => {
            if (media.pause) media.pause();
        });
        
        // Останавливаем запись если активна
        if (this.isRecording) {
            this.cancelRecording();
        }
        
        // Очищаем данные
        this.activeMedia.clear();
        this.messageCache.clear();
        this.messageStatus.clear();
        this.pendingMessages.clear();
        
        // Сбрасываем состояние
        this.login = null;
        this.chatId = null;
        this.partner = null;
        this.lastTs = 0;
        this.autoScrollEnabled = true;
        
        // Очищаем интерфейс
        this.elements.chat.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-content">
                    <h3>⚠️ CloudChat! ⚠️</h3>
                    <p>Это безопасный анонимный чат для анонимного общения.</p>
                    
                    <div class="welcome-features">
                        <div class="feature">
                            <span>🥷🏿</span>
                            <div>Анонимность</div>
                        </div>
                        <div class="feature">
                            <span>🎙️</span>
                            <div>Голосовые сообщения</div>
                        </div>
                        <div class="feature">
                            <span>📽️</span>
                            <div>Видео сообщения</div>
                        </div>
                        <div class="feature">
                            <span>🔄</span>
                            <div>Смена собеседника</div>
                        </div>
                    </div>
                    
                    <div class="action-buttons" style="justify-content: center; margin-top: 30px;">
                    </div>
                </div>
            </div>
        `;
        
        this.elements.msgInput.value = '';
        this.elements.msgInput.disabled = true;
        this.elements.msgInput.placeholder = 'Введите псевдоним...';
        
        this.updateConnectionStatus('disconnected');
        this.updateChatStatus('disconnected', 'Не авторизован');
        
        if (this.elements.charCounter) {
            this.elements.charCounter.classList.add('hidden');
        }
        
        // Скрываем кнопки
        this.elements.mediaBtn.classList.add('hidden');
        this.elements.voiceBtn.classList.add('hidden');
        this.elements.videoBtn.classList.add('hidden');
        this.elements.sendBtn.classList.add('hidden');
        this.elements.nextPartnerBtn.classList.add('hidden');
        this.elements.leaveChatBtn.classList.add('hidden');
        if (this.elements.stopSearchBtn) {
            this.elements.stopSearchBtn.classList.add('hidden');
        }
        
        // Добавляем обработчик для кнопки начала чата
        setTimeout(() => {
            const startChatBtn = document.getElementById('start-chat-btn');
            if (startChatBtn) {
                startChatBtn.onclick = () => this.showNickModal();
            }
        }, 100);
    }
}

// Глобальный экземпляр чата
let cloudChat = null;

document.addEventListener('DOMContentLoaded', () => {
    if (!cloudChat) {
        cloudChat = new CloudChat();
        window.cloudChat = cloudChat;
    }
});

// Глобальные хоткеи
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (cloudChat?.elements?.fullscreenModal?.style.display === 'flex') {
            cloudChat.elements.fullscreenModal.style.display = 'none';
        }
        if (cloudChat?.elements?.settingsModal?.style.display === 'flex') {
            cloudChat.hideSettings();
        }
        if (cloudChat?.isRecording) {
            cloudChat.cancelRecording();
        }
    }
});

// ОБРАБОТКА СЕТЕВЫХ ОШИБОК
window.addEventListener('offline', () => {
    if (window.cloudChat) {
        window.cloudChat.updateConnectionStatus('disconnected');
        window.cloudChat.showToast('Потеряно соединение с интернетом', 'error');
    }
});

window.addEventListener('online', () => {
    if (window.cloudChat && window.cloudChat.login) {
        window.cloudChat.updateConnectionStatus('connecting');
        window.cloudChat.showToast('Восстановлено соединение', 'success');
        // Переподключаем SSE
        setTimeout(() => {
            if (window.cloudChat) {
                window.cloudChat.connectSSE();
            }
        }, 1000);
    }
});

// СОХРАНЕНИЕ ПОЗИЦИИ СКРОЛЛА
window.addEventListener('beforeunload', () => {
    if (window.cloudChat?.elements?.chat) {
        sessionStorage.setItem('chatScrollPos', window.cloudChat.elements.chat.scrollTop);
    }
});

window.addEventListener('load', () => {
    const savedPos = sessionStorage.getItem('chatScrollPos');
    const chat = document.getElementById('chat');
    if (chat && savedPos) {
        setTimeout(() => {
            chat.scrollTop = parseInt(savedPos);
        }, 100);
    }
});
