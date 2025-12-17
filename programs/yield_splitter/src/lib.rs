use anchor_lang::prelude::*;

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
        // Logic to strip yield would go here
        msg!("Tokenizing {} amount into PT/YT", amount);
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
pub struct TokenizeYield {}

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
