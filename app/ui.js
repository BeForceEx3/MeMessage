import app from './main.js';

export function initializeUI(appInstance) {
    // Ленивая загрузка изображений
    const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                imageObserver.unobserve(img);
            }
        });
    });
    
    // Виртуализация списка сообщений
    const messagesObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) {
                // Можно реализовать выгрузку невидимых сообщений
                // и замену их заполнителями
            }
        });
    }, {
        root: document.getElementById('messages-container'),
        threshold: 0.1
    });
    
    // Обработка свайпов
    let touchStartY = 0;
    let touchEndY = 0;
    
    document.addEventListener('touchstart', (e) => {
        touchStartY = e.changedTouches[0].screenY;
    });
    
    document.addEventListener('touchend', (e) => {
        touchEndY = e.changedTouches[0].screenY;
        handleSwipe();
    });
    
    function handleSwipe() {
        const swipeDistance = touchEndY - touchStartY;
        
        // Свайп вниз для обновления (только на экране чата)
        if (swipeDistance > 100 && document.getElementById('chat-screen').classList.contains('active')) {
            // Можно добавить функционал обновления
            console.log('Pull to refresh');
        }
    }
    
    // Адаптация под клавиатуру на мобильных устройствах
    const messageInput = document.getElementById('message-input');
    const messagesContainer = document.getElementById('messages-container');
    
    messageInput.addEventListener('focus', () => {
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 300);
    });
    
    // Тема (можно добавить переключение)
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (!prefersDark) {
        // Можно добавить светлую тему
    }
    
    // Обработка онлайн/офлайн статуса
    window.addEventListener('online', () => {
        console.log('App is online');
        // Можно добавить переподключение
    });
    
    window.addEventListener('offline', () => {
        console.log('App is offline');
        alert('Отсутствует подключение к интернету');
    });
}
