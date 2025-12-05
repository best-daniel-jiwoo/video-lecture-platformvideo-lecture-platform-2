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
const localVideo = document.getElementById('localVideo');
const videoGrid = document.getElementById('videoGrid');
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
let peers = {}; // socketId -> { pc: RTCPeerConnection, videoContainer: HTMLDivElement }
let isDrawing = false;
let isDrawingMode = false;
let lastX = 0;
let lastY = 0;
let currentColor = '#ef4444';
let isEraser = false;
let isScreenSharing = false;
let pipThumbnailsContainer = null;

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
            localVideo.srcObject = localStream;
        } catch (e) {
            console.error('Error accessing media:', e);
            alert('카메라/마이크 접근 권한이 필요합니다.');
        }

        canvas.style.pointerEvents = 'none'; // Enable only when draw mode is on
    } else {
        // Student: Request to join
        waitingScreen.style.display = 'flex';
        socket.emit('request-join', roomId, username);

        // Student: Hide teacher-only controls
        screenBtn.style.display = 'none';
        drawBtn.style.display = 'none';
        clearBtn.style.display = 'none';
        inviteBtn.style.display = 'none';
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

    // Student: Get media access after approval
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (e) {
        console.error('Error accessing media:', e);
        alert('카메라/마이크 접근 권한이 필요합니다.');
    }

    socket.emit('join-room', roomId, username, role);
});

// Handle existing users in room (sent when you join)
socket.on('existing-users', (users) => {
    console.log('Existing users in room:', users);
    // Create peer connections to all existing users
    users.forEach(user => {
        createPeerConnection(user.socketId, user.userId);
    });
});

socket.on('user-connected', (socketId, userName) => {
    addMessage('System', `${userName}님이 입장했습니다.`);
    // Create peer connection
    createPeerConnection(socketId, userName);
});

socket.on('user-disconnected', (socketId) => {
    addMessage('System', '참가자가 퇴장했습니다.');
    if (peers[socketId]) {
        // Remove video container
        if (peers[socketId].videoContainer) {
            peers[socketId].videoContainer.remove();
        }
        // Close peer connection
        peers[socketId].pc.close();
        delete peers[socketId];
    }
});

socket.on('chat-message', (data) => {
    addMessage(data.user, data.msg);
});

// WebRTC Signaling
socket.on('offer', async (payload) => {
    const pc = new RTCPeerConnection(rtcConfig);
    peers[payload.caller] = { pc, videoContainer: null };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: payload.caller, candidate: event.candidate });
        }
    };

    pc.ontrack = (event) => {
        // Create video element for remote stream
        if (!peers[payload.caller].videoContainer) {
            peers[payload.caller].videoContainer = createVideoElement(payload.caller, payload.callerName || 'Remote');
        }
        const video = peers[payload.caller].videoContainer.querySelector('video');
        video.srcObject = event.streams[0];
    };

    // Add local stream to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    await pc.setRemoteDescription(payload.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('answer', { target: payload.caller, sdp: answer });
});

socket.on('answer', (payload) => {
    if (peers[payload.caller]) {
        peers[payload.caller].pc.setRemoteDescription(payload.sdp);
    }
});

socket.on('ice-candidate', (payload) => {
    if (peers[payload.caller]) {
        peers[payload.caller].pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
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

function createPeerConnection(targetSocketId, targetName) {
    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetSocketId] = { pc, videoContainer: null };

    // Add local tracks to peer
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: targetSocketId, candidate: event.candidate });
        }
    };

    pc.ontrack = (event) => {
        // Create video element for remote stream
        if (!peers[targetSocketId].videoContainer) {
            peers[targetSocketId].videoContainer = createVideoElement(targetSocketId, targetName);
        }
        const video = peers[targetSocketId].videoContainer.querySelector('video');
        video.srcObject = event.streams[0];
    };

    pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socket.emit('offer', { target: targetSocketId, caller: socket.id, callerName: username, sdp: offer });
    });
}

