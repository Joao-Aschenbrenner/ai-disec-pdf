import { describe, expect, it } from "vitest";
import { CLASS_LABELS, DOCUMENT_CLASSES } from "../server/classification/documentTaxonomy";
import {
  adaptLayaPredictPayload,
  type LayaPayloadErrorCode,
} from "../server/classification/layaMcpPayloadAdapter";

function payload(
  answer: Record<string, unknown>,
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    answers: { document_class: answer },
    ...extras,
  };
}

function expectFailure(
  result: ReturnType<typeof adaptLayaPredictPayload>,
  code: LayaPayloadErrorCode
): void {
  if (result.ok !== false) {
    throw new Error("Expected a synthetic adapter failure");
  }
  expect(result.error.code).toBe(code);
  expect(result.decision).toEqual({ available: false, reason: code });
}

describe("Laya MCP inner-payload adapter", () => {
  it("keeps DOCUMENT_CLASSES and own CLASS_LABELS keys exactly aligned", () => {
    const ownLabelKeys = Object.getOwnPropertyNames(CLASS_LABELS)
      .filter((key) => Object.prototype.hasOwnProperty.call(CLASS_LABELS, key));

    expect(DOCUMENT_CLASSES).toHaveLength(new Set(DOCUMENT_CLASSES).size);
    expect(DOCUMENT_CLASSES.every((documentClass) => ownLabelKeys.includes(documentClass))).toBe(true);
    expect(ownLabelKeys.every((labelKey) => DOCUMENT_CLASSES.some((documentClass) => documentClass === labelKey))).toBe(true);
  });

  it("maps a valid JSON string to a LayaDecision-compatible result", () => {
    const result = adaptLayaPredictPayload(JSON.stringify(payload({
      type: "choice",
      choice: "NFS",
      answer_confidence: 0.93,
      confidence: 0.71,
    })));

    expect(result).toEqual({
      ok: true,
      decision: {
        available: true,
        documentClass: "NFS",
        confidence: 0.93,
        reason: "laya",
      },
    });
  });

  it("accepts each exact DocumentClass label", () => {
    for (const documentClass of DOCUMENT_CLASSES) {
      const result = adaptLayaPredictPayload(payload({
        choice: documentClass,
        answer_confidence: 0.5,
      }));

      expect(result.ok, documentClass).toBe(true);
      if (result.ok) {
        expect(result.decision.documentClass).toBe(documentClass);
      }
    }
  });

  it.each([0, 1])("accepts the confidence boundary %s", (confidence) => {
    const result = adaptLayaPredictPayload(payload({
      choice: "NFE_DANFE",
      answer_confidence: confidence,
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.confidence).toBe(confidence);
    }
  });

  it("prefers answer_confidence to confidence", () => {
    const result = adaptLayaPredictPayload(payload({
      choice: "HOLERITE",
      answer_confidence: 0.81,
      confidence: 0.42,
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.confidence).toBe(0.81);
    }
  });

  it("uses confidence when answer_confidence is absent, undefined, or null", () => {
    const answers: Record<string, unknown>[] = [
      { choice: "DARF", confidence: 0.64 },
      { choice: "DARF", answer_confidence: undefined, confidence: 0.64 },
      { choice: "DARF", answer_confidence: null, confidence: 0.64 },
    ];

    for (const answer of answers) {
      const result = adaptLayaPredictPayload(payload(answer));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.decision.confidence).toBe(0.64);
      }
    }
  });

  it("does not invent confidence when both confidence fields are absent", () => {
    const result = adaptLayaPredictPayload(payload({ choice: "NFS" }));

    expectFailure(result, "invalid_confidence");
  });

  it("rejects null answer_confidence when the fallback is invalid", () => {
    expectFailure(
      adaptLayaPredictPayload(payload({
        choice: "NFS",
        answer_confidence: null,
        confidence: 1.2,
      })),
      "invalid_confidence"
    );
  });

  it("rejects an unknown, missing, or non-string class", () => {
    expectFailure(
      adaptLayaPredictPayload(payload({
        choice: "SYNTHETIC_UNKNOWN_CLASS",
        answer_confidence: 0.9,
      })),
      "invalid_document_class"
    );
    expectFailure(
      adaptLayaPredictPayload(payload({ answer_confidence: 0.9 })),
      "missing_document_class_answer"
    );
    expectFailure(
      adaptLayaPredictPayload(payload({
        choice: 7,
        answer_confidence: 0.9,
      })),
      "invalid_document_class"
    );
  });

  it("does not accept inherited object property names as classes", () => {
    for (const choice of ["toString", "__proto__", "constructor"]) {
      expectFailure(
        adaptLayaPredictPayload(payload({
          choice,
          answer_confidence: 0.9,
        })),
        "invalid_document_class"
      );
    }
  });

  it.each([
    ["numeric string", "0.8"],
    ["negative", -0.01],
    ["above one", 1.01],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
  ])("rejects invalid preferred confidence: %s", (_label, confidence) => {
    expectFailure(
      adaptLayaPredictPayload(payload({
        choice: "NFS",
        answer_confidence: confidence,
        confidence: 0.8,
      })),
      "invalid_confidence"
    );
  });

  it("rejects invalid fallback confidence", () => {
    expectFailure(
      adaptLayaPredictPayload(payload({
        choice: "NFS",
        confidence: 1.5,
      })),
      "invalid_confidence"
    );
  });

  it("does not hide invalid answer_confidence with a valid fallback", () => {
    expectFailure(
      adaptLayaPredictPayload(payload({
        choice: "NFS",
        answer_confidence: "0.9",
        confidence: 0.8,
      })),
      "invalid_confidence"
    );
  });

  it("reports malformed JSON without exposing the input", () => {
    const raw = "SYNTHETIC_PRIVATE_MARKER not-json";
    const result = adaptLayaPredictPayload(raw);

    expectFailure(result, "invalid_json");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_MARKER");
  });

  it.each([
    ["null", null],
    ["array", []],
    ["number", 3],
    ["boolean", true],
    ["primitive string", "true"],
  ])("rejects a non-object top-level value: %s", (_label, raw) => {
    expectFailure(adaptLayaPredictPayload(raw), "invalid_payload");
  });

  it("rejects missing and malformed answer containers", () => {
    expectFailure(
      adaptLayaPredictPayload({}),
      "missing_document_class_answer"
    );
    expectFailure(
      adaptLayaPredictPayload({ answers: [] }),
      "invalid_payload"
    );
    expectFailure(
      adaptLayaPredictPayload({ answers: { document_class: [] } }),
      "invalid_payload"
    );
    expectFailure(
      adaptLayaPredictPayload({ answers: { other_question: { choice: "NFS" } } }),
      "missing_document_class_answer"
    );
  });

  it("rejects inherited answers and sanitizes the result", () => {
    const marker = "SYNTHETIC_INHERITED_ANSWERS";
    const raw = Object.create({
      answers: { document_class: { choice: marker, answer_confidence: 0.9 } },
    });
    const result = adaptLayaPredictPayload(raw);

    expectFailure(result, "missing_document_class_answer");
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("rejects inherited document_class and sanitizes the result", () => {
    const marker = "SYNTHETIC_INHERITED_DOCUMENT_CLASS";
    const answers = Object.create({
      document_class: { choice: marker, answer_confidence: 0.9 },
    });
    const result = adaptLayaPredictPayload({ answers });

    expectFailure(result, "missing_document_class_answer");
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("rejects inherited choice and sanitizes the result", () => {
    const marker = "SYNTHETIC_INHERITED_CHOICE";
    const answer = Object.create({ choice: marker });
    answer.answer_confidence = 0.9;
    const result = adaptLayaPredictPayload({
      answers: { document_class: answer },
    });

    expectFailure(result, "missing_document_class_answer");
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("sanitizes a proxy that throws while the payload is inspected", () => {
    const marker = "SYNTHETIC_PROXY_SENTINEL";
    const raw = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error(marker);
      },
    });
    const result = adaptLayaPredictPayload(raw);

    expectFailure(result, "invalid_payload");
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("ignores JSON __proto__ and constructor fields", () => {
    const marker = "SYNTHETIC_PROTO_SENTINEL";
    const constructorMarker = "SYNTHETIC_CONSTRUCTOR_SENTINEL";
    const raw = '{"__proto__":{"answers":{"document_class":{"choice":"' + marker + '","answer_confidence":1}}},"constructor":{"answers":{"document_class":{"choice":"' + constructorMarker + '","answer_confidence":1}}},"answers":{"document_class":{"choice":"NFS","answer_confidence":0.5}}}';
    const result = adaptLayaPredictPayload(raw);

    expect(result).toEqual({
      ok: true,
      decision: {
        available: true,
        documentClass: "NFS",
        confidence: 0.5,
        reason: "laya",
      },
    });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(result)).not.toContain(constructorMarker);
    expect(Object.prototype).not.toHaveProperty("answers");
  });

  it("ignores unrelated fields without returning or logging them", () => {
    const secretMarker = "SYNTHETIC_PRIVATE_MARKER";
    const result = adaptLayaPredictPayload(payload(
      {
        type: "choice",
        choice: "EXTRATO_CC",
        answer_confidence: 0.88,
        probabilities: { OUTRO: 0.99 },
        extra_answer_field: secretMarker,
      },
      {
        routing: { model: "synthetic-model" },
        latency_ms: 123,
        device: "cpu",
        extra_top_level_field: secretMarker,
      }
    ));

    expect(result).toEqual({
      ok: true,
      decision: {
        available: true,
        documentClass: "EXTRATO_CC",
        confidence: 0.88,
        reason: "laya",
      },
    });
    expect(JSON.stringify(result)).not.toContain(secretMarker);
  });

  it("does not infer class from probabilities when choice is missing", () => {
    expectFailure(
      adaptLayaPredictPayload(payload({
        answer_confidence: 0.99,
        probabilities: { NFS: 0.99 },
      })),
      "missing_document_class_answer"
    );
  });

  it("maps Laya tool errors without exposing their message or state", () => {
    const result = adaptLayaPredictPayload({
      error: "internal_error",
      message: "SYNTHETIC_PRIVATE_MARKER",
      state: { body: "SYNTHETIC_PRIVATE_MARKER" },
    });

    expectFailure(result, "laya_tool_error");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_MARKER");
  });

  it("does not invoke or expose a throwing getter for sensitive state", () => {
    const marker = "SYNTHETIC_SENSITIVE_GETTER_SENTINEL";
    let getterExecutions = 0;
    const raw = payload({ choice: "NFS", answer_confidence: 0.91 });
    Object.defineProperty(raw, "state", {
      enumerable: true,
      get() {
        getterExecutions += 1;
        throw new Error(marker);
      },
    });

    const result = adaptLayaPredictPayload(raw);

    expect(result.ok).toBe(true);
    expect(getterExecutions).toBe(0);
    expect(JSON.stringify(result)).not.toContain(marker);
  });
});
