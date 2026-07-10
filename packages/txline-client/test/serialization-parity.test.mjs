import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildReplayBundle } from "../src/replay-v2-proof.mjs";
import { encodeValidateStatV2Data } from "../src/encode-validate-stat-v2.mjs";

const directory = path.dirname(
  fileURLToPath(import.meta.url),
);

test(
  "Node encoder matches the Rust-generated Borsh fixture",
  async () => {
    const rawResponse = JSON.parse(
      await readFile(
        path.join(
          directory,
          "fixtures",
          "sample-v2-response.json",
        ),
        "utf8",
      ),
    );

    const bundle = buildReplayBundle(rawResponse);

    const encoded = encodeValidateStatV2Data(
      bundle.payload,
      bundle.strategies.success,
    );

    const expectedHex = (
      await readFile(
        path.join(
          directory,
          "fixtures",
          "validate-stat-v2.instruction.hex",
        ),
        "utf8",
      )
    ).trim();

    assert.equal(encoded.toString("hex"), expectedHex);

    assert.deepEqual(
      Array.from(encoded.subarray(0, 8)),
      [208, 215, 194, 214, 241, 71, 246, 178],
    );
  },
);
