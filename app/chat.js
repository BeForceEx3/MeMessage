import app from './main.js';
import { debounce } from './utils.js';

export function initializeChat(appInstance) {
    const filterForm = document.getElementById('filter-form');
    const cancelSearch = document.getElementById('cancel-search');
    const endChat = document.getElementById('end-chat');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-message');
    const messageLength = document.getElementById('message-length');
    
    let searchStartTime = null;
    let searchInterval = null;
    
    filterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const targetGender = document.querySelector('input[name="target-gender"]:checked').value;
        const ageGroup = document.querySelector('input[name="age-group"]:checked').value;
        
        appInstance.socket.emit('find_partner', {
            targetGender,
            ageGroup
        });
        
        // Запускаем таймер поиска
        searchStartTime = Date.now();
        let profilesChecked = 0;
        
        searchInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - searchStartTime) / 1000);
            document.getElementById('search-time').textContent = elapsed;
            
            // Симуляция проверки профилей
            profilesChecked += Math.floor(Math.random() * 3) + 1;
            document.getElementById('profiles-checked').textContent = profilesChecked;
        }, 1000);
    });
    
    cancelSearch.addEventListener('click', () => {
        clearInterval(searchInterval);
        document.getElementById('search-screen').classList.remove('active');
        document.getElementById('filter-screen').classList.add('active');
    });
    
    endChat.addEventListener('click', () => {
        if (confirm('Завершить диалог?')) {
            appInstance.endChat();
        }
    });
    
    // Отправка сообщения
    sendButton.addEventListener('click', () => {
        sendMessage();
    });
    
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Отслеживание длины сообщения
    messageInput.addEventListener('input', (e) => {
        const length = e.target.value.length;
        messageLength.textContent = `${length}/500`;
        
        if (length > 500) {
            messageLength.style.color = 'var(--danger-color)';
        } else {
            messageLength.style.color = 'var(--text-secondary)';
        }
    });
    
    // Индикатор набора текста
    const typingDebounced = debounce(() => {
        if (appInstance.roomId) {
            appInstance.socket.emit('typing', {
                roomId: appInstance.roomId,
                isTyping: false
            });
        }
    }, 1000);
    
    messageInput.addEventListener('input', () => {
        if (appInstance.roomId) {
            appInstance.socket.emit('typing', {
                roomId: appInstance.roomId,
                isTyping: true
            });
            typingDebounced();
        }
    });
    
    function sendMessage() {
        const message = messageInput.value.trim();
        if (!message || !appInstance.roomId) return;
        
        const timestamp = Date.now();
        
        appInstance.socket.emit('send_message', {
            roomId: appInstance.roomId,
            message,
            timestamp
        });
        
        // Очищаем поле ввода
        messageInput.value = '';
        messageLength.textContent = '0/500';
        
        // Скрываем индикатор набора
        if (appInstance.roomId) {
            appInstance.socket.emit('typing', {
                roomId: appInstance.roomId,
                isTyping: false
            });
        }
    }
}
