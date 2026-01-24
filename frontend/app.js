const socket = io();
let currentUser = null;
let partner = null;

document.getElementById('btnStart').addEventListener('click', () => {
    const name = document.getElementById('name').value;
    const age = parseInt(document.getElementById('age').value);
    const gender = document.getElementById('gender').value;
    const preferredGender = document.getElementById('preferredGender').value;
    const ageGroup = document.getElementById('ageGroup').value;

    if (!name || !age || !gender || !preferredGender || !ageGroup) {
        alert('Заполните все поля!');
        return;
    }

    currentUser = { name, age, gender, preferredGender, ageGroup };
    socket.emit('register', currentUser);

    document.getElementById('step1').classList.remove('active');
    document.getElementById('step2').classList.add('active');
});

socket.on('match_found', (matchedUser) => {
    partner = matchedUser;
    document.getElementById('partnerName').textContent = partner.name;
    loadMessageHistory();
});

socket.on('new_message', (message) => {
    appendMessage(message, false);
});

socket.on('new_voice_message', (message) => {
    appendVoiceMessage(message);
});

document.getElementById('btnSendText').addEventListener('click', () => {
    const textInput = document.getElementById('textInput');
    const content = textInput.value.trim();
    if (content && partner) {
        socket.emit('text_message', { receiverId: partner.socket_id, content });
        appendMessage({ content, is_audio: false }, true);
        textInput.value = '';
    }
});

document.getElementById('btnEndDialog').addEventListener('click', () => {
    if (confirm('Завершить диалог?')) {
        socket.emit('end_dialog');
        location.reload();
    }
});

function appendMessage(message, isSelf) {
    const div = document.createElement('div');
    div.className = `message ${isSelf ? 'self' : ''}`;
    div.textContent = message.content;
    document.getElementById('chatMessages').appendChild(div);
    scrollToBottom();
}

function appendVoiceMessage(message) {
    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML = `<i class="fas fa-volume-up"></i> Голосовое сообщение
                     <audio controls src="${message.audio_url}"></audio>`;
    document.getElementById('chatMessages').appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    const container = document.getElementById('chatMessages');
    container.scrollTop = container.scrollHeight;
}

async function loadMessageHistory(offset = 0) {
    // Загрузка истории сообщений с пагинацией
    // Реализация зависит от вашего API
}
