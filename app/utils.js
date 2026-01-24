// Обновление статистики
export function updateStats(online, chatting) {
    const onlineCount = document.getElementById('online-count');
    const chattingCount = document.getElementById('chatting-count');
    
    if (onlineCount) onlineCount.textContent = online;
    if (chattingCount) chattingCount.textContent = chatting;
}

// Debounce функция
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle функция
export function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Форматирование времени
export function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Валидация возраста
export function validateAge(age) {
    return age >= 12 && age <= 100;
}

// Генерация уникального ID
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Кэширование
export class SimpleCache {
    constructor(maxSize = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }
    
    set(key, value) {
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }
    
    get(key) {
        return this.cache.get(key);
    }
    
    has(key) {
        return this.cache.has(key);
    }
    
    clear() {
        this.cache.clear();
    }
}
