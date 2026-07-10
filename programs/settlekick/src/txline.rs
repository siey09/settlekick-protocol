use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

/// Official TxLINE devnet program from the pinned IDL v1.5.5.
pub const TXLINE_DEVNET_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    86, 117, 159, 44, 144, 95, 120, 96, 200, 99, 119, 20, 191, 36, 145, 48, 157, 192, 113, 129, 81,
    63, 122, 36, 191, 62, 218, 248, 127, 119, 80, 3,
]);

/// Anchor discriminator for TxLINE `validate_stat_v2`.
pub const VALIDATE_STAT_V2_DISCRIMINATOR: [u8; 8] = [208, 215, 194, 214, 241, 71, 246, 178];

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct StatLeaf {
    pub stat: ScoreStat,
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct StatValidationInput {
    pub ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub event_stat_root: [u8; 32],
    pub stats: Vec<StatLeaf>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum BinaryExpression {
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct GeometricTarget {
    pub stat_index: u8,
    pub prediction: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum StatPredicate {
    Single {
        index: u8,
        predicate: TraderPredicate,
    },
    Binary {
        index_a: u8,
        index_b: u8,
        op: BinaryExpression,
        predicate: TraderPredicate,
    },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct NDimensionalStrategy {
    pub geometric_targets: Vec<GeometricTarget>,
    pub distance_predicate: Option<TraderPredicate>,
    pub discrete_predicates: Vec<StatPredicate>,
}

/// Encodes the exact Anchor instruction data expected by:
///
/// validate_stat_v2(payload: StatValidationInput,
///                  strategy: NDimensionalStrategy)
///
/// Layout:
/// [8-byte discriminator][Borsh payload][Borsh strategy]
pub fn encode_validate_stat_v2_data(
    payload: &StatValidationInput,
    strategy: &NDimensionalStrategy,
) -> std::io::Result<Vec<u8>> {
    let mut data = VALIDATE_STAT_V2_DISCRIMINATOR.to_vec();

    payload.serialize(&mut data)?;
    strategy.serialize(&mut data)?;

    Ok(data)
}

/// Builds the external TxLINE instruction.
///
/// The TxLINE IDL declares one non-signer, read-only instruction account:
/// `daily_scores_merkle_roots`.
pub fn build_validate_stat_v2_instruction(
    daily_scores_merkle_roots: Pubkey,
    payload: &StatValidationInput,
    strategy: &NDimensionalStrategy,
) -> std::io::Result<Instruction> {
    Ok(Instruction {
        program_id: TXLINE_DEVNET_PROGRAM_ID,
        accounts: vec![AccountMeta::new_readonly(daily_scores_merkle_roots, false)],
        data: encode_validate_stat_v2_data(payload, strategy)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn serialize<T: AnchorSerialize>(value: &T) -> Vec<u8> {
        let mut bytes = Vec::new();
        value
            .serialize(&mut bytes)
            .expect("test value must serialize");

        bytes
    }

    fn sample_payload() -> StatValidationInput {
        StatValidationInput {
            ts: 1_750_000_000,
            fixture_summary: ScoresBatchSummary {
                fixture_id: 123_456,
                update_stats: ScoresUpdateStats {
                    update_count: 10,
                    min_timestamp: 1_750_000_000,
                    max_timestamp: 1_750_000_100,
                },
                events_sub_tree_root: [1_u8; 32],
            },
            fixture_proof: vec![],
            main_tree_proof: vec![],
            event_stat_root: [2_u8; 32],
            stats: vec![StatLeaf {
                stat: ScoreStat {
                    key: 1,
                    value: 3,
                    period: 100,
                },
                stat_proof: vec![],
            }],
        }
    }

    fn sample_strategy() -> NDimensionalStrategy {
        NDimensionalStrategy {
            geometric_targets: vec![],
            distance_predicate: None,
            discrete_predicates: vec![StatPredicate::Single {
                index: 0,
                predicate: TraderPredicate {
                    threshold: 2,
                    comparison: Comparison::GreaterThan,
                },
            }],
        }
    }

    #[test]
    fn txline_program_id_bytes_match_verified_devnet_address() {
        assert_eq!(
            TXLINE_DEVNET_PROGRAM_ID.to_string(),
            "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"
        );
    }

    #[test]
    fn comparison_variant_order_matches_idl() {
        assert_eq!(serialize(&Comparison::GreaterThan), vec![0]);
        assert_eq!(serialize(&Comparison::LessThan), vec![1]);
        assert_eq!(serialize(&Comparison::EqualTo), vec![2]);
    }

    #[test]
    fn binary_expression_variant_order_matches_idl() {
        assert_eq!(serialize(&BinaryExpression::Add), vec![0]);
        assert_eq!(serialize(&BinaryExpression::Subtract), vec![1]);
    }

    #[test]
    fn single_predicate_layout_matches_idl_field_order() {
        let predicate = StatPredicate::Single {
            index: 7,
            predicate: TraderPredicate {
                threshold: 2,
                comparison: Comparison::GreaterThan,
            },
        };

        assert_eq!(
            serialize(&predicate),
            vec![
                0, // StatPredicate::Single
                7, // index
                2, 0, 0, 0, // threshold i32 little-endian
                0, // Comparison::GreaterThan
            ]
        );
    }

    #[test]
    fn binary_predicate_layout_matches_idl_field_order() {
        let predicate = StatPredicate::Binary {
            index_a: 0,
            index_b: 1,
            op: BinaryExpression::Add,
            predicate: TraderPredicate {
                threshold: 3,
                comparison: Comparison::GreaterThan,
            },
        };

        assert_eq!(
            serialize(&predicate),
            vec![
                1, // StatPredicate::Binary
                0, // index_a
                1, // index_b
                0, // BinaryExpression::Add
                3, 0, 0, 0, // threshold i32 little-endian
                0, // Comparison::GreaterThan
            ]
        );
    }

    #[test]
    fn instruction_data_starts_with_verified_discriminator() {
        let data = encode_validate_stat_v2_data(&sample_payload(), &sample_strategy())
            .expect("instruction data must serialize");

        assert!(data.len() > VALIDATE_STAT_V2_DISCRIMINATOR.len());

        assert_eq!(&data[..8], VALIDATE_STAT_V2_DISCRIMINATOR.as_slice());
    }

    #[test]
    fn instruction_uses_verified_program_and_readonly_root() {
        let root = Pubkey::new_unique();

        let instruction =
            build_validate_stat_v2_instruction(root, &sample_payload(), &sample_strategy())
                .expect("instruction must build");

        assert_eq!(instruction.program_id, TXLINE_DEVNET_PROGRAM_ID);
        assert_eq!(instruction.accounts.len(), 1);
        assert_eq!(instruction.accounts[0].pubkey, root);
        assert!(!instruction.accounts[0].is_signer);
        assert!(!instruction.accounts[0].is_writable);
    }
}
