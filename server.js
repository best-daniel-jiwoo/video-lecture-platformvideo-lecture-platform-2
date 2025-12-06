const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// Socket.io Logic
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (roomId, userId, role) => {
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', userId, role);

        socket.on('disconnect', () => {
            socket.to(roomId).emit('user-disconnected', userId);
        });
    });

    // Waiting Room Logic
    socket.on('request-join', (roomId, userId) => {
        socket.to(roomId).emit('join-request', { socketId: socket.id, userId: userId });
    });

    socket.on('approve-join', (targetSocketId) => {
        io.to(targetSocketId).emit('join-approved');
    });

    // WebRTC Signaling
    socket.on('offer', (payload) => {
        io.to(payload.target).emit('offer', payload);
    });

    socket.on('answer', (payload) => {
        io.to(payload.target).emit('answer', {
            target: payload.caller,
            sdp: payload.sdp
        });
    });

    socket.on('ice-candidate', (payload) => {
        io.to(payload.target).emit('ice-candidate', payload);
    });

    // Chat
    socket.on('chat-message', (roomId, message) => {
        socket.to(roomId).emit('chat-message', message);
    });

    // Whiteboard
    socket.on('draw', (roomId, data) => {
        socket.to(roomId).emit('draw', data);
    });

    socket.on('clear-canvas', (roomId) => {
        socket.to(roomId).emit('clear-canvas');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port ' + PORT);
    console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
});
