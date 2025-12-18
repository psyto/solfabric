use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("9tGdavqZd29sZzkWo2kSjytFZtS4VzArwcshf9zvEMVg");

// Constants for YieldSpace curve
const PRECISION: u128 = 1_000_000_000; // 9 decimal precision
const SECONDS_PER_YEAR: i64 = 31_536_000; // 365 days
const MIN_TIME_TO_MATURITY: i64 = 86400; // 1 day minimum

#[program]
pub mod yield_splitter {
    use super::*;

    /// Initialize AMM pool with maturity date and underlying asset
    pub fn initialize_amm(
        ctx: Context<InitializeAmm>,
        maturity_timestamp: i64,
        underlying_mint: Pubkey,
    ) -> Result<()> {
        let amm = &mut ctx.accounts.amm;
        let clock = Clock::get()?;

        require!(
            maturity_timestamp > clock.unix_timestamp,
            YieldErrors::InvalidMaturity
        );

        amm.authority = ctx.accounts.authority.key();
        amm.underlying_mint = underlying_mint;
        amm.vault = ctx.accounts.vault.key();
        amm.pt_mint = ctx.accounts.pt_mint.key();
        amm.yt_mint = ctx.accounts.yt_mint.key();
        amm.maturity = maturity_timestamp;
        amm.pt_reserve = 0;
        amm.yt_reserve = 0;
        amm.total_underlying = 0;
        amm.total_yield_accrued = 0;
        amm.fee_basis_points = 30; // 0.3% fee
        amm.last_yield_update = clock.unix_timestamp;
        amm.is_matured = false;

        msg!("YieldSplitter AMM Initialized");
        msg!("Maturity: {}", maturity_timestamp);
        msg!("Underlying: {}", underlying_mint);
        Ok(())
    }

    /// Deposit underlying asset and receive PT + YT tokens
    pub fn tokenize_yield(ctx: Context<TokenizeYield>, amount: u64) -> Result<()> {
        let amm = &mut ctx.accounts.amm;
        let clock = Clock::get()?;

        require!(!amm.is_matured, YieldErrors::PoolMatured);
        require!(amount > 0, YieldErrors::InvalidAmount);

        // 1. Transfer underlying asset from user to vault
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_underlying.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // 2. Mint PT tokens (1:1 with underlying)
        let amm_key = amm.key();
        let seeds = &[
            b"pt_mint".as_ref(),
            amm_key.as_ref(),
            &[ctx.bumps.pt_mint],
        ];
        let signer = &[&seeds[..]];

        anchor_spl::token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::MintTo {
                    mint: ctx.accounts.pt_mint.to_account_info(),
                    to: ctx.accounts.user_pt.to_account_info(),
                    authority: ctx.accounts.pt_mint.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        // 3. Mint YT tokens (1:1 with underlying)
        let seeds_yt = &[
            b"yt_mint".as_ref(),
            amm_key.as_ref(),
            &[ctx.bumps.yt_mint],
        ];
        let signer_yt = &[&seeds_yt[..]];

        anchor_spl::token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::MintTo {
                    mint: ctx.accounts.yt_mint.to_account_info(),
                    to: ctx.accounts.user_yt.to_account_info(),
                    authority: ctx.accounts.yt_mint.to_account_info(),
                },
                signer_yt,
            ),
            amount,
        )?;

        // 4. Update pool state
        amm.total_underlying = amm.total_underlying
            .checked_add(amount)
            .ok_or(YieldErrors::MathOverflow)?;
        amm.last_yield_update = clock.unix_timestamp;

