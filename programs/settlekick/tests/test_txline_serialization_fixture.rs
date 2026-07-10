use std::{fs, path::PathBuf};

use settlekick::{
    encode_validate_stat_v2_data, Comparison, NDimensionalStrategy, ProofNode, ScoreStat,
    ScoresBatchSummary, ScoresUpdateStats, StatLeaf, StatPredicate, StatValidationInput,
    TraderPredicate,
};

fn ascending_hash() -> [u8; 32] {
    std::array::from_fn(|index| index as u8)
}

fn descending_hash() -> [u8; 32] {
    std::array::from_fn(|index| 255_u8 - index as u8)
}

fn decode_hex(value: &str) -> Vec<u8> {
    let trimmed = value.trim();

    assert_eq!(
        trimmed.len() % 2,
        0,
        "hex fixture must contain complete bytes"
    );

    (0..trimmed.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&trimmed[index..index + 2], 16)
                .expect("fixture must contain valid hexadecimal")
        })
        .collect()
}

#[test]
fn rust_encoder_matches_committed_cross_language_fixture() {
    let payload = StatValidationInput {
        ts: 1_750_000_000_000,
        fixture_summary: ScoresBatchSummary {
            fixture_id: 18_179_550,
            update_stats: ScoresUpdateStats {
                update_count: 10,
                min_timestamp: 1_750_000_000_000,
                max_timestamp: 1_750_000_000_100,
            },
            events_sub_tree_root: ascending_hash(),
        },
        fixture_proof: vec![ProofNode {
            hash: descending_hash(),
            is_right_sibling: false,
        }],
        main_tree_proof: vec![ProofNode {
            hash: ascending_hash(),
            is_right_sibling: true,
        }],
        event_stat_root: descending_hash(),
        stats: vec![StatLeaf {
            stat: ScoreStat {
                key: 1,
                value: 3,
                period: 100,
            },
            stat_proof: vec![ProofNode {
                hash: ascending_hash(),
                is_right_sibling: false,
            }],
        }],
    };

    let strategy = NDimensionalStrategy {
        geometric_targets: vec![],
        distance_predicate: None,
        discrete_predicates: vec![StatPredicate::Single {
            index: 0,
            predicate: TraderPredicate {
                threshold: 3,
                comparison: Comparison::EqualTo,
            },
        }],
    };

    let actual =
        encode_validate_stat_v2_data(&payload, &strategy).expect("serialization must succeed");

    let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/txline-client/test/fixtures/validate-stat-v2.instruction.hex");

    let expected =
        decode_hex(&fs::read_to_string(fixture_path).expect("golden fixture must exist"));

    assert_eq!(actual, expected);
}
