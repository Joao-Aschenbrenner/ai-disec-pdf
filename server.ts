import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const NVIDIA_API_URL = "https://api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "meta/llama-3.2-90b-vision-instruct";
let serverInstance: any = null;

export async function startServer(port: number = 3000, isDev: boolean = false) {
  const app = express();
  const PORT = port;

  app.use(express.json({ limit: "50mb" }));

  app.post("/api/extract", async (req, res) => {
    try {
      const { pdfBase64, originalName, pageIndex } = req.body;

      if (!pdfBase64) {
        return res.status(400).json({ error: "Faltando dados do PDF (pdfBase64)." });
      }

      const apiKey = process.env.NVIDIA_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          error: "A chave NVIDIA_API_KEY não foi configurada. Adicione no arquivo .env"
        });
      }

      console.log(`[NVIDIA OCR] Processing page ${pageIndex + 1} of file ${originalName}...`);

      const prompt = `Analise detalhadamente este documento PDF (que representa uma única página de documentos digitalizados) e identifique as seguintes informações estruturadas em português para renomeação do arquivo.
      
      Regras de extração:
      1. Se o documento for uma Nota Fiscal de qualquer tipo (fatura, NF-e, NFS-e, cupom fiscal, CT-e, recibo comercial de venda/serviço), defina 'isNotaFiscal' como true.
         - Extraia o número da Nota Fiscal em 'notaNumber'. Se houver letras ou símbolos adjacentes adicionais, mantenha apenas o número limpo.
         - Identifique a empresa emissora (nome fantasia, razão social) em 'companyName'.
         - Extraia em 'valor' o valor total líquido ou bruto da transação como um número real (Float, ex: 1540.35).
         - Defina 'documentType' como 'nota_fiscal'.
      
      2. Se o documento NÃO for uma Nota fiscal (como uma guia de pagamento de imposto, boleto, taxa do governo, DARF, FGTS, GPS, IPVA, etc.), defina 'isNotaFiscal' como false.
         - Tente identificar o nome do tributo ou órgão (Ex: DARF, FGTS, GPS, PREFEITURA, etc.). Coloque essa identificação no campo 'companyName'.
         - Defina 'notaNumber' como null (pois não há número de nota).
         - Extraia em 'valor' o valor total a pagar/pago como número real.
         - Defina 'documentType' como 'darf' se for especificamente um DARF, ou 'imposto' se for outra taxa ou tributo.
      
      Importante: Remova caracteres especiais que possam corromper nomes de arquivos (aspas, barras, etc.) ao extrair o texto. Retorne sempre valores simples e limpos.

      Responda APENAS com um objeto JSON válido, sem markdown, sem texto extra.`;

      const response = await fetch(NVIDIA_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: NVIDIA_MODEL,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${pdfBase64}`,
                    detail: "high"
                  }
                },
                {
                  type: "text",
                  text: prompt
                }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 1024,
          top_p: 0.9
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[NVIDIA API Error]:", response.status, errText);
        throw new Error(`NVIDIA API retornou status ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const responseText = data.choices?.[0]?.message?.content;

      if (!responseText) {
        throw new Error("O modelo NVIDIA retornou uma resposta vazia.");
      }

      const cleaned = responseText
        .replace(/```json\s*/gi, "")
        .replace(/```\s*$/g, "")
        .trim();

      const extractedData = JSON.parse(cleaned);
      return res.json(extractedData);

    } catch (error: any) {
      console.error("[NVIDIA OCR Error]:", error);
      return res.status(500).json({
        error: error.message || "Erro desconhecido ao processar dados com NVIDIA."
      });
    }
  });

  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return new Promise<void>((resolve) => {
    serverInstance = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
      resolve();
    });
  });
}

export function stopServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}
