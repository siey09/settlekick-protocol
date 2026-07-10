use {
    anchor_lang::{
        prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    std::path::PathBuf,
};

const TIMESTAMP_MS: i64 = 1_750_000_000_000;
const MILLISECONDS_PER_DAY: i64 = 86_400_000;

fn sample_payload() -> settlekick::StatValidationInput {
    settlekick::StatValidationInput {
        ts: TIMESTAMP_MS,
        fixture_summary: settlekick::ScoresBatchSummary {
            fixture_id: 123_456,
            update_stats: settlekick::ScoresUpdateStats {
                update_count: 1,
                min_timestamp: TIMESTAMP_MS,
                max_timestamp: TIMESTAMP_MS,
            },
            events_sub_tree_root: [1_u8; 32],
        },
        fixture_proof: vec![],
        main_tree_proof: vec![],
        event_stat_root: [2_u8; 32],
        stats: vec![settlekick::StatLeaf {
            stat: settlekick::ScoreStat {
                key: 1,
                value: 3,
                period: 100,
            },
            stat_proof: vec![],
        }],
    }
}

fn sample_strategy() -> settlekick::NDimensionalStrategy {
    settlekick::NDimensionalStrategy {
        geometric_targets: vec![],
        distance_predicate: None,
        discrete_predicates: vec![settlekick::StatPredicate::Single {
            index: 0,
            predicate: settlekick::TraderPredicate {
                threshold: 0,
                comparison: settlekick::Comparison::GreaterThan,
            },
        }],
    }
}

fn daily_scores_root() -> Pubkey {
    let epoch_day = u16::try_from(TIMESTAMP_MS.div_euclid(MILLISECONDS_PER_DAY))
        .expect("test timestamp must fit in u16 epoch day");

    Pubkey::find_program_address(
        &[b"daily_scores_roots", &epoch_day.to_le_bytes()],
        &settlekick::TXLINE_DEVNET_PROGRAM_ID,
    )
    .0
}

fn execute_mock_validation(mock_root_value: u8) -> Result<(Pubkey, Vec<u8>, Vec<String>), String> {
    let payer = Keypair::new();
    let root = daily_scores_root();
    let mut svm = LiteSVM::new();

    let settlekick_bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/settlekick.so"
    ));

    svm.add_program(settlekick::id(), settlekick_bytes)
        .map_err(|error| format!("failed to load SettleKick: {error:?}"))?;

    let mock_program_path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/mock_txline.so");

    svm.add_program_from_file(settlekick::TXLINE_DEVNET_PROGRAM_ID, &mock_program_path)
        .map_err(|error| format!("failed to load mock TxLINE program: {error:?}"))?;

    svm.set_account(
        root,
        Account {
            lamports: 1_000_000,
            data: vec![mock_root_value],
            owner: settlekick::TXLINE_DEVNET_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .map_err(|error| format!("failed to create mock daily-root account: {error:?}"))?;

    svm.airdrop(&payer.pubkey(), 1_000_000_000)
        .map_err(|error| format!("failed to fund payer: {error:?}"))?;

    let instruction = Instruction::new_with_bytes(
        settlekick::id(),
        &settlekick::instruction::ValidateTxline {
            payload: sample_payload(),
            strategy: sample_strategy(),
        }
        .data(),
        settlekick::accounts::ValidateTxline {
            txline_program: settlekick::TXLINE_DEVNET_PROGRAM_ID,
            daily_scores_merkle_roots: root,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();

    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);

    let transaction = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[&payer])
        .map_err(|error| format!("failed to sign transaction: {error:?}"))?;

    match svm.send_transaction(transaction) {
        Ok(metadata) => Ok((
            metadata.return_data.program_id,
            metadata.return_data.data,
            metadata.logs,
        )),
        Err(error) => Err(format!("{error:?}")),
    }
}

#[test]
fn mock_txline_true_result_crosses_cpi_boundary() {
    let (return_program, return_data, logs) =
        execute_mock_validation(1).expect("mock TxLINE true result must succeed");

    assert_eq!(return_program, settlekick::id());
    assert_eq!(return_data, vec![1]);

    assert!(
        logs.iter()
            .any(|line| { line.contains("TxLINE validate_stat_v2 result: true") }),
        "expected SettleKick success log, got: {logs:#?}"
    );
}

#[test]
fn mock_txline_false_result_is_a_valid_rejection() {
    let (return_program, return_data, logs) =
        execute_mock_validation(0).expect("mock TxLINE false result must be returned normally");

    assert_eq!(return_program, settlekick::id());
    assert_eq!(return_data, vec![0]);

    assert!(
        logs.iter()
            .any(|line| { line.contains("TxLINE validate_stat_v2 result: false") }),
        "expected SettleKick rejection log, got: {logs:#?}"
    );
}

#[test]
fn malformed_mock_root_data_fails_the_cpi_transaction() {
    let error = execute_mock_validation(2).expect_err("malformed mock data must fail");

    assert!(
        error.contains("InvalidAccountData") || error.contains("InvalidAccount"),
        "unexpected transaction error: {error}"
    );
}
