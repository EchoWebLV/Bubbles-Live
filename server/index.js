// Main server - runs Next.js + Socket.io + Game State
require('dotenv').config({ path: '.env.local' });

// Patch @solana/web3.js SendTransactionError BEFORE Anchor loads.
// Anchor 0.32 uses the old (message, logs) constructor but web3.js >=1.92
// expects ({ action, signature, transactionMessage, logs }).
const _web3 = require('@solana/web3.js');
const _OrigSTE = _web3.SendTransactionError;
_web3.SendTransactionError = class extends _OrigSTE {
  constructor(a, b) {
    if (typeof a === 'string') {
      super({ action: 'send', signature: '', transactionMessage: a, logs: b });
    } else {
      super(a, b);
    }
  }
};

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { GameState } = require('./gameState');
const { migrate } = require('./db');

const dev = process.env.NODE_ENV !== 'production';
const hostname = dev ? 'localhost' : '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

// ─── Security Limits ────────────────────────────────────────────────
const LIMITS = {
  maxConnections: 300,
  maxConnectionsPerIP: 10,
  maxDimensionWidth: 3840,
  maxDimensionHeight: 2160,
  // Per-socket rate limits: { max calls, per window (ms) }
  transaction: { max: 5, windowMs: 10000 },
  upgradeStat: { max: 3, windowMs: 15000 },
  allocateTalent: { max: 10, windowMs: 5000 },
  getOnchainStats: { max: 5, windowMs: 10000 },
  setDimensions: { max: 3, windowMs: 5000 },
};

// Per-IP connection tracking
const ipConnectionCount = new Map();

