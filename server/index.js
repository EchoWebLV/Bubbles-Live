// Main server - runs Next.js + Socket.io + Game State
require('dotenv').config({ path: '.env.local' });

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { GameState } = require('./gameState');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

console.log('Initializing Next.js...');

// Initialize Next.js
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Initialize game state
const gameState = new GameState();

app.prepare().then(() => {
  console.log('Next.js ready, starting server...');
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // Initialize Socket.io
  const io = new Server(httpServer, {
    cors: {
      origin: dev ? 'http://localhost:3000' : process.env.NEXT_PUBLIC_URL,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // Track connected clients
  let connectedClients = 0;

  io.on('connection', (socket) => {
    connectedClients++;
    console.log(`Client connected. Total: ${connectedClients}`);

    // Send initial state immediately
    socket.emit('gameState', gameState.getState());

    // Handle client dimension updates (use largest client's dimensions)
    socket.on('setDimensions', (dimensions) => {
      if (dimensions.width > gameState.dimensions.width || 
          dimensions.height > gameState.dimensions.height) {
        gameState.dimensions = {
          width: Math.max(dimensions.width, gameState.dimensions.width),
          height: Math.max(dimensions.height, gameState.dimensions.height),
        };
      }
    });

    // Handle transaction events from Helius WebSocket - triggers live refresh
    socket.on('transaction', (event) => {
      gameState.handleTransaction(event);
    });

    socket.on('disconnect', () => {
      connectedClients--;
      console.log(`Client disconnected. Total: ${connectedClients}`);
    });
  });

  // Broadcast game state to all clients at 30fps
  const broadcastInterval = setInterval(() => {
    if (connectedClients > 0) {
      io.emit('gameState', gameState.getState());
    }
  }, 1000 / 30);

  // Start the game state (runs continuously)
  gameState.start();

  httpServer
    .once('error', (err) => {
      console.error('Server error:', err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🎮 Bubble Battle Server Running!                     ║
║                                                        ║
║   > Local:    http://${hostname}:${port}                     ║
║   > Mode:     ${dev ? 'Development' : 'Production'}                          ║
║   > Holders:  ${gameState.holders.length} loaded                            ║
║                                                        ║
║   Game is running continuously.                        ║
║   All clients see the same state!                      ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
      `);
    });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('Shutting down...');
    clearInterval(broadcastInterval);
    gameState.stop();
    httpServer.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('Shutting down...');
    clearInterval(broadcastInterval);
    gameState.stop();
    httpServer.close();
    process.exit(0);
  });
}).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Keep the process alive
setInterval(() => {}, 1000 * 60 * 60);
