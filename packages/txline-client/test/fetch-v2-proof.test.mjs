import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildProofRequestPlan,
  captureV2Proof,
  fetchHistoricalScores,
  fetchV2StatValidation,
  parseStatKeys,
  selectFinalizedScoreRecord,
  startGuestSession,
} from "../src/fetch-v2-proof.mjs";

const HASH_A =
  Array.from(
    { length: 32 },
    (_, index) => index,
  );

const HASH_B =
  Array.from(
    { length: 32 },
    (_, index) => 255 - index,
  );

function jsonResponse(
  body,
  {
    status = 200,
  } = {},
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type":
          "application/json",
      },
    },
  );
}

function proofResponse() {
  return {
    summary: {
      fixtureId: 18179550,
      updateStats: {
        updateCount: 10,
        minTimestamp:
          1750000000000,
        maxTimestamp:
          1750000000100,
      },
      eventStatsSubTreeRoot:
        HASH_A,
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
    eventStatRoot:
      HASH_B,
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

test(
  "parses ordered unique stat keys",
  () => {
    assert.deepEqual(
      parseStatKeys("1,2,3001"),
      [1, 2, 3001],
    );

    assert.throws(
      () =>
        parseStatKeys("1,1"),
      /duplicate/,
    );
  },
);

test(
  "starts a guest session on the devnet host",
  async () => {
    const calls = [];

    const jwt =
      await startGuestSession({
        fetchImpl:
          async (url, options) => {
            calls.push({
              url,
              options,
            });

            return jsonResponse({
              token:
                "guest-jwt-value",
            });
          },
      });

    assert.equal(
      jwt,
      "guest-jwt-value",
    );

    assert.equal(
      calls[0].url,
      "https://txline-dev.txodds.com/auth/guest/start",
    );

    assert.equal(
      calls[0].options.method,
      "POST",
    );
  },
);

test(
  "fetches historical scores with both credentials",
  async () => {
    const calls = [];

    const records =
      await fetchHistoricalScores({
        fixtureId:
          18179550,
        jwt: "jwt-value",
        apiToken:
          "api-token-value",
        fetchImpl:
          async (url, options) => {
            calls.push({
              url,
              options,
            });

            return jsonResponse([]);
          },
      });

    assert.deepEqual(
      records,
      [],
    );

    assert.equal(
      calls[0].url,
      "https://txline-dev.txodds.com/api/scores/historical/18179550",
    );

    assert.equal(
      calls[0].options.headers
        .Authorization,
      "Bearer jwt-value",
    );

    assert.equal(
      calls[0].options.headers[
        "X-Api-Token"
      ],
      "api-token-value",
    );
  },
);

test(
  "selects the highest valid finalized sequence",
  () => {
    const selected =
      selectFinalizedScoreRecord([
        {
          fixtureId:
            18179550,
          seq: 40,
          action:
            "game_finalised",
          statusId: 100,
          period: 100,
        },
        {
          FixtureId:
            18179550,
          Seq: 42,
          Action:
            "game_finalised",
          StatusId: 100,
          Period: 100,
        },
        {
          fixtureId:
            18179550,
          seq: 43,
          action:
            "score_change",
          statusId: 100,
          period: 100,
        },
      ]);

    assert.equal(
      selected.seq,
      42,
    );

    assert.equal(
      selected.fixtureId,
      18179550,
    );
  },
);

test(
  "preserves stat-key order in the V2 request",
  async () => {
    const calls = [];

    await fetchV2StatValidation({
      fixtureId:
        18179550,
      seq: 42,
      statKeys:
        [2, 1, 3001],
      jwt: "jwt-value",
      apiToken:
        "api-token-value",
      fetchImpl:
        async (url, options) => {
          calls.push({
            url:
              url.toString(),
            options,
          });

          return jsonResponse(
            proofResponse(),
          );
        },
    });

    const url =
      new URL(
        calls[0].url,
      );

    assert.equal(
      url.searchParams.get(
        "fixtureId",
      ),
      "18179550",
    );

    assert.equal(
      url.searchParams.get(
        "seq",
      ),
      "42",
    );

    assert.equal(
      url.searchParams.get(
        "statKeys",
      ),
      "2,1,3001",
    );
  },
);

test(
  "dry-run plan redacts credentials",
  () => {
    const plan =
      buildProofRequestPlan({
        fixtureId:
          18179550,
        statKeys:
          "1,2",
        apiToken:
          "very-secret-token",
        guestJwt:
          "very-secret-jwt",
      });

    const text =
      JSON.stringify(plan);

    assert.equal(
      text.includes(
        "very-secret-token",
      ),
      false,
    );

    assert.equal(
      text.includes(
        "very-secret-jwt",
      ),
      false,
    );

    assert.equal(
      plan.security
        .credentialsPrinted,
      false,
    );
  },
);

test(
  "captures mocked final score and proof without storing credentials",
  async () => {
    const outputDirectory =
      await mkdtemp(
        path.join(
          tmpdir(),
          "settlekick-proof-capture-",
        ),
      );

    const fetchImpl =
      async (url, options) => {
        const address =
          url.toString();

        if (
          address.endsWith(
            "/auth/guest/start",
          )
        ) {
          return jsonResponse({
            token:
              "secret-jwt",
          });
        }

        if (
          address.includes(
            "/api/scores/historical/",
          )
        ) {
          assert.equal(
            options.headers[
              "X-Api-Token"
            ],
            "secret-api-token",
          );

          return jsonResponse([
            {
              fixtureId:
                18179550,
              seq: 42,
              action:
                "game_finalised",
              statusId: 100,
              period: 100,
            },
          ]);
        }

        if (
          address.includes(
            "/api/scores/stat-validation",
          )
        ) {
          return jsonResponse(
            proofResponse(),
          );
        }

        throw new Error(
          `Unexpected request: ${address}`,
        );
      };

    const manifest =
      await captureV2Proof({
        fixtureId:
          18179550,
        statKeys: [1],
        apiToken:
          "secret-api-token",
        fetchImpl,
        outputDirectory,
      });

    const saved =
      JSON.parse(
        await readFile(
          path.join(
            outputDirectory,
            "proof-capture-manifest.json",
          ),
          "utf8",
        ),
      );

    const savedText =
      JSON.stringify(saved);

    assert.equal(
      manifest.request.seq,
      42,
    );

    assert.equal(
      savedText.includes(
        "secret-api-token",
      ),
      false,
    );

    assert.equal(
      savedText.includes(
        "secret-jwt",
      ),
      false,
    );

    assert.equal(
      saved.finalRecord.action,
      "game_finalised",
    );

    assert.equal(
      saved.finalRecord.statusId,
      100,
    );

    assert.equal(
      saved.finalRecord.period,
      100,
    );
  },
);
