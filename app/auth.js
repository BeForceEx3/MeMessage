import app from './main.js';

export function initializeApp(appInstance) {
    const authForm = document.getElementById('auth-form');
    const backToAuth = document.getElementById('back-to-auth');
    
    authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
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
        
        appInstance.user = { name, age, gender };
        appInstance.connectSocket();
        
        // Регистрация пользователя на сервере
        appInstance.socket.emit('register', appInstance.user);
    });
    
    backToAuth.addEventListener('click', () => {
        document.getElementById('filter-screen').classList.remove('active');
        document.getElementById('auth-screen').classList.add('active');
    });
}