// Simple per-socket rate limiter
function createRateLimiter() {
  const buckets = new Map();
  return function check(socketId, event) {
    const limit = LIMITS[event];
    if (!limit) return true;
    const key = `${socketId}:${event}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start > limit.windowMs) {
      bucket = { count: 0, start: now };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > limit.max) return false;
    return true;
  };
}

// HTTP rate limiter for page requests (per IP)
const httpHits = new Map();
function httpRateLimit(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  const now = Date.now();
  let entry = httpHits.get(ip);
  if (!entry || now - entry.start > 60000) {
    entry = { count: 0, start: now };
    httpHits.set(ip, entry);
  }
  entry.count++;
  if (entry.count > 300) {
    res.writeHead(429, { 'Content-Type': 'text/plain' });
    res.end('Too many requests');
    return false;
  }
  return true;
}
// Cleanup stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, entry] of httpHits) {
    if (entry.start < cutoff) httpHits.delete(ip);
  }
}, 300000);

console.log('Initializing Next.js...');

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const gameState = new GameState();

app.prepare().then(async () => {
  console.log('Next.js ready, starting server...');
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'changeme';

  const httpServer = createServer(async (req, res) => {
    if (!httpRateLimit(req, res)) return;
    const parsedUrl = parse(req.url, true);

    if (req.method === 'POST' && parsedUrl.pathname === '/api/season-reset') {
      const authHeader = req.headers['authorization'] || '';
      if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      try {
        const result = await gameState.seasonReset();
        io.emit('seasonReset', { seasonId: gameState.seasonId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/api/admin/catch-up') {
      const authHeader = req.headers['authorization'] || '';
      if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      try {
        const boosted = gameState.catchUpLowLevelPlayers();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, boosted }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/api/admin/force-respawn') {
      const authHeader = req.headers['authorization'] || '';
      if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      try {
        const result = gameState.forceRespawnStuckPlayers();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/api/admin/remove-photo') {
      const authHeader = req.headers['authorization'] || '';
      if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { walletAddress } = JSON.parse(body);
          if (!walletAddress) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'walletAddress required' }));
            return;
          }
          gameState.removePlayerPhoto(walletAddress);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, walletAddress }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (parsedUrl.pathname === '/api/photos') {
      const photos = gameState.getPlayerPhotos();
      const body = JSON.stringify(photos);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
      });
      res.end(body);
      return;
    }

    handle(req, res, parsedUrl);
  });

  const allowedOrigins = dev
    ? ['http://localhost:3000']
    : [
        process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null,
        process.env.NEXT_PUBLIC_URL || null,
        'https://hodlwarz.com',
      ].filter(Boolean);

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 2e6,
    pingInterval: 25000,
    pingTimeout: 30000,
    perMessageDeflate: {
      threshold: 1024,
      zlibDeflateOptions: { level: 6 },
    },
  });

  let connectedClients = 0;
  const rateLimit = createRateLimiter();

  // Reject connections over the limit before they fully connect
  io.use((socket, next) => {
    const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || socket.handshake.address;
    const currentIPCount = ipConnectionCount.get(ip) || 0;

    if (connectedClients >= LIMITS.maxConnections) {
      return next(new Error('Server full'));
    }
    if (currentIPCount >= LIMITS.maxConnectionsPerIP) {
      return next(new Error('Too many connections from this IP'));
    }

    socket.clientIP = ip;
    ipConnectionCount.set(ip, currentIPCount + 1);
    next();
  });

  io.on('connection', (socket) => {
    connectedClients++;
    console.log(`Client connected (${socket.clientIP}). Total: ${connectedClients}`);

    socket.emit('gameState', gameState.getState());

    socket.on('setDimensions', (dimensions) => {
      if (!rateLimit(socket.id, 'setDimensions')) return;
      if (!dimensions || typeof dimensions.width !== 'number' || typeof dimensions.height !== 'number') return;

      const w = Math.min(Math.max(0, Math.round(dimensions.width)), LIMITS.maxDimensionWidth);
      const h = Math.min(Math.max(0, Math.round(dimensions.height)), LIMITS.maxDimensionHeight);

      if (w > gameState.dimensions.width || h > gameState.dimensions.height) {
        gameState.dimensions = {
          width: Math.max(w, gameState.dimensions.width),
          height: Math.max(h, gameState.dimensions.height),
        };
      }
    });

    socket.on('transaction', (event) => {
      if (!rateLimit(socket.id, 'transaction')) return;
      if (!event || typeof event !== 'object') return;
      if (event.signature && typeof event.signature !== 'string') return;
      gameState.handleTransaction(event);
    });

    socket.on('upgradeStat', async (data) => {
      if (!rateLimit(socket.id, 'upgradeStat')) {
        socket.emit('upgradeResult', { success: false, error: 'Rate limited' });
        return;
      }
      if (!data || typeof data.walletAddress !== 'string' || typeof data.statType !== 'number') {
        socket.emit('upgradeResult', { success: false, error: 'Invalid request' });
        return;
      }
      if (data.statType !== 0 && data.statType !== 1) {
        socket.emit('upgradeResult', { success: false, error: 'Invalid stat type' });
        return;
      }
      const { walletAddress, statType } = data;
      if (!gameState.magicBlockReady) {
        socket.emit('upgradeResult', { success: false, error: 'MagicBlock ER not ready' });
        return;
      }
      try {
        const success = await gameState.magicBlock.upgradeStat(walletAddress, statType);
        if (success) {
          const state = await gameState.magicBlock.getPlayerState(walletAddress);
          if (state) {
            gameState.playerCache.set(walletAddress, state);
            const bubble = gameState.battleBubbles.get(walletAddress);
            if (bubble) {
              bubble.healthLevel = state.healthLevel;
              bubble.attackLevel = state.attackLevel;
              bubble.attackPower = state.attackPower;
              bubble.maxHealth = state.maxHealth;
              bubble.xp = state.xp;
            }
          }
        }
        socket.emit('upgradeResult', { success });
      } catch (err) {
        socket.emit('upgradeResult', { success: false, error: err.message });
      }
    });

    socket.on('allocateTalent', (data) => {
      if (!rateLimit(socket.id, 'allocateTalent')) {
        socket.emit('talentResult', { success: false, error: 'Rate limited' });
        return;
      }
      if (!data || typeof data.walletAddress !== 'string' || typeof data.talentId !== 'string') {
        socket.emit('talentResult', { success: false, error: 'Invalid request' });
        return;
      }
      const result = gameState.allocateTalent(data.walletAddress, data.talentId);
      socket.emit('talentResult', result);
    });

    socket.on('resetTalents', (data) => {
      if (!rateLimit(socket.id, 'allocateTalent')) {
        socket.emit('talentResult', { success: false, error: 'Rate limited' });
        return;
      }
      if (!data || typeof data.walletAddress !== 'string') {
        socket.emit('talentResult', { success: false, error: 'Invalid request' });
        return;
      }
      const result = gameState.resetTalents(data.walletAddress);
      socket.emit('talentResult', result);
    });

    socket.on('getOnchainStats', async (data) => {
      if (!rateLimit(socket.id, 'getOnchainStats')) {
        socket.emit('onchainStats', null);
        return;
      }
      if (!data || typeof data.walletAddress !== 'string') {
        socket.emit('onchainStats', null);
        return;
      }
      if (!gameState.magicBlockReady) {
        socket.emit('onchainStats', null);
        return;
      }
      const stats = await gameState.magicBlock.getPlayerState(data.walletAddress);
      socket.emit('onchainStats', stats);
    });

    socket.on('uploadPhoto', (data) => {
      if (!data || typeof data.walletAddress !== 'string' || typeof data.photo !== 'string') {
        console.warn('Photo upload: invalid data');
        socket.emit('photoUploaded', { success: false });
        return;
      }
      console.log(`Photo upload from ${data.walletAddress.slice(0, 8)}... (${Math.round(data.photo.length / 1024)}KB)`);
      if (data.photo.length > 1400000) {
        console.warn('Photo upload: too large');
        socket.emit('photoUploaded', { success: false });
        return;
      }
      const ok = gameState.setPlayerPhoto(data.walletAddress, data.photo);
      if (ok) {
        console.log(`Photo saved for ${data.walletAddress.slice(0, 8)}...`);
        socket.emit('photoUploaded', { success: true });
      } else {
        console.warn(`Photo upload: setPlayerPhoto returned false for ${data.walletAddress.slice(0, 8)}...`);
        socket.emit('photoUploaded', { success: false });
      }
    });

    socket.on('removePhoto', (data) => {
      if (!data || typeof data.walletAddress !== 'string') return;
      gameState.removePlayerPhoto(data.walletAddress);
    });

    socket.on('joinAsGuest', () => {
      if (socket.guestAddress) {
        socket.emit('guestJoined', { success: false, error: 'Already a guest' });
        return;
      }
      const guestAddress = `guest_${socket.id.slice(0, 8)}_${Date.now()}`;
      const result = gameState.addGuest(guestAddress);
      if (result.success) {
        socket.guestAddress = guestAddress;
      }
      socket.emit('guestJoined', result);
    });

    socket.on('leaveGuest', () => {
      if (socket.guestAddress) {
        gameState.removeGuest(socket.guestAddress);
        socket.guestAddress = null;
        socket.emit('guestLeft', { success: true });
      }
    });

    socket.on('disconnect', () => {
      if (socket.guestAddress) {
        gameState.removeGuest(socket.guestAddress);
        socket.guestAddress = null;
      }
      connectedClients--;
      const ip = socket.clientIP;
      if (ip) {
        const count = (ipConnectionCount.get(ip) || 1) - 1;
        if (count <= 0) ipConnectionCount.delete(ip);
        else ipConnectionCount.set(ip, count);
      }
      console.log(`Client disconnected. Total: ${connectedClients}`);
    });
  });

  // Broadcast game state to all clients at 10fps (perMessageDeflate compresses the JSON)
  const broadcastInterval = setInterval(() => {
    if (connectedClients > 0) {
      io.emit('gameState', gameState.getState());
    }
  }, 100);

  await migrate();
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
║   HODLWARZ Server Running!                             ║
║                                                        ║
║   > Local:    http://${hostname}:${port}                     ║
║   > Mode:     ${dev ? 'Development' : 'Production'}                          ║
║   > Holders:  ${gameState.holders.length} loaded                            ║
║   > Max conn: ${LIMITS.maxConnections} (${LIMITS.maxConnectionsPerIP}/IP)                    ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
      `);
    });

  async function shutdown() {
    console.log('Shutting down...');
    clearInterval(broadcastInterval);
    await gameState.stop();
    httpServer.close();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

setInterval(() => {}, 1000 * 60 * 60);
