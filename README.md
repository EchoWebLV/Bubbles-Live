# WARZ

A real-time multiplayer battle royale running on Solana through MagicBlock Ephemeral Rollups.

This is not a blockchain game from 2022. There is no "click button, wait for transaction, see result." There are 60+ players shooting at each other in real time, and the chain is computing every point of damage, every kill, every level-up, every talent interaction — live, while you play.

**Live at** [hodlwarz.com](https://hodlwarz.com)

---

## What is this

You buy the token. Your wallet spawns as a bubble in an arena. You fight other holders automatically. Kills earn XP. XP unlocks a 25-talent skill tree across 5 specialization paths. Sell your tokens and your bubble vanishes instantly.

The interesting part is where the combat math happens.

## Why this exists

Most "on-chain games" do one of two things: they either run everything on-chain and the gameplay suffers (click, wait 2 seconds, see result), or they run everything on a server and log receipts to a chain so they can call it web3.

We wanted to see if MagicBlock's Ephemeral Rollups could handle something that actually needs speed — a real-time shooter with dozens of concurrent players, complex damage formulas, and a deep talent system. Not a turn-based card game. Not an idle clicker. A game where bullets are flying every frame.

It works.

## How the chain fits in

The game server handles what servers are good at: physics simulation, collision detection, targeting AI, projectile trajectories, visual effects. It runs at 60fps and broadcasts state to clients 10 times per second over WebSocket.

The Ephemeral Rollup handles what chains are good at: being the single source of truth that nobody can tamper with.

When a bullet hits a player, the server does not compute damage. It counts how many bullets connected and sends that number to the ER. The on-chain program looks up both players' talent states, computes damage per hit using the full formula (base attack, Heavy Hitter bonus, Berserker low-HP bonus, Vitality Strike scaling, Critical Strike expected value, Execute threshold damage, minus the victim's Armor reduction), applies it, checks if the victim died, awards XP if they did (scaled by victim level, with a 2x bounty for high-level kills), applies the Experience talent bonus, auto-levels the attacker, and updates the arena kill counter.

The server physically cannot say "this hit did 500 damage." It can only say "3 bullets hit." The chain decides how much that hurts.

Every player account is a PDA on Solana, delegated to the Ephemeral Rollup for fast execution. State gets committed back to the base layer periodically, so everything is anchored to Solana L1.

## What runs on-chain

All of this executes inside the ER, not on the server:

**Combat resolution** — Damage per hit is computed from on-chain talent state. The full damage pipeline runs in Rust: base attack power, offensive talent modifiers (Heavy Hitter, Berserker, Vitality Strike, Critical Strike, Execute), defensive modifiers (Armor), damage caps. A single `process_attack` instruction handles hit count to kill confirmation in one transaction.

**XP and leveling** — Kill XP scales with the victim's level. High-level kills (50+) pay double. The Experience talent multiplies XP gains. Leveling follows a curve that gets steeper after level 50. All of this math lives on-chain.

**Talent validation** — 25 talents across 5 trees (Tank, Firepower, Brawler, Mass Damage, Blood Thirst), each with prerequisites, max ranks, and a capstone limit (you can only pick 2 of the 5 capstone talents). The chain validates every allocation: checks your level, checks your available points, checks the prerequisite chain, checks the capstone budget. The server cannot grant talents that haven't been earned.

**Kill and death tracking** — When the chain determines a victim's HP hit zero, it increments kill/death counters, sets respawn timers, awards XP. These numbers are the ground truth. The server reads them back.

**Player state** — HP, max HP, attack power, XP, kills, deaths, all 25 talent ranks, alive/dead status, respawn timers. Every player's full state lives in a PDA on the ER.

**Arena state** — Global kill counter, active status, authority. The arena PDA tracks aggregate stats across all players.

**Delegation and commits** — Player accounts get delegated from Solana devnet to the ER for fast execution. The server periodically commits all state back to the base layer, so nothing is lost if the ER session ends.

## Architecture

```
Frontend (Next.js + Canvas)
     |
     | WebSocket (Socket.io, 10fps)
     |
Game Server (Node.js, 60fps physics)
     |
     |--- hit count ---> Ephemeral Rollup (MagicBlock)
     |                        |
     |<-- state reads --------| damage, XP, kills, levels, talents
     |
     |--- commit -----------> Solana Devnet (base layer)
```

