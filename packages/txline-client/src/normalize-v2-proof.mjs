const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_U16 = 0xffff;

export const TXLINE_DEVNET = Object.freeze({
  programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
  apiBase: "https://txline-dev.txodds.com/api/",
  dailyScoresRootSeed: "daily_scores_roots",
});

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function requireObject(value, path) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(path, "expected an object");
  }

  return value;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) {
    fail(path, "expected an array");
  }

  return value;
}

function requireSafeInteger(
  value,
  path,
  { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {},
) {
  if (!Number.isSafeInteger(value)) {
    fail(path, "expected a safe integer");
  }

  if (value < minimum || value > maximum) {
    fail(path, `expected a value from ${minimum} to ${maximum}`);
  }

  return value;
}

export function epochDayFromTimestampMs(timestampMs) {
  const timestamp = requireSafeInteger(
    timestampMs,
    "timestampMs",
    { minimum: 0 },
  );

  const epochDay = Math.floor(timestamp / MILLISECONDS_PER_DAY);

  if (epochDay > MAX_U16) {
    fail("timestampMs", "epoch day does not fit in u16");
  }

  return epochDay;
}

export function u16LittleEndianBytes(value) {
  const number = requireSafeInteger(
    value,
    "u16 value",
    { minimum: 0, maximum: MAX_U16 },
  );

  return [number & 0xff, (number >> 8) & 0xff];
}

export function toBytes32(value, path = "value") {
  let bytes;

  if (value instanceof Uint8Array) {
    bytes = value;
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      requireSafeInteger(
        item,
        `${path}[${index}]`,
        { minimum: 0, maximum: 255 },
      );
    }

    bytes = Uint8Array.from(value);
  } else if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
      bytes = Buffer.from(value.slice(2), "hex");
    } else {
      bytes = Buffer.from(value, "base64");
    }
  } else {
    fail(path, "expected byte array, hexadecimal string, or base64 string");
  }

  if (bytes.length !== 32) {
    fail(path, `expected 32 bytes, received ${bytes.length}`);
  }

  return Array.from(bytes);
}

function normalizeProofNode(node, path) {
  const object = requireObject(node, path);

  if (typeof object.isRightSibling !== "boolean") {
    fail(`${path}.isRightSibling`, "expected a boolean");
  }

  return {
    hash: toBytes32(object.hash, `${path}.hash`),
    isRightSibling: object.isRightSibling,
  };
}

function normalizeProofArray(value, path) {
  return requireArray(value, path).map(
    (node, index) => normalizeProofNode(node, `${path}[${index}]`),
  );
}

function normalizeScoreStat(value, path) {
  const stat = requireObject(value, path);

  return {
    key: requireSafeInteger(
      stat.key,
      `${path}.key`,
      { minimum: 0, maximum: 0xffff_ffff },
    ),
    value: requireSafeInteger(
      stat.value,
      `${path}.value`,
      { minimum: -0x8000_0000, maximum: 0x7fff_ffff },
    ),
    period: requireSafeInteger(
      stat.period,
      `${path}.period`,
      { minimum: -0x8000_0000, maximum: 0x7fff_ffff },
    ),
  };
}

export function normalizeV2Proof(rawResponse) {
  const response = requireObject(rawResponse, "response");
  const summary = requireObject(response.summary, "response.summary");
  const updateStats = requireObject(
    summary.updateStats,
    "response.summary.updateStats",
  );

  const timestampMs = requireSafeInteger(
    updateStats.minTimestamp,
    "response.summary.updateStats.minTimestamp",
    { minimum: 0 },
  );

  const statsToProve = requireArray(
    response.statsToProve,
    "response.statsToProve",
  );

  const statProofs = requireArray(
    response.statProofs,
    "response.statProofs",
  );

  if (statsToProve.length === 0) {
    fail("response.statsToProve", "expected at least one stat");
  }

  if (statsToProve.length !== statProofs.length) {
    fail(
      "response.statProofs",
      "length must match response.statsToProve",
    );
  }

  const epochDay = epochDayFromTimestampMs(timestampMs);

  const eventsRoot =
    summary.eventStatsSubTreeRoot ??
    summary.eventsSubTreeRoot;

  const payload = {
    ts: timestampMs,
    fixtureSummary: {
      fixtureId: requireSafeInteger(
        summary.fixtureId,
        "response.summary.fixtureId",
      ),
      updateStats: {
        updateCount: requireSafeInteger(
          updateStats.updateCount,
          "response.summary.updateStats.updateCount",
          { minimum: -0x8000_0000, maximum: 0x7fff_ffff },
        ),
        minTimestamp: timestampMs,
        maxTimestamp: requireSafeInteger(
          updateStats.maxTimestamp,
          "response.summary.updateStats.maxTimestamp",
          { minimum: 0 },
        ),
      },
      eventsSubTreeRoot: toBytes32(
        eventsRoot,
        "response.summary.eventStatsSubTreeRoot",
      ),
    },
    fixtureProof: normalizeProofArray(
      response.subTreeProof,
      "response.subTreeProof",
    ),
    mainTreeProof: normalizeProofArray(
      response.mainTreeProof,
      "response.mainTreeProof",
    ),
    eventStatRoot: toBytes32(
      response.eventStatRoot,
      "response.eventStatRoot",
    ),
    stats: statsToProve.map((stat, index) => ({
      stat: normalizeScoreStat(
        stat,
        `response.statsToProve[${index}]`,
      ),
      statProof: normalizeProofArray(
        statProofs[index],
        `response.statProofs[${index}]`,
      ),
    })),
  };

  return {
    network: "devnet",
    apiBase: TXLINE_DEVNET.apiBase,
    programId: TXLINE_DEVNET.programId,
    epochDay,
    pdaSeeds: {
      utf8: TXLINE_DEVNET.dailyScoresRootSeed,
      epochDayU16Le: u16LittleEndianBytes(epochDay),
    },
    payload,
  };
}

