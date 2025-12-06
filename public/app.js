const socket = io();
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const username = urlParams.get('user');
const role = urlParams.get('role'); // 'teacher' or 'student'

if (!roomId || !username || !role) {
    alert('잘못된 접근입니다.');
    window.location.href = '/';
}

// DOM Elements
const mainVideo = document.getElementById('mainVideo');
const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const drawBtn = document.getElementById('drawBtn');
const clearBtn = document.getElementById('clearBtn');
const screenBtn = document.getElementById('screenBtn');
const micBtn = document.getElementById('micBtn');
const cameraBtn = document.getElementById('cameraBtn');
const inviteBtn = document.getElementById('inviteBtn');
const drawingTools = document.getElementById('drawingTools');
const eraserBtn = document.getElementById('eraserBtn');
const colorBtns = document.querySelectorAll('.color-btn');
const waitingList = document.getElementById('waitingList');
const waitingItems = document.getElementById('waitingItems');
const waitingScreen = document.getElementById('waitingScreen');

// State
let localStream;
let peers = {}; // socketId -> RTCPeerConnection
let isDrawing = false;
let isDrawingMode = false;
let lastX = 0;
let lastY = 0;
let currentColor = '#ef4444';
let isEraser = false;

// WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// --- Initialization ---
async function init() {
    // Resize canvas
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // UI Setup based on role
    if (role === 'teacher') {
        // Teacher joins immediately
        socket.emit('join-room', roomId, username, role);

        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            mainVideo.srcObject = localStream;
            mainVideo.muted = true; // Mute self
        } catch (e) {
            console.error('Error accessing media:', e);
            alert('카메라/마이크 접근 권한이 필요합니다.');
        }

        canvas.style.pointerEvents = 'none'; // Enable only when draw mode is on
    } else {
        // Student: Request to join
        waitingScreen.style.display = 'flex';
        socket.emit('request-join', roomId, username);

        // Student: Hide controls that are teacher-only
        screenBtn.style.display = 'none';
        drawBtn.style.display = 'none';
        clearBtn.style.display = 'none';
        inviteBtn.style.display = 'none';
        micBtn.style.display = 'none';
        cameraBtn.style.display = 'none';
        drawingTools.style.display = 'none';

        canvas.style.pointerEvents = 'none'; // Students never draw
    }
}

init();

// --- Socket Events ---

// Waiting Room (Teacher side)
socket.on('join-request', (data) => {
    if (role !== 'teacher') return;

    waitingList.style.display = 'block';
    const div = document.createElement('div');
    div.id = `wait-${data.socketId}`;
    div.style.background = '#27272a';
    div.style.padding = '0.5rem';
    div.style.borderRadius = '0.25rem';
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';

    div.innerHTML = `
        <span>${data.userId}</span>
        <button class="btn primary" style="width: auto; padding: 0.25rem 0.5rem; font-size: 0.75rem;">수락</button>
    `;

    div.querySelector('button').addEventListener('click', () => {
        socket.emit('approve-join', data.socketId);
        div.remove();
        if (waitingItems.children.length === 0) waitingList.style.display = 'none';
    });

    waitingItems.appendChild(div);
});

// Waiting Room (Student side)
socket.on('join-approved', async () => {
    waitingScreen.style.display = 'none';
    socket.emit('join-room', roomId, username, role);

    // Student initializes their media stream upon approval
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        // Don't show self on mainVideo initially, it will show teacher's stream
    } catch (e) {
        console.error('Error accessing media:', e);
        alert('카메라/마이크 접근 권한이 필요합니다.');
    }
});

socket.on('user-connected', (userId, userRole) => {
    addMessage('System', `${userId}님이 입장했습니다.`);
    if (role === 'teacher' && userRole === 'student') {
        // Teacher initiates connection to new student
        createPeerConnection(userId);
    }
});

socket.on('user-disconnected', (userId) => {
    addMessage('System', `${userId}님이 퇴장했습니다.`);
    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }
});

socket.on('chat-message', (data) => {
    addMessage(data.user, data.msg);
});

// WebRTC Signaling
socket.on('offer', async (payload) => {
    if (role === 'student') {
        const pc = new RTCPeerConnection(rtcConfig);
        peers[payload.caller] = pc;

        // Add student's local tracks to the connection
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { target: payload.caller, candidate: event.candidate });
            }
        };

        pc.ontrack = (event) => {
            mainVideo.srcObject = event.streams[0];
        };

        await pc.setRemoteDescription(payload.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('answer', { target: payload.caller, caller: socket.id, sdp: answer });
    }
});

socket.on('answer', async (payload) => {
    if (peers[payload.target]) {
        await peers[payload.target].setRemoteDescription(payload.sdp);
    }
});

socket.on('ice-candidate', (payload) => {
    if (peers[payload.caller]) {
        peers[payload.caller].addIceCandidate(new RTCIceCandidate(payload.candidate));
    }
});

