use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};

declare_id!("8rSofJ1enam27SS3btJQAefNQGhUWue8vMMZeUiXscie");

const ARENA_SEED: &[u8] = b"arena";
const PLAYER_SEED: &[u8] = b"player_v2";

const BASE_HEALTH: u16 = 100;
const BASE_ATTACK: u16 = 10; // 0.1 * DAMAGE_SCALE(100)
const LEVEL_SCALE: u64 = 10;
const MAX_LEVEL: u8 = 100;
const RESPAWN_DELAY_SECS: i64 = 5;
const DAMAGE_CAP: u32 = 500; // 5.0 * 100

const XP_PER_KILL_BASE: u64 = 10;
const XP_PER_KILL_PER_LEVEL: u64 = 3;
const XP_PER_DEATH: u64 = 5;

const MAX_TALENT_RANK_TIER1_4: u8 = 5;
const MAX_TALENT_RANK_CAPSTONE: u8 = 3;

fn max_rank_for_talent(talent_id: u8) -> u8 {
    match talent_id {
        // Capstones: slots 4, 9, 14, 17, 24
        4 | 9 | 14 | 17 | 24 => MAX_TALENT_RANK_CAPSTONE,
        0..=24 => MAX_TALENT_RANK_TIER1_4,
        _ => 0,
    }
}

// ─── Talent lookup tables (basis points, x/10000) ────────────────────────────
//
// On-chain field → game talent mapping:
//   slot 0  talent_iron_skin       → Armor         (Tank T1)
//   slot 1  talent_heavy_hitter    → Iron Skin     (Tank T2)
//   slot 2  talent_regeneration    → Regeneration  (Tank T3)
//   slot 3  talent_lifesteal       → Lifesteal     (Tank T4)
//   slot 4  talent_armor           → Vitality Strike (Tank T5 capstone)
//   slot 5  talent_swift           → Heavy Hitter  (Firepower T1)
//   slot 6  talent_rapid_fire      → Rapid Fire    (Firepower T2)
//   slot 7  talent_evasion         → Critical Strike (Firepower T3)
//   slot 8  talent_quick_respawn   → Multi Shot    (Firepower T4)
//   slot 9  talent_momentum        → Homing Cannon (Firepower T5 capstone)
//   slot 10 talent_weakspot        → Dash          (Brawler T1)
//   slot 11 talent_critical_strike → Body Slam     (Brawler T2)
//   slot 12 talent_focus_fire      → Pinball       (Brawler T3)
//   slot 13 talent_multi_shot      → Orbit         (Brawler T4)
//   slot 14 talent_dual_cannon     → Shockwave     (Brawler T5 capstone)
//   slot 15 talent_deflect         → Ricochet      (MassDmg T1)
//   slot 16 talent_absorb          → Counter Attack(MassDmg T2)
//   slot 17 talent_last_stand      → Chain Lightning(MassDmg T5 capstone)
//   slot 18 talent_cloak           → Nova          (MassDmg T4)
//   slot 19 talent_dash            → Focus Fire    (MassDmg T3)
//   slot 20 talent_rampage         → Experience    (Blood T1)
//   slot 21 talent_homing          → Execute       (Blood T2)
//   slot 22 talent_ricochet        → Kill Rush     (Blood T3)
//   slot 23 talent_deathbomb       → Reaper's Arc  (Blood T4)
//   slot 24 talent_frenzy          → Berserker     (Blood T5 capstone)

// Armor (slot 0): damage reduction [4%, 8%, 12%, 16%, 24%]
const ARMOR_BPS: [u32; 5] = [400, 800, 1200, 1600, 2400];

// Heavy Hitter (slot 5): +damage [4%, 8%, 12%, 16%, 24%]
const HEAVY_HITTER_BPS: [u32; 5] = [400, 800, 1200, 1600, 2400];

// Critical Strike (slot 7): chance 7% per rank (hardcap 35%), multiplier [2.0, 2.2, 2.6, 2.8, 3.0]
// On-chain: use expected DPS increase = chance * (multiplier - 1)
// rank 1: 7% * 1.0 = 7%   rank 2: 14% * 1.2 = 16.8%   rank 3: 21% * 1.6 = 33.6%
// rank 4: 28% * 1.8 = 50.4%   rank 5: 35% * 2.0 = 70%
const CRIT_EXPECTED_BPS: [u32; 5] = [700, 1680, 3360, 5040, 7000];

