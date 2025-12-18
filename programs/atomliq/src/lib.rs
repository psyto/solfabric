use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, get_feed_id_from_hex};

declare_id!("F3xVeUGPhuyMjtWf433WDAyhcA1SbQJjAsySw2d1Pf9G");

// Constants for lending protocol
const MAX_LIQUIDATION_INCENTIVE_BPS: u16 = 500; // 5% liquidation bonus
const LIQUIDATION_THRESHOLD: u16 = 8000; // 80% LTV for liquidation
const PRECISION: u128 = 1_000_000; // 6 decimal precision

#[program]
pub mod atomliq {
    use super::*;

    /// Initialize a lending pool with configuration
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        collateral_feed_id: String,
        debt_feed_id: String,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.collateral_feed_id = collateral_feed_id;
        pool.debt_feed_id = debt_feed_id;
        pool.liquidation_threshold = LIQUIDATION_THRESHOLD;
        pool.liquidation_bonus_bps = MAX_LIQUIDATION_INCENTIVE_BPS;

        msg!("Lending pool initialized");
        Ok(())
    }

    /// Initialize a user position
    pub fn initialize_user(ctx: Context<InitializeUser>) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        user_account.owner = ctx.accounts.owner.key();
        user_account.collateral_amount = 0;
        user_account.debt_amount = 0;
        user_account.pool = ctx.accounts.pool.key();

        msg!("User account initialized");
        Ok(())
    }

    /// Deposit collateral (for testing)
    pub fn deposit_collateral(ctx: Context<UpdatePosition>, amount: u64) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        user_account.collateral_amount = user_account.collateral_amount
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;

        msg!("Deposited {} collateral", amount);
        Ok(())
    }

    /// Borrow (for testing)
    pub fn borrow(ctx: Context<UpdatePosition>, amount: u64) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        user_account.debt_amount = user_account.debt_amount
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;

        msg!("Borrowed {} debt", amount);
        Ok(())
    }

    /// Execute liquidation with Pyth Pull Oracle
    pub fn execute_liquidation(
        ctx: Context<ExecuteLiquidation>,
        amount_to_liquidate: u64,
    ) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let user_account = &mut ctx.accounts.user_account;
        let price_update = &ctx.accounts.price_update;
        let clock = Clock::get()?;

        // 1. Read collateral price from Pyth Pull Oracle
        let collateral_feed_id = get_feed_id_from_hex(&pool.collateral_feed_id)
            .map_err(|_| ErrorCode::InvalidFeedId)?;

        let collateral_price = price_update.get_price_no_older_than(
            &clock,
            60, // Max age 60 seconds (Pull oracle usually < 1s)
            &collateral_feed_id
        )?;

        // 2. Read debt price from Pyth Pull Oracle
        let debt_feed_id = get_feed_id_from_hex(&pool.debt_feed_id)
            .map_err(|_| ErrorCode::InvalidFeedId)?;

        let debt_price = price_update.get_price_no_older_than(
            &clock,
            60,
            &debt_feed_id
        )?;

        msg!("Collateral Price: ${}.{}", collateral_price.price, collateral_price.exponent);
        msg!("Debt Price: ${}.{}", debt_price.price, debt_price.exponent);

        // 3. Calculate health factor
        // Health Factor = (Collateral Value * Liquidation Threshold) / Debt Value
        // Normalized collateral value
        let collateral_value = calculate_value(
            user_account.collateral_amount,
            collateral_price.price,
            collateral_price.exponent,
        )?;

        let debt_value = calculate_value(
            user_account.debt_amount,
            debt_price.price,
            debt_price.exponent,
        )?;

        msg!("Collateral Value: {}", collateral_value);
        msg!("Debt Value: {}", debt_value);

        // Health Factor = (collateral_value * threshold) / debt_value
        let threshold_adjusted_collateral = collateral_value
            .checked_mul(pool.liquidation_threshold as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;

        require!(debt_value > 0, ErrorCode::NoDebt);

        let health_factor = threshold_adjusted_collateral
            .checked_mul(PRECISION)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(debt_value)
            .ok_or(ErrorCode::MathOverflow)?;

        msg!("Health Factor: {}", health_factor);

        // 4. Check if liquidatable (health factor < 1.0 in our precision)
        require!(health_factor < PRECISION, ErrorCode::PositionHealthy);

        // 5. Calculate liquidation amounts
        let max_liquidatable = user_account.debt_amount / 2; // Max 50% of debt
        let actual_liquidation = amount_to_liquidate.min(max_liquidatable);

        require!(actual_liquidation > 0, ErrorCode::InvalidLiquidationAmount);

        // Calculate collateral to seize (with bonus)
        let debt_value_liquidated = calculate_value(
            actual_liquidation,
            debt_price.price,
            debt_price.exponent,
        )?;

        let collateral_value_to_seize = debt_value_liquidated
            .checked_mul(10000 + pool.liquidation_bonus_bps as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;

        // Convert back to collateral amount
        let collateral_to_seize = calculate_amount_from_value(
            collateral_value_to_seize,
            collateral_price.price,
            collateral_price.exponent,
        )?;

        require!(
            collateral_to_seize <= user_account.collateral_amount,
            ErrorCode::InsufficientCollateral
        );

        // 6. Execute liquidation
        user_account.debt_amount = user_account.debt_amount
            .checked_sub(actual_liquidation)
            .ok_or(ErrorCode::MathOverflow)?;

        user_account.collateral_amount = user_account.collateral_amount
            .checked_sub(collateral_to_seize)
            .ok_or(ErrorCode::MathOverflow)?;

        msg!("Liquidation successful!");
        msg!("Debt repaid: {}", actual_liquidation);
        msg!("Collateral seized: {}", collateral_to_seize);

        Ok(())
    }
}