function createVideoElement(socketId, userName) {
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    videoContainer.id = `video-${socketId}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsinline = true;
    video.muted = false; // Remote videos should NOT be muted

    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = userName;

    videoContainer.appendChild(video);
    videoContainer.appendChild(label);
    videoGrid.appendChild(videoContainer);

    return videoContainer;
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
            const screenTrack = screenStream.getVideoTracks()[0];

            // Replace track in local video
            const videoTrack = localStream.getVideoTracks()[0];
            localStream.removeTrack(videoTrack);
            localStream.addTrack(screenTrack);
            localVideo.srcObject = localStream;

            // Mark local video as screen share
            document.getElementById('localVideoContainer').classList.add('is-screen-share');

            // Replace track in all peer connections
            for (let id in peers) {
                const pc = peers[id].pc;
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack);
                }
            }

            // Enable PIP mode
            isScreenSharing = true;
            enablePIPMode();

            screenTrack.onended = () => {
                isScreenSharing = false;
                disablePIPMode();
                document.getElementById('localVideoContainer').classList.remove('is-screen-share');
            };
        } catch (e) {
            console.error(e);
        }
    });

    inviteBtn.addEventListener('click', async () => {
        const inviteUrl = `${window.location.origin}/?room=${encodeURIComponent(roomId)}`;

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(inviteUrl);
                alert('✅ 초대 링크가 복사되었습니다!\n\n' + inviteUrl);
            } else {
                showCopyPrompt(inviteUrl);
            }
        } catch (err) {
            console.error('Clipboard error:', err);
            showCopyPrompt(inviteUrl);
        }
    });

    function showCopyPrompt(url) {
        alert('📋 초대 링크 (복사해서 공유하세요):\n\n' + url);
    }

    // Media Toggles
    micBtn.addEventListener('click', () => {
        if (!localStream) return;
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            micBtn.classList.toggle('danger', !audioTrack.enabled);
        }
    });

    cameraBtn.addEventListener('click', () => {
        if (!localStream) return;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            cameraBtn.classList.toggle('danger', !videoTrack.enabled);
        }
    });
}

// PIP Mode Functions
function enablePIPMode() {
    const videoArea = document.getElementById('videoArea');
    videoArea.classList.add('screen-share-mode');

    // Create thumbnails container
    pipThumbnailsContainer = document.createElement('div');
    pipThumbnailsContainer.className = 'pip-thumbnails';
    videoArea.appendChild(pipThumbnailsContainer);

    // Move all non-screen-share videos to thumbnails
    const allVideos = videoGrid.querySelectorAll('.video-container:not(.is-screen-share)');
    allVideos.forEach(container => {
        pipThumbnailsContainer.appendChild(container);
        makeDraggable(container);
    });
}

function disablePIPMode() {
    const videoArea = document.getElementById('videoArea');
    videoArea.classList.remove('screen-share-mode');

    if (pipThumbnailsContainer) {
        // Move all thumbnails back to grid
        const thumbnails = pipThumbnailsContainer.querySelectorAll('.video-container');
        thumbnails.forEach(container => {
            container.style.transform = '';
            container.style.position = '';
            videoGrid.appendChild(container);
        });
        pipThumbnailsContainer.remove();
        pipThumbnailsContainer = null;
    }
}

function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    element.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
        element.classList.add('dragging');
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        element.style.position = 'absolute';
        element.style.top = (element.offsetTop - pos2) + 'px';
        element.style.left = (element.offsetLeft - pos1) + 'px';
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        element.classList.remove('dragging');
    }
}

// Media Toggles for Students
if (role === 'student') {
    micBtn.addEventListener('click', () => {
        if (!localStream) return;
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            micBtn.classList.toggle('danger', !audioTrack.enabled);
        }
    });

    cameraBtn.addEventListener('click', () => {
        if (!localStream) return;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            cameraBtn.classList.toggle('danger', !videoTrack.enabled);
        }
    });
}