// Drawing Events
socket.on('draw', (data) => {
    drawLine(data.x0, data.y0, data.x1, data.y1, data.color, data.isEraser, false);
});

socket.on('clear-canvas', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// --- Functions ---

function createPeerConnection(targetSocketId) {
    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetSocketId] = pc;

    // Add local tracks to peer
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: targetSocketId, candidate: event.candidate });
        }
    };

    pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socket.emit('offer', { target: targetSocketId, caller: socket.id, sdp: offer });
    });
}

// Chat
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const msg = chatInput.value;
    if (!msg) return;
    socket.emit('chat-message', roomId, { user: username, msg: msg });
    addMessage('나', msg);
    chatInput.value = '';
}

function addMessage(user, msg) {
    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML = `<div class="author">${user}</div>${msg}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Drawing
function resizeCanvas() {
    const rect = document.getElementById('videoArea').getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

function drawLine(x0, y0, x1, y1, color, eraser, emit) {
    ctx.beginPath();
    ctx.moveTo(x0 * canvas.width, y0 * canvas.height);
    ctx.lineTo(x1 * canvas.width, y1 * canvas.height);

    if (eraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 20;
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
    }

    ctx.stroke();
    ctx.closePath();

    if (emit) {
        socket.emit('draw', roomId, {
            x0: x0, y0: y0, x1: x1, y1: y1, color: color, isEraser: eraser
        });
    }
}

// Drawing Interaction (Teacher Only)
if (role === 'teacher') {
    canvas.addEventListener('mousedown', (e) => {
        if (!isDrawingMode) return;
        isDrawing = true;
        const rect = canvas.getBoundingClientRect();
        lastX = (e.clientX - rect.left) / canvas.width;
        lastY = (e.clientY - rect.top) / canvas.height;
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing || !isDrawingMode) return;
        const rect = canvas.getBoundingClientRect();
        const currentX = (e.clientX - rect.left) / canvas.width;
        const currentY = (e.clientY - rect.top) / canvas.height;

        drawLine(lastX, lastY, currentX, currentY, currentColor, isEraser, true);
        lastX = currentX;
        lastY = currentY;
    });

    canvas.addEventListener('mouseup', () => isDrawing = false);
    canvas.addEventListener('mouseout', () => isDrawing = false);

    // Controls
    drawBtn.addEventListener('click', () => {
        isDrawingMode = !isDrawingMode;
        drawBtn.classList.toggle('active', isDrawingMode);
        canvas.style.pointerEvents = isDrawingMode ? 'auto' : 'none';
        drawingTools.style.display = isDrawingMode ? 'flex' : 'none';
    });

    // Color Selection
    colorBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            isEraser = false;
            currentColor = e.target.dataset.color;

            // Visual feedback
            colorBtns.forEach(b => b.style.border = 'none');
            eraserBtn.classList.remove('active');
            e.target.style.border = '2px solid white';
        });
    });

    eraserBtn.addEventListener('click', () => {
        isEraser = true;
        colorBtns.forEach(b => b.style.border = 'none');
        eraserBtn.classList.add('active');
    });

    clearBtn.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        socket.emit('clear-canvas', roomId);
    });

    screenBtn.addEventListener('click', async () => {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const videoTrack = screenStream.getVideoTracks()[0];

            // Replace track in local stream
            const sender = localStream.getVideoTracks()[0];
            localStream.removeTrack(sender);
            localStream.addTrack(videoTrack);
            mainVideo.srcObject = localStream;

            // Replace track in all peer connections
            for (let id in peers) {
                const pc = peers[id];
                const sender = pc.getSenders().find(s => s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            }

            videoTrack.onended = () => {
                alert('화면 공유가 종료되었습니다.');
            };
        } catch (e) {
            console.error(e);
        }
    });

    inviteBtn.addEventListener('click', async () => {
        const inviteUrl = `${window.location.origin}/?room=${encodeURIComponent(roomId)}`;

        try {
            // Try modern clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(inviteUrl);
                alert('✅ 초대 링크가 복사되었습니다!\n\n' + inviteUrl);
            } else {
                // Fallback for older browsers
                showCopyPrompt(inviteUrl);
            }
        } catch (err) {
            console.error('Clipboard error:', err);
            // Fallback if permission denied
            showCopyPrompt(inviteUrl);
        }
    });

    function showCopyPrompt(url) {
        const result = prompt('초대 링크를 Ctrl+C로 복사하세요:', url);
        if (result) {
            alert('링크를 공유하세요: ' + url);
        }
    }

    // Media Toggles
    micBtn.addEventListener('click', () => {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            micBtn.classList.toggle('active', !audioTrack.enabled); // Active means "Muted" visually? Or "On"?
            // Let's say active = ON. Default is ON.
            // Actually, let's toggle "danger" class for OFF
            micBtn.classList.toggle('danger', !audioTrack.enabled);
        }
    });

    cameraBtn.addEventListener('click', () => {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            cameraBtn.classList.toggle('danger', !videoTrack.enabled);
        }
    });
}
