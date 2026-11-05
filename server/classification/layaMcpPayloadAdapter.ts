import { CLASS_LABELS, type DocumentClass } from "./documentTaxonomy";
import type { LayaDecision } from "./layaClient";

export type LayaPayloadErrorCode =
  | "invalid_json"
  | "invalid_payload"
  | "missing_document_class_answer"
  | "invalid_document_class"
  | "invalid_confidence"
  | "laya_tool_error";

export interface LayaPayloadAdapterSuccess {
  ok: true;
  decision: LayaDecision & {
    available: true;
    documentClass: DocumentClass;
    confidence: number;
    reason: "laya";
  };
}

export interface LayaPayloadAdapterFailure {
  ok: false;
  decision: LayaDecision & {
    available: false;
    reason: LayaPayloadErrorCode;
  };
  error: {
    code: LayaPayloadErrorCode;
  };
}

export type LayaPayloadAdapterResult =
  | LayaPayloadAdapterSuccess
  | LayaPayloadAdapterFailure;

type OwnDataProperty =
  | { exists: false }
  | { exists: true; value: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDocumentClass(value: unknown): value is DocumentClass {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(CLASS_LABELS, value);
}

function readOwnDataProperty(
  record: Record<string, unknown>,
  key: string
): OwnDataProperty {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    return { exists: false };
  }

  return { exists: true, value: descriptor.value };
}

function failure(code: LayaPayloadErrorCode): LayaPayloadAdapterFailure {
  return {
    ok: false,
    decision: { available: false, reason: code },
    error: { code },
  };
}

/**
 * Maps only the JSON payload returned inside Laya's laya_predict result.
 * It intentionally does not parse or depend on an MCP CallToolResult envelope.
 */
export function adaptLayaPredictPayload(raw: unknown): LayaPayloadAdapterResult {
  let payload: unknown = raw;

  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      return failure("invalid_json");
    }
  }

  try {
    if (!isRecord(payload)) {
      return failure("invalid_payload");
    }

    if (readOwnDataProperty(payload, "error").exists) {
      return failure("laya_tool_error");
    }

    const answersProperty = readOwnDataProperty(payload, "answers");
    if (!answersProperty.exists) {
      return failure("missing_document_class_answer");
    }
    if (!isRecord(answersProperty.value)) {
      return failure("invalid_payload");
    }

    const answerProperty = readOwnDataProperty(answersProperty.value, "document_class");
    if (!answerProperty.exists) {
      return failure("missing_document_class_answer");
    }
    if (!isRecord(answerProperty.value)) {
      return failure("invalid_payload");
    }

    const choiceProperty = readOwnDataProperty(answerProperty.value, "choice");
    if (!choiceProperty.exists) {
      return failure("missing_document_class_answer");
    }
    if (!isDocumentClass(choiceProperty.value)) {
      return failure("invalid_document_class");
    }

    const preferredConfidence = readOwnDataProperty(
      answerProperty.value,
      "answer_confidence"
    );
    const fallbackConfidence = readOwnDataProperty(
      answerProperty.value,
      "confidence"
    );

    // Match the current HTTP client's nullish fallback order, but do not invent
    // a zero confidence when both source fields are absent.
    const preferredValue = preferredConfidence.exists
      ? preferredConfidence.value
      : undefined;
    const selectedConfidence =
      preferredValue !== null && preferredValue !== undefined
        ? preferredValue
        : fallbackConfidence.exists
          ? fallbackConfidence.value
          : undefined;

    if (
      typeof selectedConfidence !== "number" ||
      !Number.isFinite(selectedConfidence) ||
      selectedConfidence < 0 ||
      selectedConfidence > 1
    ) {
      return failure("invalid_confidence");
    }

    return {
      ok: true,
      decision: {
        available: true,
        documentClass: choiceProperty.value,
        confidence: selectedConfidence,
        reason: "laya",
      },
    };
  } catch {
    // Malformed objects (including throwing proxies) never expose their contents.
    return failure("invalid_payload");
  }
}
