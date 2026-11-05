import { afterEach, describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { startServer, stopServer } from "../server/server";
import { clearLocalHttpTrust } from "../server/classification/localHttpTrust";

const PORT = 3098;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// fetch original (real) para delegar requisições do servidor de teste.
const originalFetch = globalThis.fetch;

function buildIdentityMock(privateKeyPem: string, expectedFingerprint: string) {
  return vi.fn().mockImplementation(async (...args: any[]) => {
    const input = args[0];
    const init = args[1] || {};
    const url = String(input);
    // Requisições para o próprio servidor de teste (BASE_URL) seguem para o fetch real.
    if (url.startsWith(BASE_URL)) {
      return originalFetch(url, init);
    }
    if (url.includes("/v1/identity?nonce=")) {
      const nonceMatch = url.match(/[?&]nonce=([^&]+)/);
      const nonce = nonceMatch ? decodeURIComponent(nonceMatch[1]) : "";
      const signature = sign("SHA256", Buffer.from(nonce, "base64"), privateKeyPem);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          signature: signature.toString("base64"),
          publicKeyFingerprint: expectedFingerprint,
        }),
      } as unknown as Response;
    }
    if (url.includes("/v1/systemone")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          answers: { document_class: { choice: "nota_fiscal", answer_confidence: 0.95 } },
        }),
      } as unknown as Response;
    }
    if (url.includes("/health")) {
      return { ok: true, status: 200, json: async () => ({ status: "ok" }) } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({ error: "not found" }) } as unknown as Response;
  });
}

const DOCS = [
  {
    name: "DANFE",
    text: "DANFE - Documento Auxiliar da Nota Fiscal Eletronica\nChave de acesso: 1234 5678 9012 3456 7890 1234 5678 9012 3456 7890\nNF-e: 123456",
    expectedClass: "NFE_DANFE",
  },
  {
    name: "NFS-e",
    text: "NOTA FISCAL DE SERVICOS ELETRONICA - NFS-e\nPrestador de servicos: Empresa X\nTomador de servicos: Cliente Y\nValor: R$ 1.500,00",
    expectedClass: "NFS",
  },
  {
    name: "HOLERITE",
    text: "FOLHA MENSAL - HOLERITE\nMensalista: Joao Silva\nVencimentos: R$ 5.000,00\nDescontos: R$ 800,00\nSalario base: R$ 4.200,00\nFGTS: R$ 420,00",
    expectedClass: "HOLERITE",
  },
  {
    name: "DARF",
    text: "DOCUMENTO DE ARRECADACAO DE RECEITAS FEDERAIS - DARF\nReceita Federal do Brasil\nCNPJ: 00.000.000/0001-00\nValor: R$ 2.500,00",
    expectedClass: "DARF",
  },
  {
    name: "FOLHA PAGAMENTO",
    text: "RELATORIO DA FOLHA DE PAGAMENTOS\nNOME CPF AGENCIA/CONTA ACEITO TIPO VALOR\nJoao Silva 111.222.333-44 1234 12345-6 C CORRENTE 5000,00",
    expectedClass: "FOPAG_RESUMO",
  },
];

describe("E2E: documentos sintéticos + classificação V3 (fail-closed)", () => {
  beforeAll(async () => {
    await startServer(PORT, false);
    await new Promise((r) => setTimeout(r, 1000));
  });

  afterAll(() => {
    stopServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearLocalHttpTrust();
    delete process.env.LAYA_IDENTITY_FINGERPRINT;
    delete process.env.LAYA_IDENTITY_PUBLIC_KEY;
    delete process.env.LAYA_URL;
  });

  it("pass1 bloqueado (503) sem identidade Laya verificada - fail-closed", async () => {
    const res = await fetch(`${BASE_URL}/api/classification/pass1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages: [{ pdfBase64: "", pageIndex: 0, text: DOCS[0].text }] }),
    });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.code).toBe("LAYA_REQUIRED");
  });

  it("classifica documentos sintéticos após handshake Laya válido", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const publicKeyPem = publicKey as string;
    const privateKeyPem = privateKey as string;
    const fingerprint = `sha256:${createHash("sha256").update(publicKeyPem).digest("hex")}`;

    process.env.LAYA_IDENTITY_FINGERPRINT = fingerprint;
    process.env.LAYA_IDENTITY_PUBLIC_KEY = publicKeyPem;
    process.env.LAYA_URL = "http://127.0.0.1:8000";

    const fetchMock = buildIdentityMock(privateKeyPem, fingerprint);
    vi.stubGlobal("fetch", fetchMock);

    // Handshake Laya
    const handshakeRes = await fetch(`${BASE_URL}/api/laya/identity-handshake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(handshakeRes.status).toBe(200);

    // Health verificado
    const healthRes = await fetch(`${BASE_URL}/api/classification/health`);
    const healthData = await healthRes.json();
    expect(healthData.layaIdentityVerified).toBe(true);

    // Enviar documentos sintéticos para classificação
    const pages = DOCS.map((d, i) => ({ pdfBase64: "", pageIndex: i, text: d.text }));
    const res = await fetch(`${BASE_URL}/api/classification/pass1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.version).toBe("classification-v3");
    expect(data.pages).toHaveLength(DOCS.length);

    // Verificar que cada documento foi classificado com a classe esperada
    for (let i = 0; i < DOCS.length; i++) {
      const page = data.pages[i];
      expect(page.pageIndex).toBe(i);
      // A assinatura deve reconhecer o documento (não OUTRO, exceto se não houver match)
      expect(page.documentClass).toBeDefined();
      // Documentos com âncoras fortes devem ter classe específica
      if (DOCS[i].expectedClass !== "OUTRO") {
        expect(page.documentClass).not.toBe("OUTRO");
      }
    }

    // Pelo menos um documento deve ser classificado como NFE_DANFE (hard guard)
    const danfePage = data.pages.find((p: any) => p.documentClass === "NFE_DANFE");
    expect(danfePage).toBeDefined();
    expect(danfePage.source).toBe("hard-guard");

    // Sem transmissão de chaves de API no handshake
    const calledUrls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
    expect(calledUrls.some((u: string) => u.includes("/v1/identity?nonce="))).toBe(true);
    expect(calledUrls.every((u: string) => !u.includes("Authorization"))).toBe(true);
    expect(calledUrls.every((u: string) => !u.includes("Bearer"))).toBe(true);
  });

  it("não classifica quando o fingerprint Laya está divergente", async () => {
    const { publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const publicKeyPem = publicKey as string;

    process.env.LAYA_IDENTITY_FINGERPRINT = "sha256:fingerprint-errado";
    process.env.LAYA_IDENTITY_PUBLIC_KEY = publicKeyPem;
    process.env.LAYA_URL = "http://127.0.0.1:8000";

    const fetchMock = buildIdentityMock("fake-private", "sha256:fingerprint-mock");
    vi.stubGlobal("fetch", fetchMock);

    const handshakeRes = await fetch(`${BASE_URL}/api/laya/identity-handshake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(handshakeRes.status).toBe(403);

    // pass1 continua bloqueado
    const res = await fetch(`${BASE_URL}/api/classification/pass1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages: [{ pdfBase64: "", pageIndex: 0, text: DOCS[0].text }] }),
    });
    expect(res.status).toBe(503);
  });
});