The server sends hit counts to the ER. The ER computes outcomes. The server reads back the results. Periodically, everything gets committed to Solana L1. Players connect wallets (Phantom, Solflare, etc.) or play as guests.

## The talent system

Five trees, each with 4 regular talents and 1 capstone. You unlock 1 talent point at level 1, then every 2 levels. Max 2 capstones.

**Tank** — Armor (damage reduction), Iron Skin (max HP), Regeneration, Lifesteal, Vitality Strike (capstone: bonus damage from max HP)

**Firepower** — Heavy Hitter (raw damage), Rapid Fire, Critical Strike (chance + multiplier), Multi Shot, Homing Cannon (capstone)

**Brawler** — Dash, Body Slam, Pinball, Orbit, Shockwave (capstone)

**Mass Damage** — Ricochet, Counter Attack, Focus Fire, Nova, Chain Lightning (capstone)

**Blood Thirst** — Experience (XP bonus), Execute (bonus vs low HP), Kill Rush, Reaper's Arc, Berserker (capstone: damage boost below 33% HP)

The on-chain program validates every talent allocation against prerequisites, rank caps, point budgets, and capstone limits. The damage formula references talent ranks directly from the player's PDA.

## Seasons and rewards

Seasons run on a 3–4 day cycle. At the end of each season, the top 10 players on the leaderboard are rewarded with an airdrop. 10% of the token supply was vested specifically for player rewards, and all fees generated by the token go directly back to players. Play well, rank high, get paid.

## On-chain program

**Program:** `hodlwarz_combat` (Anchor + MagicBlock Ephemeral Rollups SDK)

**Instructions:**

| Instruction | What it does |
|---|---|
| `init_arena` | Initialize the arena PDA on base layer |
| `register_player` | Create a player PDA for a wallet |
| `delegate_arena` / `delegate_player` | Delegate accounts to the Ephemeral Rollup |
| `process_attack(hit_count)` | Compute damage from talent state, apply it, handle kills, award XP, auto-level |
| `respawn_player` | Respawn after death cooldown (5s) |
| `upgrade_stat(stat_type)` | Spend XP to upgrade health or attack |
| `allocate_talent(talent_id)` | Allocate a talent point with full validation |
| `reset_talents` | Respec all talent points |
| `commit_state` / `commit_player` | Commit ER state back to Solana base layer |
| `end_session` | Commit and undelegate all accounts |

**On-chain constants:**

| Constant | Value |
|---|---|
| Base health | 100 HP |
| Base attack | 10 (0.1 game-damage, 100x scale) |
| Damage cap | 500 (5.0 game-damage per hit) |
| XP per kill | 10 base + 3 per victim level |
| XP per death | 5 (consolation) |
| Kill bounty (lvl 50+) | 2x XP |
| Max level | 100 |
| Max talents | 25 slots, 50 total points |
| Respawn delay | 5 seconds |

## Tech stack

- **Frontend:** Next.js, React, TypeScript, Canvas rendering, Tailwind, Framer Motion
- **Backend:** Node.js, Express, Socket.io
- **Chain:** Solana devnet, Anchor, MagicBlock Ephemeral Rollups SDK
- **Wallets:** Solana Wallet Adapter (Phantom, Solflare, etc.)
- **Data:** Helius API for token holder tracking and live transactions
- **Infra:** Railway

## Running locally

Requires Node.js 20+, PostgreSQL, Solana CLI with a funded devnet keypair.

```bash
git clone https://github.com/your-repo/Bubbles-Live.git
cd Bubbles-Live
npm install
```

Create `.env.local`:

```
HELIUS_API_KEY=your_key
NEXT_PUBLIC_HELIUS_API_KEY=your_key
NEXT_PUBLIC_TOKEN_ADDRESS=your_token_mint
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bubbles_live
ANCHOR_WALLET=/path/to/keypair.json
COMBAT_PROGRAM_ID=your_program_id
```

```bash
npm run dev
```

Server starts on port 3000, serving both the Next.js frontend and the game server.

## Building the program

```bash
cd combat/hodlwarz_combat
anchor build
solana program deploy target/deploy/hodlwarz_combat.so --program-id dev-program-keypair.json --url devnet
cp target/idl/hodlwarz_combat.json ../../server/hodlwarz_combat.json
```

## License

MIT
