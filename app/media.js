import app from './main.js';

export function initializeMedia(appInstance) {
    const recordButton = document.getElementById('record-audio');
    const recordingIndicator = document.getElementById('recording-indicator');
    const stopRecordingButton = document.getElementById('stop-recording');
    const recordingTimer = document.getElementById('recording-timer');
    
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingStartTime = null;
    let recordingTimerInterval = null;
    let stream = null;
    
    recordButton.addEventListener('click', async () => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });
            
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus',
                audioBitsPerSecond: 128000
            });
            
            audioChunks = [];
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                sendAudioMessage(audioBlob);
                
                // Останавливаем все треки
                stream.getTracks().forEach(track => track.stop());
            };
            
            mediaRecorder.start();
            
            // Показываем индикатор записи
            recordingIndicator.style.display = 'flex';
            recordButton.style.display = 'none';
            
            // Запускаем таймер
            recordingStartTime = Date.now();
            updateRecordingTimer();
            recordingTimerInterval = setInterval(updateRecordingTimer, 1000);
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Не удалось получить доступ к микрофону');
        }
    });
    
    stopRecordingButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            
            // Скрываем индикатор
            recordingIndicator.style.display = 'none';
            recordButton.style.display = 'flex';
            
            // Очищаем таймер
            clearInterval(recordingTimerInterval);
            recordingTimer.textContent = '0:00';
        }
    });
    
    function updateRecordingTimer() {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        recordingTimer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        
        // Автоматическое завершение через 2 минуты
        if (elapsed >= 120) {
            stopRecordingButton.click();
        }
    }
    
    function sendAudioMessage(audioBlob) {
        if (!appInstance.roomId) return;
        
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        
        reader.onloadend = () => {
            const base64Audio = reader.result;
            const duration = (Date.now() - recordingStartTime) / 1000;
            
            appInstance.socket.emit('send_audio', {
                roomId: appInstance.roomId,
                audioData: base64Audio,
                duration,
                timestamp: Date.now()
            });
        };
    }
    
    // Автоматическая остановка при покидании страницы
    window.addEventListener('beforeunload', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    });
}