// Execute (slot 21): +damage vs ≤50% HP [8%, 16%, 24%, 32%, 48%]
const EXECUTE_BPS: [u32; 5] = [800, 1600, 2400, 3200, 4800];

// Vitality Strike (slot 4, capstone): +% of max HP as bonus dmg [0.25%, 0.4%, 0.6%]
const VITALITY_STRIKE_BPS: [u32; 3] = [25, 40, 60];

// Berserker (slot 24, capstone): +dmg below 33% HP [25%, 40%, 55%]
const BERSERKER_DMG_BPS: [u32; 3] = [2500, 4000, 5500];

// Experience (slot 20): +XP gained [10%, 17%, 24%, 32%, 40%]
const EXPERIENCE_BPS: [u32; 5] = [1000, 1700, 2400, 3200, 4000];

// Iron Skin (slot 1): +max HP [10%, 15%, 20%, 25%, 30%]
const IRON_SKIN_BPS: [u32; 5] = [1000, 1500, 2000, 2500, 3000];

fn lookup_bps(rank: u8, table: &[u32]) -> u32 {
    if rank == 0 || rank as usize > table.len() { return 0; }
    table[rank as usize - 1]
}

fn calc_level(xp: u64) -> u8 {
    let mut total_xp: u64 = 0;
    for lvl in 1..(MAX_LEVEL as u64) {
        let base_cost = (2 * lvl - 1) * LEVEL_SCALE;
        // Above level 50: each level costs 1% more per level (cumulative)
        let cost = if lvl > 50 {
            base_cost * (10000 + (lvl - 50) * 100) / 10000
        } else {
            base_cost
        };
        total_xp += cost;
        if xp < total_xp {
            return lvl as u8;
        }
    }
    MAX_LEVEL
}

fn calc_talent_points(level: u8) -> u16 {
    // 1 point at level 1, then every 2 levels: levels 1,3,5,...,99 → 50 points at level 100
    let mut points: u16 = 0;
    let mut threshold: u16 = 1;
    for _ in 0..50 {
        if (level as u16) >= threshold {
            points += 1;
        }
        threshold += 2;
    }
    points
}

fn effective_max_health(player: &PlayerState) -> u32 {
    let base = player.max_health as u32;
    let iron_skin_bonus = lookup_bps(player.talent_heavy_hitter, &IRON_SKIN_BPS);
    base * (10000 + iron_skin_bonus) / 10000
}

/// Compute per-hit damage from attacker's on-chain state against a victim.
/// All math uses u32 with 10000 basis-point scaling to avoid floats.
fn compute_hit_damage(attacker: &PlayerState, victim: &PlayerState) -> u16 {
    let mut dmg: u32 = attacker.attack_power as u32;

    // Heavy Hitter (slot 5 = talent_swift): +X% bullet damage
    let hh = lookup_bps(attacker.talent_swift, &HEAVY_HITTER_BPS);
    if hh > 0 {
        dmg = dmg * (10000 + hh) / 10000;
    }

    // Berserker (slot 24 = talent_frenzy): bonus damage below 33% HP
    if attacker.talent_frenzy > 0 {
        let eff_max = effective_max_health(attacker);
        let threshold = eff_max * 3300 / 10000;
        if (attacker.health as u32) <= threshold {
            let bonus = lookup_bps(attacker.talent_frenzy, &BERSERKER_DMG_BPS);
            dmg = dmg * (10000 + bonus) / 10000;
        }
    }

    // Vitality Strike (slot 4 = talent_armor): +X% of max HP as bonus damage
    if attacker.talent_armor > 0 {
        let eff_max = effective_max_health(attacker);
        let vs = lookup_bps(attacker.talent_armor, &VITALITY_STRIKE_BPS);
        dmg += eff_max * vs / 10000;
    }

    // Cap at 5.0 game-damage (500 on-chain)
    dmg = dmg.min(DAMAGE_CAP);

    // Critical Strike (slot 7 = talent_evasion): deterministic expected value
    // Instead of random crits, apply the average DPS increase
    if attacker.talent_evasion > 0 {
        let crit_ev = lookup_bps(attacker.talent_evasion, &CRIT_EXPECTED_BPS);
        dmg = dmg * (10000 + crit_ev) / 10000;
    }

    // Execute (slot 21 = talent_homing): +X% damage vs targets ≤50% HP
    if attacker.talent_homing > 0 {
        let victim_eff_max = effective_max_health(victim);
        if (victim.health as u32) * 2 <= victim_eff_max {
            let exec = lookup_bps(attacker.talent_homing, &EXECUTE_BPS);
            dmg = dmg * (10000 + exec) / 10000;
        }
    }

    // Armor (slot 0 = talent_iron_skin on victim): -X% incoming damage
    if victim.talent_iron_skin > 0 {
        let armor = lookup_bps(victim.talent_iron_skin, &ARMOR_BPS);
        dmg = dmg * (10000 - armor.min(9999)) / 10000;
    }

    dmg.max(1) as u16
}

