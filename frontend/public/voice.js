let mediaRecorder;
let audioChunks = [];

document.getElementById('btnRecordVoice').addEventListener('click', async () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.start();
        document.getElementById('btnRecordVoice').innerHTML = '<i class="fas fa-stop"></i>';
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            if (partner) {
                socket.emit('voice_message', { receiverId: partner.socket_id, audioBlob });
            }
            document.getElementById('btnRecordVoice').innerHTML = '<i class="fas fa-microphone"></i>';
        };
    } else {
        mediaRecorder.stop();
    }
});