// Helper function to calculate USD value with proper decimal handling
fn calculate_value(amount: u64, price: i64, exponent: i32) -> Result<u128> {
    let amount_scaled = (amount as u128)
        .checked_mul(PRECISION)
        .ok_or(ErrorCode::MathOverflow)?;

    let price_abs = (price.abs() as u128);

    // Handle negative exponents (price is in format price * 10^exponent)
    let value = if exponent < 0 {
        let divisor = 10u128.pow(exponent.abs() as u32);
        amount_scaled
            .checked_mul(price_abs)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(divisor)
            .ok_or(ErrorCode::MathOverflow)?
    } else {
        let multiplier = 10u128.pow(exponent as u32);
        amount_scaled
            .checked_mul(price_abs)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_mul(multiplier)
            .ok_or(ErrorCode::MathOverflow)?
    };

    Ok(value)
}

// Helper function to convert USD value back to token amount
fn calculate_amount_from_value(value: u128, price: i64, exponent: i32) -> Result<u64> {
    let price_abs = price.abs() as u128;

    let amount = if exponent < 0 {
        let multiplier = 10u128.pow(exponent.abs() as u32);
        value
            .checked_mul(multiplier)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(price_abs)
            .ok_or(ErrorCode::MathOverflow)?
    } else {
        let divisor = 10u128.pow(exponent as u32);
        value
            .checked_div(price_abs)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(divisor)
            .ok_or(ErrorCode::MathOverflow)?
    };

    let final_amount = amount
        .checked_div(PRECISION)
        .ok_or(ErrorCode::MathOverflow)?;

    Ok(final_amount as u64)
}

// Account Structures

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(init, payer = authority, space = 8 + LendingPool::INIT_SPACE)]
    pub pool: Account<'info, LendingPool>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeUser<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + UserAccount::INIT_SPACE,
        seeds = [b"user", owner.key().as_ref(), pool.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    pub pool: Account<'info, LendingPool>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePosition<'info> {
    #[account(mut, has_one = owner)]
    pub user_account: Account<'info, UserAccount>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteLiquidation<'info> {
    pub pool: Account<'info, LendingPool>,
    #[account(mut, has_one = pool)]
    pub user_account: Account<'info, UserAccount>,
    pub price_update: Account<'info, PriceUpdateV2>,
    pub liquidator: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct LendingPool {
    pub authority: Pubkey,
    #[max_len(64)]
    pub collateral_feed_id: String,
    #[max_len(64)]
    pub debt_feed_id: String,
    pub liquidation_threshold: u16, // In basis points (8000 = 80%)
    pub liquidation_bonus_bps: u16, // In basis points (500 = 5%)
}

#[account]
#[derive(InitSpace)]
pub struct UserAccount {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub collateral_amount: u64, // Amount of collateral deposited
    pub debt_amount: u64,       // Amount of debt borrowed
}

#[error_code]
pub enum ErrorCode {
    #[msg("Position is healthy and cannot be liquidated")]
    PositionHealthy,
    #[msg("Invalid liquidation amount")]
    InvalidLiquidationAmount,
    #[msg("Insufficient collateral to seize")]
    InsufficientCollateral,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid Pyth feed ID")]
    InvalidFeedId,
    #[msg("User has no debt")]
    NoDebt,
}

