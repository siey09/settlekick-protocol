use anchor_lang::{
    prelude::*,
    solana_program::program::{get_return_data, invoke},
};

use crate::{
    error::ErrorCode,
    txline::{
        build_validate_stat_v2_instruction, NDimensionalStrategy, StatValidationInput,
        TXLINE_DEVNET_PROGRAM_ID,
    },
};

const MILLISECONDS_PER_DAY: i64 = 86_400_000;
const MAX_CPI_INSTRUCTION_DATA_LEN: usize = 10_240;
const DAILY_SCORES_ROOT_SEED: &[u8] = b"daily_scores_roots";

#[derive(Accounts)]
pub struct ValidateTxline<'info> {
    /// CHECK: The exact address and executable flag are validated by the handler.
    pub txline_program: UncheckedAccount<'info>,

    /// CHECK: The PDA address and owner are validated before the CPI.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,
}

pub fn handle_validate_txline(
    ctx: Context<ValidateTxline>,
    payload: StatValidationInput,
    strategy: NDimensionalStrategy,
) -> Result<bool> {
    let txline_program = ctx.accounts.txline_program.to_account_info();
    let daily_scores_root = ctx.accounts.daily_scores_merkle_roots.to_account_info();

    require_keys_eq!(
        txline_program.key(),
        TXLINE_DEVNET_PROGRAM_ID,
        ErrorCode::InvalidTxlineProgram
    );

    require!(
        txline_program.executable,
        ErrorCode::TxlineProgramNotExecutable
    );

    let expected_root = expected_daily_scores_root(payload.ts)?;

    require_keys_eq!(
        daily_scores_root.key(),
        expected_root,
        ErrorCode::InvalidDailyScoresRootPda
    );

    require_keys_eq!(
        *daily_scores_root.owner,
        TXLINE_DEVNET_PROGRAM_ID,
        ErrorCode::InvalidDailyScoresRootOwner
    );

    let instruction =
        build_validate_stat_v2_instruction(daily_scores_root.key(), &payload, &strategy)
            .map_err(|_| error!(ErrorCode::TxlineInstructionSerializationFailed))?;

    require!(
        instruction.data.len() <= MAX_CPI_INSTRUCTION_DATA_LEN,
        ErrorCode::TxlineInstructionTooLarge
    );

    invoke(
        &instruction,
        &[daily_scores_root.clone(), txline_program.clone()],
    )?;

    let (return_program_id, return_data) =
        get_return_data().ok_or_else(|| error!(ErrorCode::MissingTxlineReturnData))?;

    require_keys_eq!(
        return_program_id,
        TXLINE_DEVNET_PROGRAM_ID,
        ErrorCode::UnexpectedTxlineReturnProgram
    );

    let validation_result = decode_txline_bool(&return_data)?;

    msg!("TxLINE validate_stat_v2 result: {}", validation_result);

    Ok(validation_result)
}

fn expected_daily_scores_root(timestamp_ms: i64) -> Result<Pubkey> {
    let epoch_day = timestamp_ms.div_euclid(MILLISECONDS_PER_DAY);

    let epoch_day =
        u16::try_from(epoch_day).map_err(|_| error!(ErrorCode::InvalidProofTimestamp))?;

    let epoch_day_bytes = epoch_day.to_le_bytes();

    let (daily_scores_root, _) = Pubkey::find_program_address(
        &[DAILY_SCORES_ROOT_SEED, &epoch_day_bytes],
        &TXLINE_DEVNET_PROGRAM_ID,
    );

    Ok(daily_scores_root)
}

fn decode_txline_bool(data: &[u8]) -> Result<bool> {
    match data {
        [0] => Ok(false),
        [1] => Ok(true),
        _ => err!(ErrorCode::InvalidTxlineReturnData),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_valid_txline_boolean_return_data() {
        assert!(!decode_txline_bool(&[0]).unwrap());
        assert!(decode_txline_bool(&[1]).unwrap());
    }

    #[test]
    fn rejects_malformed_txline_boolean_return_data() {
        assert!(decode_txline_bool(&[]).is_err());
        assert!(decode_txline_bool(&[2]).is_err());
        assert!(decode_txline_bool(&[1, 0]).is_err());
    }

    #[test]
    fn root_pda_is_stable_within_the_same_epoch_day() {
        let start = 1_750_000_000_000_i64;
        let later = start + 60_000;

        assert_eq!(
            expected_daily_scores_root(start).unwrap(),
            expected_daily_scores_root(later).unwrap()
        );
    }

    #[test]
    fn root_pda_changes_for_a_different_epoch_day() {
        let start = 1_750_000_000_000_i64;
        let next_day = start + MILLISECONDS_PER_DAY;

        assert_ne!(
            expected_daily_scores_root(start).unwrap(),
            expected_daily_scores_root(next_day).unwrap()
        );
    }

    #[test]
    fn rejects_negative_epoch_day() {
        assert!(expected_daily_scores_root(-1).is_err());
    }
}
