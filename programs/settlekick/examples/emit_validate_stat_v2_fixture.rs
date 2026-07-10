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

fn main() {
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

    let data = encode_validate_stat_v2_data(&payload, &strategy)
        .expect("fixture serialization must succeed");

    for byte in data {
        print!("{byte:02x}");
    }

    println!();
}
