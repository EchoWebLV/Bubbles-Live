# $WARZ

The first real-time battle royale where every action lives on the blockchain. Buy the token, your wallet enters the arena and fights automatically. Every kill, death, and respawn is recorded on Solana.

**Live:** [warz.live](https://warz.live)

## How It Works

1. **Buy the token** — hold at least 0.1% of the supply
2. **Your wallet spawns** as a bubble in the arena automatically
3. **Auto-combat** — bubbles shoot at the nearest enemy in real time
4. **Earn XP** from kills, transactions, and holding
5. **Upgrade on-chain** — spend XP to increase health and attack power
6. **Sell your bag?** Your bubble vanishes instantly

All combat state (health, damage, kills, deaths, respawns, upgrades) is processed through [MagicBlock Ephemeral Rollups](https://magicblock.gg/) on Solana with sub-second finality. Every event is verifiable on-chain via Solana Explorer.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                │
│  React + Canvas rendering + Socket.io client        │
│  Wallet adapter for Solana (Phantom, Solflare, etc) │
└──────────────────────┬──────────────────────────────┘
                       │ WebSocket
┌──────────────────────▼──────────────────────────────┐
│                 Game Server (Node.js)                │
│  Physics engine · Damage aggregation · State sync   │
│  Helius WebSocket for real-time token transactions   │
└──────┬───────────────────────────────────┬──────────┘
       │                                   │
┌──────▼──────────┐              ┌─────────▼──────────┐
│   Solana Devnet  │              │  MagicBlock ER     │
│   (base layer)   │◄────────────►│  (ephemeral rollup)│
│   Registration   │  delegate/   │  Combat processing │
│   Delegation     │  commit      │  Sub-second TXs    │
└─────────────────┘              └────────────────────┘
```

### On-Chain Programs

**Combat Program** (`hodlwarz_combat`) — Anchor + MagicBlock Ephemeral Rollups SDK

- `init_arena` — initialize the arena on base layer
- `register_player` — register a wallet as a fighter (PDA per player)
- `delegate_arena` / `delegate_player` — delegate accounts to the ephemeral rollup
- `process_attack` — deal damage to a victim, handles death detection and XP rewards
- `respawn_player` — respawn after death cooldown
- `upgrade_stat` — spend XP to upgrade health or attack power
- `commit_player` / `commit_arena` — commit state back to base layer

**Bolt ECS Programs** (`onchain/programs-ecs/`) — component/system architecture

- Components: `player-stats`, `position`
- Systems: `init-player`, `movement`, `record-kill`, `upgrade-stat`

### Server

| File | Purpose |
|------|---------|
| `server/index.js` | Express + Socket.io server, serves Next.js and game state |
| `server/gameState.js` | Physics engine, collision detection, damage aggregation, holder tracking |
| `server/magicblock.js` | Solana/MagicBlock integration — registration, delegation, attacks, events |
| `server/playerStore.js` | Persistent player data storage |
| `server/db.js` | PostgreSQL connection for persistence |

### Frontend

| Path | Purpose |
|------|---------|
| `src/components/bubble-map/BubbleCanvas.tsx` | Canvas renderer for bubbles, bullets, effects |
| `src/components/bubble-map/BubbleMapClient.tsx` | Main game UI — HUD, panels, controls |
| `src/components/WelcomeModal.tsx` | First-visit intro modal |
| `src/hooks/useGameSocket.ts` | Socket.io hook for real-time game state |
| `src/hooks/useHolderWebSocket.ts` | Helius WebSocket for live token transactions |

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS, Framer Motion, D3.js
- **Backend:** Node.js, Socket.io, Express
- **Blockchain:** Solana (devnet), Anchor framework, MagicBlock Ephemeral Rollups, Bolt ECS
- **Wallet:** Solana Wallet Adapter (Phantom, Solflare, etc.)
- **Data:** Helius API for token holder data and real-time transactions
- **Infra:** Railway, Docker

## Getting Started

### Prerequisites

- Node.js >= 20
- PostgreSQL (for persistence)
- Solana CLI + keypair at `~/.config/solana/id.json`

### Setup

```bash
git clone https://github.com/your-repo/Bubbles-Live.git
cd Bubbles-Live
npm install
```

Create `.env.local`:

```env
HELIUS_API_KEY=your_helius_api_key
NEXT_PUBLIC_HELIUS_API_KEY=your_helius_api_key
NEXT_PUBLIC_TOKEN_ADDRESS=your_token_mint_address
MAX_HOLDERS_DISPLAY=500
MIN_HOLDER_PERCENTAGE=0.1
REFRESH_INTERVAL_MS=30000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bubbles_live
ANCHOR_WALLET=/path/to/your/solana/keypair.json
```

### Run

```bash
# Development
npm run dev

# Production build
npm run build
npm start
```

The server starts on port 3000 — serves both the Next.js frontend and the Socket.io game server.

### Docker

```bash
docker build -t warz .
docker run -p 3000:3000 --env-file .env.local warz
```

### Deploy to Railway

```bash
railway up
```

## On-Chain Details

- **Program ID:** `HF3168cAegsoUzqaNTET2Jw5HQYwNpHwA1tFBuAepgio`
- **Network:** Solana Devnet
- **Ephemeral Rollup:** MagicBlock (`devnet.magicblock.app`)
- **Damage Scale:** 100x (local 0.1 dmg = 10 on-chain)
- **Base Health:** 100 HP
- **Base Attack:** 10 (0.1 local)
- **XP per Kill:** 25
- **Respawn Delay:** 5 seconds
- **Max Level:** 20

## License

MIT
