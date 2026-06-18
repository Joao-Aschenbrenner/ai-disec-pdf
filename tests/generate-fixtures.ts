import { PDFDocument, rgb } from "pdf-lib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createTextPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  
  page.drawText("NOTA FISCAL DE SERVIÇOS", {
    x: 50,
    y: 800,
    size: 20,
    color: rgb(0, 0, 0),
  });
  
  page.drawText("Empresa: Tech Solutions Ltda", {
    x: 50,
    y: 750,
    size: 14,
  });
  
  page.drawText("CNPJ: 12.345.678/0001-90", {
    x: 50,
    y: 730,
    size: 14,
  });
  
  page.drawText("Número da Nota: 12345", {
    x: 50,
    y: 710,
    size: 14,
  });
  
  page.drawText("Valor Total: R$ 1.540,35", {
    x: 50,
    y: 690,
    size: 14,
  });
  
  page.drawText("Descrição: Serviços de desenvolvimento de software", {
    x: 50,
    y: 670,
    size: 14,
  });
  
  const pdfBytes = await pdfDoc.save();
  const fixturesDir = path.join(__dirname, "fixtures");
  fs.writeFileSync(path.join(fixturesDir, "text.pdf"), pdfBytes);
  console.log("✓ text.pdf criado com sucesso");
}

async function createScannedPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  
  page.drawText("DARF - DOCUMENTO DE ARRECADAÇÃO DE RECEITAS FEDERAIS", {
    x: 50,
    y: 800,
    size: 16,
    color: rgb(0, 0, 0),
  });
  
  page.drawText("Número de Controle: 123.456.789.012-3", {
    x: 50,
    y: 750,
    size: 14,
  });
  
  page.drawText("CNPJ: 98.765.432/0001-10", {
    x: 50,
    y: 730,
    size: 14,
  });
  
  page.drawText("Código da Receita: 0588", {
    x: 50,
    y: 710,
    size: 14,
  });
  
  page.drawText("Período de Apuração: 01/2025", {
    x: 50,
    y: 690,
    size: 14,
  });
  
  page.drawText("Valor Principal: R$ 2.350,00", {
    x: 50,
    y: 670,
    size: 14,
  });
  
  page.drawText("Data de Vencimento: 20/02/2025", {
    x: 50,
    y: 650,
    size: 14,
  });
  
  const pdfBytes = await pdfDoc.save();
  const fixturesDir = path.join(__dirname, "fixtures");
  fs.writeFileSync(path.join(fixturesDir, "scanned.pdf"), pdfBytes);
  console.log("✓ scanned.pdf criado com sucesso (simulado)");
}

async function main() {
  const fixturesDir = path.join(__dirname, "fixtures");
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  
  await createTextPdf();
  await createScannedPdf();
  console.log("\n✓ Todos os PDFs de teste foram criados em tests/fixtures/");
}

main().catch(console.error);