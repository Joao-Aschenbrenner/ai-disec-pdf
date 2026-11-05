export type LocalHttpService = "LAYA_HTTP" | "OPENCODE_HTTP";
export type LocalHttpTrustLevel = "UNVERIFIED" | "TRUSTED";

/** Baseline congelado: nenhum serviço HTTP local é confiável por identidade. */
export const LOCAL_HTTP_TRUST = Object.freeze({
  LAYA_HTTP: "UNVERIFIED",
  OPENCODE_HTTP: "UNVERIFIED",
} as const);

/** Serviços cuja identidade foi comprovada por handshake real (mutável em runtime). */
const verifiedLocalHttpServices = new Set<LocalHttpService>();

export interface LocalHttpDenial {
  service: LocalHttpService;
  trust: "UNVERIFIED";
  decision: "DENY";
  code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED";
  message: string;
}

/** Nível de confiança efetivo do serviço: TRUSTED somente após handshake de identidade. */
export function getLocalHttpTrustLevel(service: LocalHttpService): LocalHttpTrustLevel {
  return verifiedLocalHttpServices.has(service) ? "TRUSTED" : LOCAL_HTTP_TRUST[service];
}

export function isLocalHttpTrusted(service: LocalHttpService): boolean {
  return getLocalHttpTrustLevel(service) === "TRUSTED";
}

/**
 * Marca um serviço como identidade comprovada. Chamado apenas após um handshake
 * de desafio-resposta validado contra a chave pública esperada do serviço.
 */
export function markLocalHttpTrusted(service: LocalHttpService): void {
  verifiedLocalHttpServices.add(service);
}

/** Remove a marca de confiança de um serviço (uso em testes e reset de sessão). */
export function clearLocalHttpTrust(service?: LocalHttpService): void {
  if (service) {
    verifiedLocalHttpServices.delete(service);
  } else {
    verifiedLocalHttpServices.clear();
  }
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