#[ephemeral]
#[program]
pub mod hodlwarz_combat {
    use super::*;

    pub fn init_arena(ctx: Context<InitArena>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        arena.authority = ctx.accounts.authority.key();
        arena.player_count = 0;
        arena.total_kills = 0;
        arena.is_active = true;
        msg!("Arena initialized by {}", arena.authority);
        Ok(())
    }

    pub fn register_player(ctx: Context<RegisterPlayer>, wallet: Pubkey) -> Result<()> {
        let player = &mut ctx.accounts.player_state;
        player.wallet = wallet;
        player.health = BASE_HEALTH;
        player.max_health = BASE_HEALTH;
        player.attack_power = BASE_ATTACK;
        player.xp = 0;
        player.kills = 0;
        player.deaths = 0;
        player.health_level = 1;
        player.attack_level = 1;
        player.is_alive = true;
        player.respawn_at = 0;
        player.initialized = true;
        player.talent_iron_skin = 0;
        player.talent_heavy_hitter = 0;
        player.talent_regeneration = 0;
        player.talent_lifesteal = 0;
        player.talent_armor = 0;
        player.talent_swift = 0;
        player.talent_rapid_fire = 0;
        player.talent_evasion = 0;
        player.talent_quick_respawn = 0;
        player.talent_momentum = 0;
        player.talent_weakspot = 0;
        player.talent_critical_strike = 0;
        player.talent_focus_fire = 0;
        player.talent_multi_shot = 0;
        player.talent_dual_cannon = 0;
        player.talent_deflect = 0;
        player.talent_absorb = 0;
        player.talent_last_stand = 0;
        player.talent_cloak = 0;
        player.talent_dash = 0;
        player.talent_rampage = 0;
        player.talent_homing = 0;
        player.talent_ricochet = 0;
        player.talent_deathbomb = 0;
        player.talent_frenzy = 0;
        player.manual_build = false;
        msg!("Player {} registered", wallet);
        Ok(())
    }

