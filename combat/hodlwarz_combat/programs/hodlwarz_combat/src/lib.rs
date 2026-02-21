use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};

declare_id!("7aeBk4C2MhuivHdBiNS44feYjwiPsg6Aiq9SEUP99TDi");

const ARENA_SEED: &[u8] = b"arena";
const PLAYER_SEED: &[u8] = b"player";

const BASE_HEALTH: u16 = 100;
const BASE_ATTACK: u16 = 10;
const XP_PER_KILL: u64 = 25;
const XP_PER_DEATH: u64 = 5;
const UPGRADE_XP_BASE: u64 = 100;
const UPGRADE_XP_MULT: u64 = 50;
const RESPAWN_DELAY_SECS: i64 = 5;
const MAX_LEVEL: u8 = 100;
const MAX_TALENT_RANK_OLD: u8 = 5;  // Strength / Speed / Precision (IDs 0-14)
const MAX_TALENT_RANK_NEW: u8 = 3;  // Utility / Chaos (IDs 15-24)

fn max_rank_for_talent(talent_id: u8) -> u8 {
    if talent_id <= 14 { MAX_TALENT_RANK_OLD } else { MAX_TALENT_RANK_NEW }
}

#[ephemeral]
#[program]
pub mod hodlwarz_combat {
    use super::*;

    /// Initialize the arena on the base layer.
    pub fn init_arena(ctx: Context<InitArena>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        arena.authority = ctx.accounts.authority.key();
        arena.player_count = 0;
        arena.total_kills = 0;
        arena.is_active = true;
        msg!("Arena initialized by {}", arena.authority);
        Ok(())
    }

    /// Register a new player on the base layer (no arena needed).
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
        // Strength
        player.talent_iron_skin = 0;
        player.talent_heavy_hitter = 0;
        player.talent_regeneration = 0;
        player.talent_lifesteal = 0;
        player.talent_armor = 0;
        // Speed
        player.talent_swift = 0;
        player.talent_rapid_fire = 0;
        player.talent_evasion = 0;
        player.talent_quick_respawn = 0;
        player.talent_momentum = 0;
        // Precision
        player.talent_weakspot = 0;
        player.talent_critical_strike = 0;
        player.talent_focus_fire = 0;
        player.talent_multi_shot = 0;
        player.talent_dual_cannon = 0;
        // Utility
        player.talent_deflect = 0;
        player.talent_absorb = 0;
        player.talent_last_stand = 0;
        player.talent_cloak = 0;
        player.talent_dash = 0;
        // Chaos
        player.talent_rampage = 0;
        player.talent_homing = 0;
        player.talent_ricochet = 0;
        player.talent_deathbomb = 0;
        player.talent_frenzy = 0;
        player.manual_build = false;

