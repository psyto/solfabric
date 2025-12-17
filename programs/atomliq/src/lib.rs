use anchor_lang::prelude::*;
// use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, get_feed_id_from_hex};

declare_id!("F3xVeUGPhuyMjtWf433WDAyhcA1SbQJjAsySw2d1Pf9G");

#[program]
pub mod atomliq {
    use super::*;

    pub fn execute_liquidation(ctx: Context<ExecuteLiquidation>, amount_in: u64) -> Result<()> {
        // let price_update = &ctx.accounts.price_update;
        
        // 1. Read the price (Solana/USD feed ID as example)
        // In prod, this would be passed or config based.
        // Feed ID for SOL/USD on Pyth
        // let feed_id = get_feed_id_from_hex("0ef15503700b054452145b23e8009bb315b9c704").unwrap();
        
        // let price = price_update.get_price_no_older_than(
        //     &Clock::get()?,
        //     60, // Max age 60 seconds (Pull oracle usually < 1s)
        //     &feed_id
        // )?;

        msg!("Executing Liquidation (Mock Price)...");
        
        // 2. Perform liquidation logic (mocked for now)
        msg!("Liquidating {} amount...", amount_in);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct ExecuteLiquidation<'info> {
    // pub price_update: Account<'info, PriceUpdateV2>,
    /// CHECK: Mock for now
    pub price_update: UncheckedAccount<'info>,
    pub signer: Signer<'info>,
}