    pub fn delegate_arena(ctx: Context<DelegateArenaCtx>) -> Result<()> {
        ctx.accounts.delegate_arena(
            &ctx.accounts.payer,
            &[ARENA_SEED],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|a| a.key()),
                ..Default::default()
            },
        )?;
        msg!("Arena delegated to ER");
        Ok(())
    }

    pub fn delegate_player(ctx: Context<DelegatePlayerCtx>, wallet: Pubkey) -> Result<()> {
        ctx.accounts.delegate_player_state(
            &ctx.accounts.payer,
            &[PLAYER_SEED, wallet.as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|a| a.key()),
                ..Default::default()
            },
        )?;
        msg!("Player {} delegated to ER", wallet);
        Ok(())
    }

    /// Process combat: the ER computes damage from on-chain talent state.
    /// Server sends hit_count (how many bullets connected), chain resolves damage.
    /// The server CANNOT dictate damage — the chain is authoritative.
    pub fn process_attack(ctx: Context<ProcessAttack>, hit_count: u16) -> Result<()> {
        let attacker = &mut ctx.accounts.attacker;
        let victim = &mut ctx.accounts.victim;
        let arena = &mut ctx.accounts.arena;

        require!(attacker.initialized, CombatError::NotInitialized);
        require!(victim.initialized, CombatError::NotInitialized);
        require!(attacker.is_alive, CombatError::AttackerDead);
        require!(victim.is_alive, CombatError::VictimDead);
        require!(arena.is_active, CombatError::ArenaInactive);
        require!(hit_count > 0 && hit_count <= 500, CombatError::InvalidHitCount);

        let damage_per_hit = compute_hit_damage(attacker, victim);
        let total_damage = (damage_per_hit as u32)
            .saturating_mul(hit_count as u32)
            .min(u16::MAX as u32) as u16;

        if victim.health <= total_damage {
            victim.health = 0;
            victim.is_alive = false;
            victim.deaths += 1;
            victim.xp += XP_PER_DEATH;
            victim.respawn_at = Clock::get()?.unix_timestamp + RESPAWN_DELAY_SECS;

            attacker.kills += 1;

            // XP scales with victim level
            let victim_level = calc_level(victim.xp.saturating_sub(XP_PER_DEATH)) as u64;
            let mut kill_xp = XP_PER_KILL_BASE + victim_level.saturating_sub(1) * XP_PER_KILL_PER_LEVEL;

            // Bounty: 2x XP for killing level 50+ players
            if victim_level >= 50 {
                kill_xp *= 2;
            }

            // Experience talent (slot 20 = talent_rampage): +X% XP
            let exp_bonus = lookup_bps(attacker.talent_rampage, &EXPERIENCE_BPS);
            if exp_bonus > 0 {
                kill_xp = kill_xp * (10000 + exp_bonus as u64) / 10000;
            }

            attacker.xp += kill_xp;
            arena.total_kills += 1;

            // Auto-level attacker after XP gain
            let new_level = calc_level(attacker.xp);
            attacker.health_level = new_level;
            attacker.attack_level = new_level;

            msg!(
                "KILL: {} -> {} | {} hits, {} dmg/hit, {} total | +{} XP | arena kills: {}",
                attacker.wallet, victim.wallet,
                hit_count, damage_per_hit, total_damage,
                kill_xp, arena.total_kills
            );
        } else {
            victim.health -= total_damage;
            msg!(
                "HIT: {} -> {} | {} hits, {} dmg/hit, {} total (hp: {}/{})",
                attacker.wallet, victim.wallet,
                hit_count, damage_per_hit, total_damage,
                victim.health, victim.max_health
            );
        }

        Ok(())
    }

    pub fn respawn_player(ctx: Context<RespawnPlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player_state;
        require!(player.initialized, CombatError::NotInitialized);
        require!(!player.is_alive, CombatError::AlreadyAlive);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= player.respawn_at, CombatError::RespawnCooldown);

        let eff_max = effective_max_health(player) as u16;
        player.health = eff_max;
        player.max_health = eff_max;
        player.is_alive = true;
        player.respawn_at = 0;

        msg!("Player {} respawned (hp: {})", player.wallet, player.health);
        Ok(())
    }

    pub fn upgrade_stat(ctx: Context<UpgradeStat>, stat_type: u8) -> Result<()> {
        let player = &mut ctx.accounts.player_state;
        require!(player.initialized, CombatError::NotInitialized);

        let (current_level, label) = match stat_type {
            0 => (player.health_level, "health"),
            1 => (player.attack_level, "attack"),
            _ => return Err(CombatError::InvalidStatType.into()),
        };

        require!(current_level < MAX_LEVEL, CombatError::MaxLevel);

        let cost = 100u64 + (current_level as u64) * 50;
        require!(player.xp >= cost, CombatError::InsufficientXP);

        player.xp -= cost;

        match stat_type {
            0 => {
                player.health_level += 1;
                player.max_health += 10;
                if player.is_alive {
                    player.health += 10;
                }
            }
            1 => {
                player.attack_level += 1;
                player.attack_power += 5;
            }
            _ => unreachable!(),
        }

        msg!("Player {} upgraded {} to level {}", player.wallet, label,
            match stat_type { 0 => player.health_level, _ => player.attack_level });
        Ok(())
    }

    pub fn reset_player(ctx: Context<ResetPlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player_state;
        require!(player.initialized, CombatError::NotInitialized);

        player.health = BASE_HEALTH;
        player.max_health = BASE_HEALTH;
        player.attack_power = BASE_ATTACK;
        player.xp = 0;
        player.kills = 0;
        player.deaths = 0;
        player.health_level = 1;
        player.attack_level = 1;
        player.is_alive = true;
        player.respawn_at = 0;
        player.talent_iron_skin = 0;
        player.talent_heavy_hitter = 0;
        player.talent_regeneration = 0;
        player.talent_lifesteal = 0;
        player.talent_armor = 0;
        player.talent_swift = 0;
        player.talent_rapid_fire = 0;
        player.talent_evasion = 0;
        player.talent_quick_respawn = 0;
        player.talent_momentum = 0;
        player.talent_weakspot = 0;
        player.talent_critical_strike = 0;
        player.talent_focus_fire = 0;
        player.talent_multi_shot = 0;
        player.talent_dual_cannon = 0;
        player.talent_deflect = 0;
        player.talent_absorb = 0;
        player.talent_last_stand = 0;
        player.talent_cloak = 0;
        player.talent_dash = 0;
        player.talent_rampage = 0;
        player.talent_homing = 0;
        player.talent_ricochet = 0;
        player.talent_deathbomb = 0;
        player.talent_frenzy = 0;
        player.manual_build = false;
        msg!("Player {} reset to base stats", player.wallet);
        Ok(())
    }

    /// Allocate a talent point with full on-chain validation:
    /// - Level-based point budget
    /// - Max rank per talent
    /// - Prerequisite chain (tier N requires tier N-1)
    /// - Capstone limit (max 2 of 5 capstones)
    pub fn allocate_talent(ctx: Context<AllocateTalent>, talent_id: u8) -> Result<()> {
        let player = &mut ctx.accounts.player_state;
        require!(player.initialized, CombatError::NotInitialized);
        require!(talent_id <= 24, CombatError::InvalidTalentId);

        let level = calc_level(player.xp);
        let total_points = calc_talent_points(level);
        let spent = player.total_talent_points_spent();
        require!(spent < total_points, CombatError::NoTalentPoints);

        let current = player.get_talent(talent_id);
        require!(current < max_rank_for_talent(talent_id), CombatError::TalentMaxed);

        // Prerequisite: each talent requires at least 1 rank in the previous talent of its tree
        let prereq = talent_prerequisite(talent_id);
        if let Some(prereq_id) = prereq {
            require!(player.get_talent(prereq_id) >= 1, CombatError::PrerequisiteNotMet);
        }

        // Capstone limit: max 2 of the 5 capstone talents (slots 4, 9, 14, 17, 24)
        let capstones: [u8; 5] = [4, 9, 14, 17, 24];
        if capstones.contains(&talent_id) && current == 0 {
            let chosen = capstones.iter()
                .filter(|&&id| player.get_talent(id) > 0)
                .count();
            require!(chosen < 2, CombatError::MaxCapstones);
        }

        player.set_talent(talent_id, current + 1);
        player.manual_build = true;

        msg!("Player {} allocated talent {} to rank {}", player.wallet, talent_id, current + 1);
        Ok(())
    }

    pub fn reset_talents(ctx: Context<ResetTalents>) -> Result<()> {
        let player = &mut ctx.accounts.player_state;
        require!(player.initialized, CombatError::NotInitialized);

        player.talent_iron_skin = 0;
        player.talent_heavy_hitter = 0;
        player.talent_regeneration = 0;
        player.talent_lifesteal = 0;
        player.talent_armor = 0;
        player.talent_swift = 0;
        player.talent_rapid_fire = 0;
        player.talent_evasion = 0;
        player.talent_quick_respawn = 0;
        player.talent_momentum = 0;
        player.talent_weakspot = 0;
        player.talent_critical_strike = 0;
        player.talent_focus_fire = 0;
        player.talent_multi_shot = 0;
        player.talent_dual_cannon = 0;
        player.talent_deflect = 0;
        player.talent_absorb = 0;
        player.talent_last_stand = 0;
        player.talent_cloak = 0;
        player.talent_dash = 0;
        player.talent_rampage = 0;
        player.talent_homing = 0;
        player.talent_ricochet = 0;
        player.talent_deathbomb = 0;
        player.talent_frenzy = 0;
        player.manual_build = true;
        msg!("Player {} talents reset", player.wallet);
        Ok(())
    }

    pub fn migrate_player(ctx: Context<MigratePlayer>) -> Result<()> {
        let player_info = &ctx.accounts.player_state;
        let current_len = player_info.data_len();
        let target_len: usize = 8 + 32 + 2 + 2 + 2 + 8 + 8 + 8 + 1 + 1 + 1 + 8 + 1 + 25 + 1;

        if current_len == target_len {
            msg!("Account already at target size, no migration needed");
            return Ok(());
        }

        require!(current_len < target_len, CombatError::InvalidMigration);

        let data = player_info.try_borrow_data()?;
        let expected_disc: [u8; 8] = [56, 3, 60, 86, 174, 16, 244, 195];
        require!(data[..8] == expected_disc, CombatError::InvalidMigration);
        drop(data);

        let rent = Rent::get()?;
        let new_min = rent.minimum_balance(target_len);
        let old_balance = player_info.lamports();
        if new_min > old_balance {
            let diff = new_min - old_balance;
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.authority.to_account_info(),
                        to: player_info.to_account_info(),
                    },
                ),
                diff,
            )?;
        }

        #[allow(deprecated)]
        player_info.realloc(target_len, false)?;

        msg!("Player account migrated from {} to {} bytes", current_len, target_len);
        Ok(())
    }

    pub fn commit_state<'a>(ctx: Context<'_, '_, 'a, 'a, CommitState<'a>>) -> Result<()> {
        let arena_info = ctx.accounts.arena.to_account_info();
        let mut to_commit: Vec<&AccountInfo<'a>> = vec![&arena_info];
        for acct in ctx.remaining_accounts.iter() {
            to_commit.push(acct);
        }
        let count = to_commit.len();
        commit_accounts(
            &ctx.accounts.payer,
            to_commit,
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("State committed to base layer ({} accounts)", count);
        Ok(())
    }

    pub fn commit_player(ctx: Context<CommitPlayer>) -> Result<()> {
        commit_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.player_state.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("Player committed to base layer");
        Ok(())
    }

    pub fn end_session<'a>(ctx: Context<'_, '_, 'a, 'a, EndSession<'a>>) -> Result<()> {
        let arena_info = ctx.accounts.arena.to_account_info();
        let mut to_commit: Vec<&AccountInfo<'a>> = vec![&arena_info];
        for acct in ctx.remaining_accounts.iter() {
            to_commit.push(acct);
        }
        let count = to_commit.len();
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            to_commit,
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("Session ended, {} accounts undelegated", count);
        Ok(())
    }
}

