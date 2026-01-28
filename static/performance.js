class PerformanceOptimizer {
    static init() {
        this.initLazyLoading();
        this.initIntersectionObserver();
        this.initMemoryManagement();
        this.initConnectionOptimizer();
    }
    
    static initLazyLoading() {
        // Ленивая загрузка изображений
        const lazyImages = document.querySelectorAll('img[data-src]');
        
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        imageObserver.unobserve(img);
                    }
                });
            });
            
            lazyImages.forEach(img => imageObserver.observe(img));
        } else {
            // Fallback для старых браузеров
            lazyImages.forEach(img => {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            });
        }
    }
    
    static initIntersectionObserver() {
        // Оптимизация рендеринга при скролле
        if ('IntersectionObserver' in window) {
            const chat = document.getElementById('chat');
            if (!chat) return;
            
            const scrollObserver = new IntersectionObserver(
                (entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            // Элемент в зоне видимости
                            entry.target.classList.add('visible');
                        }
                    });
                },
                {
                    root: chat,
                    threshold: 0.1
                }
            );
            
            // Наблюдаем за сообщениями
            const observeMessages = () => {
                const messages = chat.querySelectorAll('.msg');
                messages.forEach(msg => {
                    if (!msg.classList.contains('observed')) {
                        scrollObserver.observe(msg);
                        msg.classList.add('observed');
                    }
                });
            };
            
            // Периодическая проверка новых сообщений
            setInterval(observeMessages, 1000);
            observeMessages();
        }
    }
    
    static initMemoryManagement() {
        // Очистка кэша изображений
        const imageCache = new Set();
        
        setInterval(() => {
            const images = document.querySelectorAll('img');
            images.forEach(img => {
                if (!img.src) return;
                
                // Проверяем, видно ли изображение
                const rect = img.getBoundingClientRect();
                const isVisible = (
                    rect.top >= 0 &&
                    rect.left >= 0 &&
                    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
                );
                
                if (!isVisible && imageCache.has(img.src)) {
                    // Освобождаем память для невидимых изображений
                    img.remove();
                } else {
                    imageCache.add(img.src);
                }
            });
        }, 30000); // Каждые 30 секунд
    }
    
    static initConnectionOptimizer() {
        // Оптимизация сетевых запросов
        let lastRequestTime = 0;
        const MIN_REQUEST_INTERVAL = 100; // 100ms между запросами
        
        // Перехват fetch запросов
        const originalFetch = window.fetch;
        
        window.fetch = function(...args) {
            const now = Date.now();
            const timeSinceLastRequest = now - lastRequestTime;
            
            if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
                // Задержка быстрых запросов
                return new Promise(resolve => {
                    setTimeout(() => {
                        lastRequestTime = Date.now();
                        resolve(originalFetch.apply(this, args));
                    }, MIN_REQUEST_INTERVAL - timeSinceLastRequest);
                });
            }
            
            lastRequestTime = now;
            return originalFetch.apply(this, args);
        };
    }
    
    static debounce(func, wait) {
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
    
    static throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    PerformanceOptimizer.init();
});

// Оптимизация для мобильных устройств
if ('connection' in navigator) {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    
    if (connection) {
        const updateNetworkInfo = () => {
            const isSlowConnection = connection.effectiveType === '2g' || connection.effectiveType === '3g';
            const isDataSaver = connection.saveData === true;
            
            if (isSlowConnection || isDataSaver) {
                // Применяем оптимизации для медленных соединений
                document.documentElement.classList.add('slow-connection');
                
                // Отключаем некоторые функции
                const featuresToDisable = [
                    'video-preview',
                    'auto-play-videos',
                    'high-res-images'
                ];
                
                featuresToDisable.forEach(feature => {
                    localStorage.setItem(`feature-${feature}`, 'disabled');
                });
            }
        };
        
        connection.addEventListener('change', updateNetworkInfo);
        updateNetworkInfo();
    }
}

// Предзагрузка критичных ресурсов
const preloadCriticalResources = () => {
    const criticalResources = [
        '/static/style.css',
        '/static/script.js'
    ];
    
    criticalResources.forEach(resource => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.href = resource;
        link.as = resource.endsWith('.css') ? 'style' : 'script';
        document.head.appendChild(link);
    });
};

// Запускаем предзагрузку
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', preloadCriticalResources);
} else {
    preloadCriticalResources();
}
