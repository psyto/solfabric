use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("9tGdavqZd29sZzkWo2kSjytFZtS4VzArwcshf9zvEMVg");

#[program]
pub mod yield_splitter {
    use super::*;

    pub fn initialize_amm(ctx: Context<InitializeAmm>) -> Result<()> {
        let amm = &mut ctx.accounts.amm;
        amm.authority = ctx.accounts.authority.key();
        amm.pt_reserve = 1000000000; // Initial liquidity stub
        amm.yt_reserve = 1000000000;
        amm.fee_basis_points = 5; // 0.05%
        msg!("YieldSplitter AMM Initialized");
        Ok(())
    }

    pub fn tokenize_yield(ctx: Context<TokenizeYield>, amount: u64) -> Result<()> {
        // In a real implementation:
        // 1. Transfer underlying asset (e.g. JitoSOL) from user to Vault
        // 2. Mint PT and YT 1:1 to user

        // Mint PT
        let seeds = &[
            b"pt_mint",
            ctx.accounts.amm.to_account_info().key.as_ref(), // Bind mints to specific AMM pool
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

        // Mint YT (using same seed pattern logic)
        let seeds_yt = &[
            b"yt_mint",
            ctx.accounts.amm.to_account_info().key.as_ref(),
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
        
        msg!("Tokenized {} underlying into PT/YT", amount);
        Ok(())
    }

    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64, is_pt_to_yt: bool) -> Result<()> {
        let amm = &mut ctx.accounts.amm;
        
        let (reserve_in, reserve_out) = if is_pt_to_yt {
            (amm.pt_reserve, amm.yt_reserve)
        } else {
            (amm.yt_reserve, amm.pt_reserve)
        };

        // Simple Constant Product Math for now: x * y = k
        // New Output = ReserveOut - (k / (ReserveIn + AmountIn))
        
        let k = (reserve_in as u128) * (reserve_out as u128);
        let new_reserve_in = (reserve_in as u128) + (amount_in as u128);
        let new_reserve_out = k / new_reserve_in;
        
        let amount_out_gross = (reserve_out as u128) - new_reserve_out;
        
        // Fee
        let fee = (amount_out_gross * (amm.fee_basis_points as u128)) / 10000;
        let amount_out_net = (amount_out_gross - fee) as u64;

        require!(amount_out_net >= min_amount_out, YieldErrors::SlippageExceeded);

        // Update reserves
        if is_pt_to_yt {
            amm.pt_reserve = new_reserve_in as u64;
            amm.yt_reserve = new_reserve_out as u64;
        } else {
            amm.yt_reserve = new_reserve_in as u64;
            amm.pt_reserve = new_reserve_out as u64;
        };

        msg!("Swapped {} for {}. Fee: {}", amount_in, amount_out_net, fee);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeAmm<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 8 + 8 + 2)]
    pub amm: Account<'info, AmmPool>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TokenizeYield<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    // The AMM Pool state (could also hold the vault info)
    pub amm: Account<'info, AmmPool>,

    // PT Mint - Checks that it is a PDA derived from this AMM
    #[account(
        mut,
        seeds = [b"pt_mint", amm.key().as_ref()],
        bump
    )]
    pub pt_mint: Account<'info, Mint>,

    // YT Mint - Checks that it is a PDA derived from this AMM
    #[account(
        mut,
        seeds = [b"yt_mint", amm.key().as_ref()],
        bump
    )]
    pub yt_mint: Account<'info, Mint>,

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

#[account]
pub struct AmmPool {
    pub authority: Pubkey,
    pub pt_reserve: u64,
    pub yt_reserve: u64,
    pub fee_basis_points: u16,
}

#[error_code]
pub enum YieldErrors {
    #[msg("Slippage limit exceeded.")]
    SlippageExceeded,
}
