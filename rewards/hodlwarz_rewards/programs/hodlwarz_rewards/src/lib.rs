use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

// Replace with your actual deployed program ID after `anchor deploy`
declare_id!("HWRZrewArdS111111111111111111111111111111111");

const VAULT_SEED: &[u8] = b"reward_vault";
const CLAIM_SEED: &[u8] = b"reward_claim";

// Top 10 reward split in basis points (must sum to 10000)
// 1st–5th get progressively less; 6th–10th split equally.
// 500k tokens/season example: 150k, 100k, 75k, 50k, 25k, 20k×5
// 1st: 30%, 2nd: 20%, 3rd: 15%, 4th: 10%, 5th: 5%, 6th-10th: 4% each
const REWARD_BPS: [u16; 10] = [3000, 2000, 1500, 1000, 500, 400, 400, 400, 400, 400];

#[program]
pub mod hodlwarz_rewards {
    use super::*;

    /// One-time vault initialization. Creates the authority PDA and vault token account.
    pub fn init_vault(ctx: Context<InitVault>) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.authority = ctx.accounts.authority.key();
        vault_state.mint = ctx.accounts.mint.key();
        vault_state.vault_token_account = ctx.accounts.vault_token_account.key();
        vault_state.total_distributed = 0;
        vault_state.seasons_funded = 0;
        vault_state.bump = ctx.bumps.vault_state;
        msg!("Reward vault initialized for mint {}", vault_state.mint);
        Ok(())
    }

    /// Authority registers a season's winners. Called by server after finalize_season on devnet.
    /// `total_reward` is the total token amount for this season; it gets split per REWARD_BPS.
    pub fn register_winners(
        ctx: Context<RegisterWinners>,
        season_number: u32,
        total_reward: u64,
        winners: Vec<WinnerInput>,
    ) -> Result<()> {
        require!(winners.len() <= 10, RewardError::TooManyWinners);
        require!(total_reward > 0, RewardError::ZeroReward);

        let vault_balance = ctx.accounts.vault_token_account.amount;
        require!(vault_balance >= total_reward, RewardError::InsufficientVaultBalance);

        let season_reg = &mut ctx.accounts.season_registration;
        season_reg.season_number = season_number;
        season_reg.total_reward = total_reward;
        season_reg.winner_count = winners.len() as u8;
        season_reg.registered_at = Clock::get()?.unix_timestamp;

        for (i, w) in winners.iter().enumerate() {
            let amount = (total_reward as u128 * REWARD_BPS[i] as u128 / 10000) as u64;
            season_reg.winners[i] = WinnerEntry {
                wallet: w.wallet,
                kills: w.kills,
                level: w.level,
                reward_amount: amount,
                claimed: false,
            };
        }

        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.seasons_funded += 1;

        msg!(
            "Season {} registered: {} winners, {} total reward",
            season_number, winners.len(), total_reward
        );
        Ok(())
    }

    /// Winner claims their reward. Player signs the transaction.
    pub fn claim_reward(ctx: Context<ClaimReward>, season_number: u32) -> Result<()> {
        let season_reg = &mut ctx.accounts.season_registration;
        let claimer = ctx.accounts.claimer.key();

        let entry = season_reg.winners.iter_mut()
            .take(season_reg.winner_count as usize)
            .find(|e| e.wallet == claimer)
            .ok_or(RewardError::NotAWinner)?;

        require!(!entry.claimed, RewardError::AlreadyClaimed);
        require!(entry.reward_amount > 0, RewardError::ZeroReward);

        let amount = entry.reward_amount;

        let vault_bump = ctx.accounts.vault_state.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, &[vault_bump]]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.claimer_token_account.to_account_info(),
                    authority: ctx.accounts.vault_state.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        entry.claimed = true;

        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.total_distributed += amount;

        msg!(
            "Season {} — {} claimed {} tokens",
            season_number, claimer, amount
        );
        Ok(())
    }
}

// ─── Input Types ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WinnerInput {
    pub wallet: Pubkey,
    pub kills: u64,
    pub level: u8,
}

// ─── Account Structs ─────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct WinnerEntry {
    pub wallet: Pubkey,       // 32
    pub kills: u64,           // 8
    pub level: u8,            // 1
    pub reward_amount: u64,   // 8
    pub claimed: bool,        // 1
}
// 50 bytes each

#[account]
pub struct VaultState {
    pub authority: Pubkey,              // 32
    pub mint: Pubkey,                   // 32
    pub vault_token_account: Pubkey,    // 32
    pub total_distributed: u64,         // 8
    pub seasons_funded: u32,            // 4
    pub bump: u8,                       // 1
}
// space: 8 + 32 + 32 + 32 + 8 + 4 + 1 = 117

#[account]
pub struct SeasonRegistration {
    pub season_number: u32,             // 4
    pub total_reward: u64,              // 8
    pub winner_count: u8,               // 1
    pub registered_at: i64,             // 8
    pub winners: [WinnerEntry; 10],     // 10 * 50 = 500
}
// space: 8 + 4 + 8 + 1 + 8 + 500 = 529

// ─── Instruction Contexts ────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 32 + 8 + 4 + 1,
        seeds = [VAULT_SEED],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,
    /// The SPL token account that holds reward tokens, owned by the vault PDA.
    #[account(
        mut,
        token::mint = mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(season_number: u32)]
pub struct RegisterWinners<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = vault_state.bump,
        has_one = authority,
    )]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        init,
        payer = authority,
        space = 8 + 4 + 8 + 1 + 8 + (10 * 50),
        seeds = [CLAIM_SEED, &season_number.to_le_bytes()],
        bump,
    )]
    pub season_registration: Account<'info, SeasonRegistration>,
    #[account(
        token::mint = vault_state.mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season_number: u32)]
pub struct ClaimReward<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        mut,
        seeds = [CLAIM_SEED, &season_number.to_le_bytes()],
        bump,
    )]
    pub season_registration: Account<'info, SeasonRegistration>,
    #[account(
        mut,
        token::mint = vault_state.mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    /// The winner's associated token account to receive rewards
    #[account(
        mut,
        token::mint = vault_state.mint,
        token::authority = claimer,
    )]
    pub claimer_token_account: Account<'info, TokenAccount>,
    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum RewardError {
    #[msg("Too many winners (max 10)")]
    TooManyWinners,
    #[msg("Reward amount must be greater than zero")]
    ZeroReward,
    #[msg("Vault does not have enough tokens")]
    InsufficientVaultBalance,
    #[msg("Wallet is not a winner for this season")]
    NotAWinner,
    #[msg("Reward already claimed")]
    AlreadyClaimed,
}
