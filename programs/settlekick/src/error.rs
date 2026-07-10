use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Only the counter authority can update this counter")]
    Unauthorized,

    #[msg("Counter has reached the maximum value")]
    CounterOverflow,

    #[msg("The supplied TxLINE program does not match the pinned devnet program")]
    InvalidTxlineProgram,

    #[msg("The supplied TxLINE program account is not executable")]
    TxlineProgramNotExecutable,

    #[msg("The proof timestamp cannot be converted to a valid TxLINE epoch day")]
    InvalidProofTimestamp,

    #[msg("The supplied daily scores root does not match the timestamp-derived TxLINE PDA")]
    InvalidDailyScoresRootPda,

    #[msg("The daily scores root account is not owned by the TxLINE program")]
    InvalidDailyScoresRootOwner,

    #[msg("Failed to serialize the TxLINE validate_stat_v2 instruction")]
    TxlineInstructionSerializationFailed,

    #[msg("The encoded TxLINE CPI instruction exceeds Solana's size limit")]
    TxlineInstructionTooLarge,

    #[msg("TxLINE returned no validation result")]
    MissingTxlineReturnData,

    #[msg("Return data was not produced by the pinned TxLINE program")]
    UnexpectedTxlineReturnProgram,

    #[msg("TxLINE returned malformed boolean data")]
    InvalidTxlineReturnData,
}