        msg!("Player {} registered", wallet);
        Ok(())
    }

    /// Delegate the arena account to an Ephemeral Rollup.
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

    /// Delegate a player account to an Ephemeral Rollup.
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

    /// Process an attack: attacker deals damage to victim. Runs on ER.
    pub fn process_attack(ctx: Context<ProcessAttack>, damage: u16) -> Result<()> {
        let attacker = &mut ctx.accounts.attacker;
        let victim = &mut ctx.accounts.victim;
        let arena = &mut ctx.accounts.arena;

        require!(attacker.initialized, CombatError::NotInitialized);
        require!(victim.initialized, CombatError::NotInitialized);
        require!(attacker.is_alive, CombatError::AttackerDead);
        require!(victim.is_alive, CombatError::VictimDead);
        require!(arena.is_active, CombatError::ArenaInactive);

        let actual_damage = damage.min(attacker.attack_power);

        if victim.health <= actual_damage {
            victim.health = 0;
            victim.is_alive = false;
            victim.deaths += 1;
            victim.xp += XP_PER_DEATH;
            victim.respawn_at = Clock::get()?.unix_timestamp + RESPAWN_DELAY_SECS;

            attacker.kills += 1;
            attacker.xp += XP_PER_KILL;
            arena.total_kills += 1;

            msg!(
                "KILL: {} -> {} (total arena kills: {})",
                attacker.wallet,
                victim.wallet,
                arena.total_kills
            );
        } else {
            victim.health -= actual_damage;
            msg!(
                "HIT: {} -> {} for {} dmg (hp: {}/{})",
                attacker.wallet,
                victim.wallet,
                actual_damage,
                victim.health,
                victim.max_health
            );
        }

        Ok(())
    }

    /// Respawn a dead player after the respawn timer has elapsed. Runs on ER.
    pub fn respawn_player(ctx: Context<RespawnPlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player_state;

        require!(player.initialized, CombatError::NotInitialized);
        require!(!player.is_alive, CombatError::AlreadyAlive);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= player.respawn_at, CombatError::RespawnCooldown);

        player.health = player.max_health;
        player.is_alive = true;
        player.respawn_at = 0;

        msg!("Player {} respawned (hp: {})", player.wallet, player.health);
        Ok(())
    }

    /// Upgrade a player stat. stat_type: 0 = health, 1 = attack. Runs on ER.
    pub fn upgrade_stat(ctx: Context<UpgradeStat>, stat_type: u8) -> Result<()> {
        let player = &mut ctx.accounts.player_state;
        require!(player.initialized, CombatError::NotInitialized);

        let (current_level, label) = match stat_type {
            0 => (player.health_level, "health"),
            1 => (player.attack_level, "attack"),
            _ => return Err(CombatError::InvalidStatType.into()),
        };

        require!(current_level < MAX_LEVEL, CombatError::MaxLevel);

        let cost = UPGRADE_XP_BASE + (current_level as u64) * UPGRADE_XP_MULT;
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

        msg!(
            "Player {} upgraded {} to level {}",
            player.wallet,
            label,
            match stat_type {
                0 => player.health_level,
                _ => player.attack_level,
            }
        );
        Ok(())
    }

    /// Reset a player's stats to base values (season reset). Runs on ER.
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
        // Reset all talents
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

    /// Allocate a talent point. talent_id: 0-24. Runs on ER.
    pub fn allocate_talent(ctx: Context<AllocateTalent>, talent_id: u8) -> Result<()> {
        let player = &mut ctx.accounts.player_state;
        require!(player.initialized, CombatError::NotInitialized);
        require!(talent_id <= 24, CombatError::InvalidTalentId);

        let level = calc_level(player.xp);
        let spent = player.total_talent_points_spent();
        let available = if level > 1 { level as u16 - 1 } else { 0 };
        require!(spent < available, CombatError::NoTalentPoints);

        let current = player.get_talent(talent_id);
        require!(current < max_rank_for_talent(talent_id), CombatError::TalentMaxed);

        player.set_talent(talent_id, current + 1);
        player.manual_build = true;

        msg!("Player {} allocated talent {} to rank {}", player.wallet, talent_id, current + 1);
        Ok(())
    }

    /// Reset all talent points. Runs on ER.
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

    /// Migrate an old player account from 82 bytes to 108 bytes (adds talent + manual_build fields).
    /// Uses UncheckedAccount because Anchor can't deserialize the old smaller struct.
    pub fn migrate_player(ctx: Context<MigratePlayer>) -> Result<()> {
        let player_info = &ctx.accounts.player_state;
        let current_len = player_info.data_len();
        let target_len: usize = 8 + 32 + 2 + 2 + 2 + 8 + 8 + 8 + 1 + 1 + 1 + 8 + 1 + 25 + 1; // 108

        if current_len == target_len {
            msg!("Account already at target size, no migration needed");
            return Ok(());
        }

        require!(current_len < target_len, CombatError::InvalidMigration);

        // Verify the discriminator matches PlayerState
        let data = player_info.try_borrow_data()?;
        let expected_disc: [u8; 8] = [56, 3, 60, 86, 174, 16, 244, 195];
        require!(data[..8] == expected_disc, CombatError::InvalidMigration);
        drop(data);

        // Realloc to new size (new bytes are zero-initialized).
        // No rent transfer needed — ER doesn't enforce rent exemption.
        #[allow(deprecated)]
        player_info.realloc(target_len, false)?;

        msg!("Player account migrated from {} to {} bytes", current_len, target_len);
        Ok(())
    }

    /// Commit ER state back to base layer (keeps delegation active).
    pub fn commit_state(ctx: Context<CommitState>) -> Result<()> {
        commit_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.arena.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("State committed to base layer");
        Ok(())
    }

    /// Commit and undelegate - returns accounts to base layer.
    pub fn end_session(ctx: Context<EndSession>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.arena.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("Session ended, accounts undelegated");
        Ok(())
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
    // Talent tree: Strength (max rank 5)
    pub talent_iron_skin: u8,
    pub talent_heavy_hitter: u8,
    pub talent_regeneration: u8,
    pub talent_lifesteal: u8,
    pub talent_armor: u8,
    // Talent tree: Speed (max rank 5)
    pub talent_swift: u8,
    pub talent_rapid_fire: u8,
    pub talent_evasion: u8,
    pub talent_quick_respawn: u8,
    pub talent_momentum: u8,
    // Talent tree: Precision (max rank 5)
    pub talent_weakspot: u8,
    pub talent_critical_strike: u8,
    pub talent_focus_fire: u8,
    pub talent_multi_shot: u8,
    pub talent_dual_cannon: u8,
    // Talent tree: Utility (max rank 3)
    pub talent_deflect: u8,
    pub talent_absorb: u8,
    pub talent_last_stand: u8,
    pub talent_cloak: u8,
    pub talent_dash: u8,
    // Talent tree: Chaos (max rank 3)
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

fn calc_level(xp: u64) -> u8 {
    let lvl = 1u64 + integer_sqrt(xp / 10);
    if lvl > MAX_LEVEL as u64 { MAX_LEVEL } else { lvl as u8 }
}

fn integer_sqrt(n: u64) -> u64 {
    if n == 0 { return 0; }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
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
    /// CHECK: Old player account that needs resizing — we verify discriminator manually
    #[account(mut)]
    pub player_state: AccountInfo<'info>,
    pub authority: Signer<'info>,
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
    #[msg("Invalid migration: account is not a valid old-format PlayerState")]
    InvalidMigration,
}