// ─── Talent prerequisite chain ───────────────────────────────────────────────
// Each tree: T1 → T2 → T3 → T4 → T5(capstone)
// Returns the talent slot that must have ≥1 rank before this talent can be allocated.
fn talent_prerequisite(talent_id: u8) -> Option<u8> {
    match talent_id {
        // Tank: 0 → 1 → 2 → 3 → 4
        0 => None,
        1 => Some(0),
        2 => Some(1),
        3 => Some(2),
        4 => Some(3),
        // Firepower: 5 → 6 → 7 → 8 → 9
        5 => None,
        6 => Some(5),
        7 => Some(6),
        8 => Some(7),
        9 => Some(8),
        // Brawler: 10 → 11 → 12 → 13 → 14
        10 => None,
        11 => Some(10),
        12 => Some(11),
        13 => Some(12),
        14 => Some(13),
        // Mass Damage: 15 → 16 → 19 → 18 → 17
        // (ricochet → counterAttack → focusFire → nova → chainLightning)
        15 => None,
        16 => Some(15),
        19 => Some(16),
        18 => Some(19),
        17 => Some(18),
        // Blood Thirst: 20 → 21 → 22 → 23 → 24
        20 => None,
        21 => Some(20),
        22 => Some(21),
        23 => Some(22),
        24 => Some(23),
        _ => None,
    }
}

