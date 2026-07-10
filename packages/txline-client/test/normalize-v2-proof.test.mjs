import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExactEqualityStrategy,
  epochDayFromTimestampMs,
  normalizeV2Proof,
  validateStrategyCoverage,
} from "../src/normalize-v2-proof.mjs";

const HASH_A = Array.from({ length: 32 }, (_, index) => index);
const HASH_B = Array.from({ length: 32 }, (_, index) => 255 - index);

function sampleResponse() {
  return {
    summary: {
      fixtureId: 18_179_550,
      updateStats: {
        updateCount: 10,
        minTimestamp: 1_750_000_000_000,
        maxTimestamp: 1_750_000_000_100,
      },
      eventStatsSubTreeRoot: HASH_A,
    },
    subTreeProof: [
      {
        hash: HASH_B,
        isRightSibling: false,
      },
    ],
    mainTreeProof: [
      {
        hash: HASH_A,
        isRightSibling: true,
      },
    ],
    eventStatRoot: HASH_B,
    statsToProve: [
      {
        key: 1,
        value: 3,
        period: 100,
      },
    ],
    statProofs: [
      [
        {
          hash: HASH_A,
          isRightSibling: false,
        },
      ],
    ],
  };
}

test("normalizes a TxLINE V2 proof deterministically", () => {
  const normalized = normalizeV2Proof(sampleResponse());

  assert.equal(normalized.network, "devnet");
  assert.equal(
    normalized.programId,
    "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
  );

  assert.equal(
    normalized.epochDay,
    epochDayFromTimestampMs(1_750_000_000_000),
  );

  assert.deepEqual(
    normalized.pdaSeeds.epochDayU16Le,
    [
      normalized.epochDay & 0xff,
      (normalized.epochDay >> 8) & 0xff,
    ],
  );

  assert.equal(normalized.payload.stats.length, 1);
  assert.equal(normalized.payload.stats[0].stat.value, 3);
  assert.equal(
    normalized.payload.fixtureProof[0].hash.length,
    32,
  );
});

test("builds a complete exact-equality strategy", () => {
  const normalized = normalizeV2Proof(sampleResponse());
  const strategy = buildExactEqualityStrategy(normalized.payload);

  assert.equal(
    strategy.discretePredicates[0].single.predicate.threshold,
    3,
  );

  assert.deepEqual(
    strategy.discretePredicates[0].single.predicate.comparison,
    { equalTo: {} },
  );

  assert.equal(
    validateStrategyCoverage(
      strategy,
      normalized.payload.stats.length,
    ),
    true,
  );
});

test("rejects a proof hash that is not 32 bytes", () => {
  const response = sampleResponse();
  response.eventStatRoot = [1, 2, 3];

  assert.throws(
    () => normalizeV2Proof(response),
    /expected 32 bytes/,
  );
});

test("rejects mismatched stats and stat-proof arrays", () => {
  const response = sampleResponse();
  response.statProofs = [];

  assert.throws(
    () => normalizeV2Proof(response),
    /length must match/,
  );
});

test("rejects incomplete or duplicate strategy coverage", () => {
  assert.throws(
    () =>
      validateStrategyCoverage(
        {
          geometricTargets: [],
          discretePredicates: [],
        },
        1,
      ),
    /not covered/,
  );

  assert.throws(
    () =>
      validateStrategyCoverage(
        {
          geometricTargets: [
            {
              statIndex: 0,
              prediction: 2,
            },
          ],
          discretePredicates: [
            {
              single: {
                index: 0,
                predicate: {
                  threshold: 2,
                  comparison: {
                    equalTo: {},
                  },
                },
              },
            },
          ],
        },
        1,
      ),
    /covered 2 times/,
  );
});
