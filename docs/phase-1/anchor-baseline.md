# Phase 1 Anchor Baseline

## Status

Local Anchor scaffold builds successfully.

This is not yet evidence of a successful TxLINE CPI or devnet deployment.

## SettleKick Program

- Local generated program ID: `8pKvbZeZ51K6JMxhqwxx3nv5JGvWe87EQ9ToupRVMfSk`
- Network target: Solana devnet
- Build artifact: `target/deploy/settlekick.so`
- Generated IDL: `target/idl/settlekick.json`

## Toolchain

- Rust: `rustc 1.97.0 (2d8144b78 2026-07-07)`
- Cargo: `cargo 1.97.0 (c980f4866 2026-06-30)`
- Solana: `solana-cli 3.1.10 (src:7bc9c805; feat:1620780344, client:Agave)`
- Anchor: `anchor-cli 1.1.2`
- Node: `v24.10.0`
- Surfpool: `surfpool 1.4.0`

## Pinned TxLINE Devnet Reference

- Repository commit: `265d8859b9f6308682ef0b618c525c5b2655f083`
- IDL version: `1.5.5`
- Program ID: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- IDL SHA-256: `2406a8c7d34abe467922621843758f747a54c3f7aaacb1cd712b1d313972691d`
- validate_stat_v2 discriminator: `[208, 215, 194, 214, 241, 71, 246, 178]`

## Remaining Phase 1 Evidence

- Exact CPI instruction serialization
- Exact account mapping
- Return-data handling
- Local mock CPI test
- Real historical TxLINE proof
- Confirmed devnet transaction
- Invalid-proof or invalid-predicate rejection test