export function buildExactEqualityStrategy(payload) {
  const object = requireObject(payload, "payload");
  const stats = requireArray(object.stats, "payload.stats");

  if (stats.length === 0) {
    fail("payload.stats", "expected at least one stat");
  }

  const strategy = {
    geometricTargets: [],
    distancePredicate: null,
    discretePredicates: stats.map((leaf, index) => {
      const normalizedLeaf = requireObject(
        leaf,
        `payload.stats[${index}]`,
      );

      const stat = requireObject(
        normalizedLeaf.stat,
        `payload.stats[${index}].stat`,
      );

      return {
        single: {
          index,
          predicate: {
            threshold: requireSafeInteger(
              stat.value,
              `payload.stats[${index}].stat.value`,
              {
                minimum: -0x8000_0000,
                maximum: 0x7fff_ffff,
              },
            ),
            comparison: {
              equalTo: {},
            },
          },
        },
      };
    }),
  };

  validateStrategyCoverage(strategy, stats.length);

  return strategy;
}

export function validateStrategyCoverage(strategyValue, statCountValue) {
  const strategy = requireObject(strategyValue, "strategy");

  const statCount = requireSafeInteger(
    statCountValue,
    "statCount",
    { minimum: 1, maximum: 256 },
  );

  const coverage = Array(statCount).fill(0);

  function cover(indexValue, path) {
    const index = requireSafeInteger(
      indexValue,
      path,
      { minimum: 0, maximum: statCount - 1 },
    );

    coverage[index] += 1;
  }

  const geometricTargets = requireArray(
    strategy.geometricTargets ?? [],
    "strategy.geometricTargets",
  );

  geometricTargets.forEach((targetValue, index) => {
    const target = requireObject(
      targetValue,
      `strategy.geometricTargets[${index}]`,
    );

    cover(
      target.statIndex,
      `strategy.geometricTargets[${index}].statIndex`,
    );
  });

  const discretePredicates = requireArray(
    strategy.discretePredicates ?? [],
    "strategy.discretePredicates",
  );

  discretePredicates.forEach((entryValue, index) => {
    const entry = requireObject(
      entryValue,
      `strategy.discretePredicates[${index}]`,
    );

    const hasSingle = Object.hasOwn(entry, "single");
    const hasBinary = Object.hasOwn(entry, "binary");

    if (hasSingle === hasBinary) {
      fail(
        `strategy.discretePredicates[${index}]`,
        "expected exactly one of single or binary",
      );
    }

    if (hasSingle) {
      const single = requireObject(
        entry.single,
        `strategy.discretePredicates[${index}].single`,
      );

      cover(
        single.index,
        `strategy.discretePredicates[${index}].single.index`,
      );

      return;
    }

    const binary = requireObject(
      entry.binary,
      `strategy.discretePredicates[${index}].binary`,
    );

    cover(
      binary.indexA,
      `strategy.discretePredicates[${index}].binary.indexA`,
    );

    cover(
      binary.indexB,
      `strategy.discretePredicates[${index}].binary.indexB`,
    );
  });

  coverage.forEach((count, index) => {
    if (count === 0) {
      fail(
        "strategy",
        `stat index ${index} is not covered`,
      );
    }

    if (count > 1) {
      fail(
        "strategy",
        `stat index ${index} is covered ${count} times`,
      );
    }
  });

  return true;
}