// ─── Account Structs ─────────────────────────────────────────────────────────

#[account]
pub struct Arena {
    pub authority: Pubkey,
    pub player_count: u32,
    pub total_kills: u64,
    pub is_active: bool,
}

#[account]
pub struct PlayerState {
    pub wallet: Pubkey,
    pub health: u16,
    pub max_health: u16,
    pub attack_power: u16,
    pub xp: u64,
    pub kills: u64,
    pub deaths: u64,
    pub health_level: u8,
    pub attack_level: u8,
    pub is_alive: bool,
    pub respawn_at: i64,
    pub initialized: bool,
    pub talent_iron_skin: u8,
    pub talent_heavy_hitter: u8,
    pub talent_regeneration: u8,
    pub talent_lifesteal: u8,
    pub talent_armor: u8,
    pub talent_swift: u8,
    pub talent_rapid_fire: u8,
    pub talent_evasion: u8,
    pub talent_quick_respawn: u8,
    pub talent_momentum: u8,
    pub talent_weakspot: u8,
    pub talent_critical_strike: u8,
    pub talent_focus_fire: u8,
    pub talent_multi_shot: u8,
    pub talent_dual_cannon: u8,
    pub talent_deflect: u8,
    pub talent_absorb: u8,
    pub talent_last_stand: u8,
    pub talent_cloak: u8,
    pub talent_dash: u8,
    pub talent_rampage: u8,
    pub talent_homing: u8,
    pub talent_ricochet: u8,
    pub talent_deathbomb: u8,
    pub talent_frenzy: u8,
    pub manual_build: bool,
}