        msg!("Tokenized {} underlying into PT/YT", amount);
        msg!("Total underlying in pool: {}", amm.total_underlying);
        Ok(())
    }

    /// Swap PT <-> YT using YieldSpace time-weighted curve
    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64, is_pt_to_yt: bool) -> Result<()> {
        let amm = &mut ctx.accounts.amm;
        let clock = Clock::get()?;

        require!(!amm.is_matured, YieldErrors::PoolMatured);
        require!(amount_in > 0, YieldErrors::InvalidAmount);
        require!(amm.pt_reserve > 0 && amm.yt_reserve > 0, YieldErrors::InsufficientLiquidity);

        let (reserve_in, reserve_out) = if is_pt_to_yt {
            (amm.pt_reserve, amm.yt_reserve)
        } else {
            (amm.yt_reserve, amm.pt_reserve)
        };

        // YieldSpace curve: Uses time to maturity to adjust pricing
        // As maturity approaches, PT price converges to 1
        let time_to_maturity = amm.maturity - clock.unix_timestamp;
        let amount_out_gross = calculate_yieldspace_out(
            reserve_in,
            reserve_out,
            amount_in,
            time_to_maturity,
        )?;

        // Apply fee
        let fee = (amount_out_gross as u128)
            .checked_mul(amm.fee_basis_points as u128)
            .ok_or(YieldErrors::MathOverflow)?
            .checked_div(10000)
            .ok_or(YieldErrors::MathOverflow)? as u64;

        let amount_out_net = amount_out_gross
            .checked_sub(fee)
            .ok_or(YieldErrors::MathOverflow)?;

        require!(amount_out_net >= min_amount_out, YieldErrors::SlippageExceeded);

        // Update reserves
        if is_pt_to_yt {
            amm.pt_reserve = amm.pt_reserve.checked_add(amount_in).ok_or(YieldErrors::MathOverflow)?;
            amm.yt_reserve = amm.yt_reserve.checked_sub(amount_out_net).ok_or(YieldErrors::MathOverflow)?;
        } else {
            amm.yt_reserve = amm.yt_reserve.checked_add(amount_in).ok_or(YieldErrors::MathOverflow)?;
            amm.pt_reserve = amm.pt_reserve.checked_sub(amount_out_net).ok_or(YieldErrors::MathOverflow)?;
        }

        msg!("Swapped {} for {}. Fee: {}", amount_in, amount_out_net, fee);
        Ok(())
    }

    /// Redeem PT tokens for underlying after maturity
    pub fn redeem_pt(ctx: Context<RedeemPt>, amount: u64) -> Result<()> {
        let amm = &ctx.accounts.amm;
        let clock = Clock::get()?;

        require!(clock.unix_timestamp >= amm.maturity, YieldErrors::NotMatured);
        require!(amount > 0, YieldErrors::InvalidAmount);

        // Burn PT tokens
        anchor_spl::token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Burn {
                    mint: ctx.accounts.pt_mint.to_account_info(),
                    from: ctx.accounts.user_pt.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // Transfer underlying from vault to user (1:1)
        let amm_key = amm.key();
        let vault_seeds = &[
            b"vault".as_ref(),
            amm_key.as_ref(),
            &[ctx.bumps.vault],
        ];
        let vault_signer = &[&vault_seeds[..]];

        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_underlying.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                vault_signer,
            ),
            amount,
        )?;

        msg!("Redeemed {} PT for {} underlying", amount, amount);
        Ok(())
    }

    /// Claim yield accrued for YT holders
    pub fn claim_yield(ctx: Context<ClaimYield>, amount: u64) -> Result<()> {
        let amm = &mut ctx.accounts.amm;
        let clock = Clock::get()?;

        require!(amount > 0, YieldErrors::InvalidAmount);

        // Calculate claimable yield based on YT balance
        // In a full implementation, this would track yield per YT token
        let user_yt_balance = ctx.accounts.user_yt.amount;
        require!(user_yt_balance > 0, YieldErrors::NoYtBalance);

        // Simple yield calculation (in production, track via oracle or staking rewards)
        let yield_share = (amount as u128)
            .checked_mul(user_yt_balance as u128)
            .ok_or(YieldErrors::MathOverflow)?
            .checked_div(amm.yt_reserve as u128)
            .ok_or(YieldErrors::MathOverflow)? as u64;

        require!(yield_share <= amm.total_yield_accrued, YieldErrors::InsufficientYield);

        // Transfer yield from vault
        let amm_key = amm.key();
        let vault_seeds = &[
            b"vault".as_ref(),
            amm_key.as_ref(),
            &[ctx.bumps.vault],
        ];
        let vault_signer = &[&vault_seeds[..]];

        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_underlying.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                vault_signer,
            ),
            yield_share,
        )?;

        amm.total_yield_accrued = amm.total_yield_accrued
            .checked_sub(yield_share)
            .ok_or(YieldErrors::MathOverflow)?;
        amm.last_yield_update = clock.unix_timestamp;

        msg!("Claimed {} yield for YT holder", yield_share);
        Ok(())
    }

    /// Add liquidity to the AMM pool
    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        pt_amount: u64,
        yt_amount: u64,
    ) -> Result<()> {
        let amm = &mut ctx.accounts.amm;

        require!(!amm.is_matured, YieldErrors::PoolMatured);
        require!(pt_amount > 0 && yt_amount > 0, YieldErrors::InvalidAmount);

        // Update reserves
        amm.pt_reserve = amm.pt_reserve.checked_add(pt_amount).ok_or(YieldErrors::MathOverflow)?;
        amm.yt_reserve = amm.yt_reserve.checked_add(yt_amount).ok_or(YieldErrors::MathOverflow)?;

        msg!("Added liquidity: {} PT, {} YT", pt_amount, yt_amount);
        Ok(())
    }

    /// Mark pool as matured (can be called by anyone after maturity)
    pub fn mark_matured(ctx: Context<MarkMatured>) -> Result<()> {
        let amm = &mut ctx.accounts.amm;
        let clock = Clock::get()?;

        require!(clock.unix_timestamp >= amm.maturity, YieldErrors::NotMatured);
        require!(!amm.is_matured, YieldErrors::AlreadyMatured);

        amm.is_matured = true;
        msg!("Pool marked as matured");
        Ok(())
    }
}

