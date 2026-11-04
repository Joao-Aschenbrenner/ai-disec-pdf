export type LocalHttpService = "LAYA_HTTP" | "OPENCODE_HTTP";

export const LOCAL_HTTP_TRUST = Object.freeze({
  LAYA_HTTP: "UNVERIFIED",
  OPENCODE_HTTP: "UNVERIFIED",
} as const);

export interface LocalHttpDenial {
  service: LocalHttpService;
  trust: "UNVERIFIED";
  decision: "DENY";
  code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED";
  message: string;
}

export function getLocalHttpDenial(service: LocalHttpService): LocalHttpDenial {
  const name = service === "LAYA_HTTP" ? "Laya" : "OpenCode";
  return {
    service,
    trust: LOCAL_HTTP_TRUST[service],
    decision: "DENY",
    code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED",
    message: `${name} indisponível: identidade do serviço HTTP local não verificada.`,
  };
}

export function assertLocalHttpTrusted(service: LocalHttpService): never {
  const denial = getLocalHttpDenial(service);
  const error = new Error(denial.message) as Error & { code: string; service: LocalHttpService };
  error.code = denial.code;
  error.service = service;
  throw error;
}