impl PlayerState {
    pub fn get_talent(&self, id: u8) -> u8 {
        match id {
            0 => self.talent_iron_skin,
            1 => self.talent_heavy_hitter,
            2 => self.talent_regeneration,
            3 => self.talent_lifesteal,
            4 => self.talent_armor,
            5 => self.talent_swift,
            6 => self.talent_rapid_fire,
            7 => self.talent_evasion,
            8 => self.talent_quick_respawn,
            9 => self.talent_momentum,
            10 => self.talent_weakspot,
            11 => self.talent_critical_strike,
            12 => self.talent_focus_fire,
            13 => self.talent_multi_shot,
            14 => self.talent_dual_cannon,
            15 => self.talent_deflect,
            16 => self.talent_absorb,
            17 => self.talent_last_stand,
            18 => self.talent_cloak,
            19 => self.talent_dash,
            20 => self.talent_rampage,
            21 => self.talent_homing,
            22 => self.talent_ricochet,
            23 => self.talent_deathbomb,
            24 => self.talent_frenzy,
            _ => 0,
        }
    }

    pub fn set_talent(&mut self, id: u8, val: u8) {
        match id {
            0 => self.talent_iron_skin = val,
            1 => self.talent_heavy_hitter = val,
            2 => self.talent_regeneration = val,
            3 => self.talent_lifesteal = val,
            4 => self.talent_armor = val,
            5 => self.talent_swift = val,
            6 => self.talent_rapid_fire = val,
            7 => self.talent_evasion = val,
            8 => self.talent_quick_respawn = val,
            9 => self.talent_momentum = val,
            10 => self.talent_weakspot = val,
            11 => self.talent_critical_strike = val,
            12 => self.talent_focus_fire = val,
            13 => self.talent_multi_shot = val,
            14 => self.talent_dual_cannon = val,
            15 => self.talent_deflect = val,
            16 => self.talent_absorb = val,
            17 => self.talent_last_stand = val,
            18 => self.talent_cloak = val,
            19 => self.talent_dash = val,
            20 => self.talent_rampage = val,
            21 => self.talent_homing = val,
            22 => self.talent_ricochet = val,
            23 => self.talent_deathbomb = val,
            24 => self.talent_frenzy = val,
            _ => {}
        }
    }

    pub fn total_talent_points_spent(&self) -> u16 {
        (self.talent_iron_skin as u16)
            + (self.talent_heavy_hitter as u16)
            + (self.talent_regeneration as u16)
            + (self.talent_lifesteal as u16)
            + (self.talent_armor as u16)
            + (self.talent_swift as u16)
            + (self.talent_rapid_fire as u16)
            + (self.talent_evasion as u16)
            + (self.talent_quick_respawn as u16)
            + (self.talent_momentum as u16)
            + (self.talent_weakspot as u16)
            + (self.talent_critical_strike as u16)
            + (self.talent_focus_fire as u16)
            + (self.talent_multi_shot as u16)
            + (self.talent_dual_cannon as u16)
            + (self.talent_deflect as u16)
            + (self.talent_absorb as u16)
            + (self.talent_last_stand as u16)
            + (self.talent_cloak as u16)
            + (self.talent_dash as u16)
            + (self.talent_rampage as u16)
            + (self.talent_homing as u16)
            + (self.talent_ricochet as u16)
            + (self.talent_deathbomb as u16)
            + (self.talent_frenzy as u16)
    }
}