// Helper function: YieldSpace curve calculation
// Simplified version that adjusts based on time to maturity
fn calculate_yieldspace_out(
    reserve_in: u64,
    reserve_out: u64,
    amount_in: u64,
    time_to_maturity: i64,
) -> Result<u64> {
    // Ensure minimum time to maturity
    let time_factor = if time_to_maturity < MIN_TIME_TO_MATURITY {
        MIN_TIME_TO_MATURITY
    } else {
        time_to_maturity
    };

    // Calculate time-based adjustment (0 to 1)
    // As maturity approaches, this approaches 1 (constant product)
    let time_ratio = (time_factor as u128)
        .checked_mul(PRECISION)
        .ok_or(YieldErrors::MathOverflow)?
        .checked_div(SECONDS_PER_YEAR as u128)
        .ok_or(YieldErrors::MathOverflow)?;

    // Apply time-weighted constant product formula
    // k = (x + y)^t where t decreases over time
    let k = ((reserve_in as u128) + (reserve_out as u128))
        .checked_mul(time_ratio)
        .ok_or(YieldErrors::MathOverflow)?
        .checked_div(PRECISION)
        .ok_or(YieldErrors::MathOverflow)?;

    let new_reserve_in = (reserve_in as u128) + (amount_in as u128);

    // Calculate output maintaining invariant
    let new_reserve_out = k
        .checked_sub(new_reserve_in)
        .ok_or(YieldErrors::MathOverflow)?;

    let amount_out = (reserve_out as u128)
        .checked_sub(new_reserve_out)
        .ok_or(YieldErrors::InsufficientLiquidity)?;

    Ok(amount_out as u64)
}

//Account Contexts

#[derive(Accounts)]
pub struct InitializeAmm<'info> {
    #[account(init, payer = authority, space = 8 + AmmPool::INIT_SPACE)]
    pub amm: Account<'info, AmmPool>,
    #[account(
        init,
        payer = authority,
        seeds = [b"vault", amm.key().as_ref()],
        bump,
        token::mint = underlying_mint,
        token::authority = vault,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub underlying_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [b"pt_mint", amm.key().as_ref()],
        bump,
        mint::decimals = underlying_mint.decimals,
        mint::authority = pt_mint,
    )]
    pub pt_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [b"yt_mint", amm.key().as_ref()],
        bump,
        mint::decimals = underlying_mint.decimals,
        mint::authority = yt_mint,
    )]
    pub yt_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct TokenizeYield<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub amm: Account<'info, AmmPool>,
    #[account(
        mut,
        seeds = [b"vault", amm.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"pt_mint", amm.key().as_ref()],
        bump
    )]
    pub pt_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"yt_mint", amm.key().as_ref()],
        bump
    )]
    pub yt_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_underlying: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_pt: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_yt: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub amm: Account<'info, AmmPool>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct RedeemPt<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub amm: Account<'info, AmmPool>,
    #[account(
        mut,
        seeds = [b"vault", amm.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"pt_mint", amm.key().as_ref()],
        bump
    )]
    pub pt_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_pt: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_underlying: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimYield<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub amm: Account<'info, AmmPool>,
    #[account(
        mut,
        seeds = [b"vault", amm.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_yt: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_underlying: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub amm: Account<'info, AmmPool>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct MarkMatured<'info> {
    #[account(mut)]
    pub amm: Account<'info, AmmPool>,
}

// Data Structures

#[account]
#[derive(InitSpace)]
pub struct AmmPool {
    pub authority: Pubkey,           // 32
    pub underlying_mint: Pubkey,     // 32
    pub vault: Pubkey,               // 32
    pub pt_mint: Pubkey,             // 32
    pub yt_mint: Pubkey,             // 32
    pub maturity: i64,               // 8
    pub pt_reserve: u64,             // 8
    pub yt_reserve: u64,             // 8
    pub total_underlying: u64,       // 8
    pub total_yield_accrued: u64,    // 8
    pub fee_basis_points: u16,       // 2
    pub last_yield_update: i64,      // 8
    pub is_matured: bool,            // 1
}

#[error_code]
pub enum YieldErrors {
    #[msg("Slippage limit exceeded")]
    SlippageExceeded,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid maturity timestamp")]
    InvalidMaturity,
    #[msg("Pool has not matured yet")]
    NotMatured,
    #[msg("Pool is already matured")]
    AlreadyMatured,
    #[msg("Pool has matured, no new operations allowed")]
    PoolMatured,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("No YT balance")]
    NoYtBalance,
    #[msg("Insufficient yield available")]
    InsufficientYield,
}
