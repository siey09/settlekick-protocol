export const VALIDATE_STAT_V2_DISCRIMINATOR = Buffer.from([
  208, 215, 194, 214, 241, 71, 246, 178,
]);

function concat(...buffers) {
  return Buffer.concat(buffers);
}

function encodeU8(value) {
  const output = Buffer.alloc(1);
  output.writeUInt8(value);
  return output;
}

function encodeBool(value) {
  return encodeU8(value ? 1 : 0);
}

function encodeU32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value);
  return output;
}

function encodeI32(value) {
  const output = Buffer.alloc(4);
  output.writeInt32LE(value);
  return output;
}

function encodeI64(value) {
  const output = Buffer.alloc(8);
  output.writeBigInt64LE(BigInt(value));
  return output;
}

function encodeVec(values, encoder) {
  return concat(
    encodeU32(values.length),
    ...values.map(encoder),
  );
}

function encodeBytes32(value) {
  const output = Buffer.from(value);

  if (output.length !== 32) {
    throw new TypeError(
      `Expected 32 bytes, received ${output.length}`,
    );
  }

  return output;
}

function encodeProofNode(node) {
  return concat(
    encodeBytes32(node.hash),
    encodeBool(node.isRightSibling),
  );
}

function encodeScoresUpdateStats(updateStats) {
  return concat(
    encodeI32(updateStats.updateCount),
    encodeI64(updateStats.minTimestamp),
    encodeI64(updateStats.maxTimestamp),
  );
}

function encodeScoresBatchSummary(summary) {
  return concat(
    encodeI64(summary.fixtureId),
    encodeScoresUpdateStats(summary.updateStats),
    encodeBytes32(summary.eventsSubTreeRoot),
  );
}

function encodeScoreStat(stat) {
  return concat(
    encodeU32(stat.key),
    encodeI32(stat.value),
    encodeI32(stat.period),
  );
}

function encodeStatLeaf(leaf) {
  return concat(
    encodeScoreStat(leaf.stat),
    encodeVec(leaf.statProof, encodeProofNode),
  );
}

export function encodeStatValidationInput(payload) {
  return concat(
    encodeI64(payload.ts),
    encodeScoresBatchSummary(payload.fixtureSummary),
    encodeVec(payload.fixtureProof, encodeProofNode),
    encodeVec(payload.mainTreeProof, encodeProofNode),
    encodeBytes32(payload.eventStatRoot),
    encodeVec(payload.stats, encodeStatLeaf),
  );
}

function encodeComparison(comparison) {
  if (Object.hasOwn(comparison, "greaterThan")) {
    return encodeU8(0);
  }

  if (Object.hasOwn(comparison, "lessThan")) {
    return encodeU8(1);
  }

  if (Object.hasOwn(comparison, "equalTo")) {
    return encodeU8(2);
  }

  throw new TypeError("Unknown comparison variant");
}

function encodeBinaryExpression(expression) {
  if (Object.hasOwn(expression, "add")) {
    return encodeU8(0);
  }

  if (Object.hasOwn(expression, "subtract")) {
    return encodeU8(1);
  }

  throw new TypeError("Unknown binary-expression variant");
}

function encodeTraderPredicate(predicate) {
  return concat(
    encodeI32(predicate.threshold),
    encodeComparison(predicate.comparison),
  );
}

function encodeGeometricTarget(target) {
  return concat(
    encodeU8(target.statIndex),
    encodeI32(target.prediction),
  );
}

function encodeStatPredicate(entry) {
  if (Object.hasOwn(entry, "single")) {
    return concat(
      encodeU8(0),
      encodeU8(entry.single.index),
      encodeTraderPredicate(entry.single.predicate),
    );
  }

  if (Object.hasOwn(entry, "binary")) {
    return concat(
      encodeU8(1),
      encodeU8(entry.binary.indexA),
      encodeU8(entry.binary.indexB),
      encodeBinaryExpression(entry.binary.op),
      encodeTraderPredicate(entry.binary.predicate),
    );
  }

  throw new TypeError("Unknown stat-predicate variant");
}

export function encodeNDimensionalStrategy(strategy) {
  const distancePredicate =
    strategy.distancePredicate === null ||
    strategy.distancePredicate === undefined
      ? encodeU8(0)
      : concat(
          encodeU8(1),
          encodeTraderPredicate(strategy.distancePredicate),
        );

  return concat(
    encodeVec(
      strategy.geometricTargets,
      encodeGeometricTarget,
    ),
    distancePredicate,
    encodeVec(
      strategy.discretePredicates,
      encodeStatPredicate,
    ),
  );
}

export function encodeValidateStatV2Data(
  payload,
  strategy,
) {
  return concat(
    VALIDATE_STAT_V2_DISCRIMINATOR,
    encodeStatValidationInput(payload),
    encodeNDimensionalStrategy(strategy),
  );
}
