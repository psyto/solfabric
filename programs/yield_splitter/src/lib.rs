use anchor_lang::prelude::*;

declare_id!("9tGdavqZd29sZzkWo2kSjytFZtS4VzArwcshf9zvEMVg");

#[program]
pub mod yield_splitter {
    use super::*;

    pub fn initialize_amm(ctx: Context<InitializeAmm>) -> Result<()> {
        let amm = &mut ctx.accounts.amm;
        amm.authority = ctx.accounts.authority.key();
        amm.pt_reserve = 0;
        amm.yt_reserve = 0;
        msg!("YieldSplitter AMM Initialized");
        Ok(())
    }

    pub fn tokenize_yield(ctx: Context<TokenizeYield>, amount: u64) -> Result<()> {
        // Logic to strip yield would go here
        msg!("Tokenizing {} amount into PT/YT", amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeAmm<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 8 + 8)]
    pub amm: Account<'info, AmmPool>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TokenizeYield {}

#[account]
pub struct AmmPool {
    pub authority: Pubkey,
    pub pt_reserve: u64,
    pub yt_reserve: u64,
}
