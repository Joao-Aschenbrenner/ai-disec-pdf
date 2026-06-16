import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Create the shared Gemini SDK client with User-Agent set to 'aistudio-build'
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  // High payload limit for handling PDF base64 contents
  app.use(express.json({ limit: "50mb" }));

  // API endpoint: Extracts metadata from a single PDF page (base64)
  app.post("/api/extract", async (req, res) => {
    try {
      const { pdfBase64, originalName, pageIndex } = req.body;
      
      if (!pdfBase64) {
        return res.status(400).json({ error: "Faltando dados do PDF (pdfBase64)." });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ 
          error: "A chave GEMINI_API_KEY não foi configurada nos segredos do servidor. Por favor, adicione-a no menu Settings > Secrets." 
        });
      }

      console.log(`[Gemini OCR] Processing page ${pageIndex + 1} of file ${originalName}...`);

      const prompt = `Analise detalhadamente este documento PDF (que representa uma única página de documentos digitalizados) e identifique as seguintes informações estruturadas em português para renomeação do arquivo.
      
      Regras de extração:
      1. Se o documento for uma Nota Fiscal de qualquer tipo (fatura, NF-e, NFS-e, cupom fiscal, CT-e, recibo comercial de venda/serviço), defina 'isNotaFiscal' como true.
         - Extraia o número da Nota Fiscal em 'notaNumber'. Se houver letras ou símbolos adjacentes adicionais, mantenha apenas o número limpo (Ex: "000.123.456" viraria "123456" ou mantenha o número identificador do documento relevante).
         - Identifique a empresa emissora (nome fantasia, razão social) em 'companyName'.
         - Extraia em 'valor' o valor total líquido ou bruto da transação como um número real (Float, ex: 1540.35).
         - Defina 'documentType' como 'nota_fiscal'.
      
      2. Se o documento NÃO for uma Nota fiscal (como uma guia de pagamento de imposto, boleto, taxa do governo, DARF, FGTS, GPS, IPVA, etc.), defina 'isNotaFiscal' como false.
         - Tente identificar o nome do tributo ou órgão (Ex: DARF, FGTS, GPS, PREFEITURA, etc.). Coloque essa identificação no campo 'companyName' (se for DARF, coloque 'DARF' ou 'Receita-Federal').
         - Defina 'notaNumber' como null (pois não há número de nota).
         - Extraia em 'valor' o valor total a pagar/pago como número real.
         - Defina 'documentType' como 'darf' se for especificamente um DARF, ou 'imposto' se for outra taxa ou tributo.
      
      Importante: Remova caracteres especiais que possam corromper nomes de arquivos (aspas, barras, etc.) ao extrair o texto. Retorne sempre valores simples e limpos.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            inlineData: {
              data: pdfBase64,
              mimeType: "application/pdf",
            },
          },
          {
            text: prompt,
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isNotaFiscal: {
                type: Type.BOOLEAN,
                description: "Se o documento é uma Nota Fiscal ou similar de venda/serviço.",
              },
              notaNumber: {
                type: Type.STRING,
                description: "O número de identificação da nota fiscal ou fatura. Se não aplicável ou não encontrado, null.",
              },
              companyName: {
                type: Type.STRING,
                description: "O nome limpo da empresa emissora ou o órgão do imposto/tipo de tributo (ex: DARF, Prefeitura).",
              },
              valor: {
                type: Type.NUMBER,
                description: "O valor numérico decimal total ou recolhido do documento. Ex: 1250.45.",
              },
              documentType: {
                type: Type.STRING,
                description: "Tipo de documento: 'nota_fiscal', 'imposto', 'darf', 'outros'.",
              }
            },
            required: ["isNotaFiscal", "notaNumber", "companyName", "valor", "documentType"],
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("O modelo Gemini retornou uma resposta vazia.");
      }

      const extractedData = JSON.parse(responseText.trim());
      return res.json(extractedData);

    } catch (error: any) {
      console.error("[Gemini OCR Error]:", error);
      return res.status(500).json({ 
        error: error.message || "Erro desconhecido ao processar dados com o Gemini." 
      });
    }
  });

  // Vite Integration
  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