// ─── Instruction Contexts ────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitArena<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 4 + 8 + 1,
        seeds = [ARENA_SEED],
        bump,
    )]
    pub arena: Account<'info, Arena>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct RegisterPlayer<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 2 + 2 + 2 + 8 + 8 + 8 + 1 + 1 + 1 + 8 + 1 + 25 + 1,
        seeds = [PLAYER_SEED, wallet.as_ref()],
        bump,
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateArenaCtx<'info> {
    pub payer: Signer<'info>,
    /// CHECK: Arena PDA to delegate
    #[account(mut, del, seeds = [ARENA_SEED], bump)]
    pub arena: AccountInfo<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct DelegatePlayerCtx<'info> {
    pub payer: Signer<'info>,
    /// CHECK: Player PDA to delegate
    #[account(mut, del, seeds = [PLAYER_SEED, wallet.as_ref()], bump)]
    pub player_state: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ProcessAttack<'info> {
    #[account(mut)]
    pub attacker: Account<'info, PlayerState>,
    #[account(mut)]
    pub victim: Account<'info, PlayerState>,
    #[account(mut, seeds = [ARENA_SEED], bump)]
    pub arena: Account<'info, Arena>,
}

#[derive(Accounts)]
pub struct RespawnPlayer<'info> {
    #[account(mut)]
    pub player_state: Account<'info, PlayerState>,
}

#[derive(Accounts)]
pub struct UpgradeStat<'info> {
    #[account(mut)]
    pub player_state: Account<'info, PlayerState>,
}

#[derive(Accounts)]
pub struct ResetPlayer<'info> {
    #[account(mut)]
    pub player_state: Account<'info, PlayerState>,
}

#[derive(Accounts)]
pub struct AllocateTalent<'info> {
    #[account(mut)]
    pub player_state: Account<'info, PlayerState>,
}

#[derive(Accounts)]
pub struct ResetTalents<'info> {
    #[account(mut)]
    pub player_state: Account<'info, PlayerState>,
}

#[derive(Accounts)]
pub struct MigratePlayer<'info> {
    /// CHECK: Old player account that needs resizing
    #[account(mut)]
    pub player_state: AccountInfo<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitState<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ARENA_SEED], bump)]
    pub arena: Account<'info, Arena>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitPlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub player_state: Account<'info, PlayerState>,
}

#[commit]
#[derive(Accounts)]
pub struct EndSession<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ARENA_SEED], bump)]
    pub arena: Account<'info, Arena>,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum CombatError {
    #[msg("Player not initialized")]
    NotInitialized,
    #[msg("Attacker is dead")]
    AttackerDead,
    #[msg("Victim is already dead")]
    VictimDead,
    #[msg("Arena is not active")]
    ArenaInactive,
    #[msg("Player is already alive")]
    AlreadyAlive,
    #[msg("Respawn cooldown not elapsed")]
    RespawnCooldown,
    #[msg("Not enough XP to upgrade")]
    InsufficientXP,
    #[msg("Invalid stat type (0=health, 1=attack)")]
    InvalidStatType,
    #[msg("Stat already at max level")]
    MaxLevel,
    #[msg("Invalid talent ID (0-24)")]
    InvalidTalentId,
    #[msg("No talent points available")]
    NoTalentPoints,
    #[msg("Talent already at max rank")]
    TalentMaxed,
    #[msg("Prerequisite talent not met")]
    PrerequisiteNotMet,
    #[msg("Maximum capstone talents (2) already chosen")]
    MaxCapstones,
    #[msg("Invalid hit count")]
    InvalidHitCount,
    #[msg("Invalid migration: account is not a valid old-format PlayerState")]
    InvalidMigration,
}
