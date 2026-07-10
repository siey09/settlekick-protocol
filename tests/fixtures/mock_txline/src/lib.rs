#![allow(unexpected_cfgs)]

use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, program::set_return_data,
    program_error::ProgramError, pubkey::Pubkey,
};

const VALIDATE_STAT_V2_DISCRIMINATOR: [u8; 8] = [208, 215, 194, 214, 241, 71, 246, 178];

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.get(..8) != Some(VALIDATE_STAT_V2_DISCRIMINATOR.as_slice()) {
        return Err(ProgramError::InvalidInstructionData);
    }

    let daily_scores_root = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;

    let account_data = daily_scores_root.try_borrow_data()?;

    let result = account_data
        .first()
        .copied()
        .ok_or(ProgramError::InvalidAccountData)?;

    match result {
        0 | 1 => {
            set_return_data(&[result]);
            Ok(())
        }
        _ => Err(ProgramError::InvalidAccountData),
    }
}
