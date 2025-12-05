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

// Track users in rooms
const rooms = {}; // roomId -> [{ socketId, userId }]

// Socket.io Logic
io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

          socket.on('join-room', (roomId, userId, role) => {
                      socket.join(roomId);

                            // Initialize room if it doesn't exist
                            if (!rooms[roomId]) {
                                            rooms[roomId] = [];
                            }

                            // Get existing users in the room BEFORE adding new user
                            const existingUsers = rooms[roomId].map(user => ({
                                            socketId: user.socketId,
                                            userId: user.userId
                            }));

                            // Add new user to room
                            rooms[roomId].push({ socketId: socket.id, userId });

                            // Send existing users to the newly joined user
                            socket.emit('existing-users', existingUsers);

                            // Notify others about new user
                            socket.to(roomId).emit('user-connected', socket.id, userId);

                            socket.on('disconnect', () => {
                                            socket.to(roomId).emit('user-disconnected', socket.id);
                                            // Remove user from room tracking
                                                  if (rooms[roomId]) {
                                                                      rooms[roomId] = rooms[roomId].filter(user => user.socketId !== socket.id);
                                                                      if (rooms[roomId].length === 0) {
                                                                                              delete rooms[roomId];
                                                                      }
                                                  }
                            });
          });

      
