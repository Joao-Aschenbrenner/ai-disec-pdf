import { describe, it, expect } from "vitest";
import { fixJSON } from "../server";

describe("fixJSON", () => {
  it("deve manter JSON válido inalterado", () => {
    const input = '{"isNotaFiscal":true,"notaNumber":"123","companyName":"EMPRESA","valor":150.50,"documentType":"nota_fiscal"}';
    expect(fixJSON(input)).toBe(input);
  });

  it("deve corrigir aspas simples para duplas", () => {
    const input = "{'isNotaFiscal':false,'companyName':'Loja'}";
    const expected = '{"isNotaFiscal":false,"companyName":"Loja"}';
    expect(fixJSON(input)).toBe(expected);
  });

  it("deve corrigir chaves sem aspas", () => {
    const input = '{isNotaFiscal:false, companyName:"Loja"}';
    const expected = '{"isNotaFiscal":false,"companyName":"Loja"}';
    expect(fixJSON(input)).toBe(expected);
  });

  it("deve remover vírgula antes de ]", () => {
    const input = '{"items":[1,2,3,]}';
    const expected = '{"items":[1,2,3]}';
    expect(fixJSON(input)).toBe(expected);
  });

  it("deve remover vírgula antes de }", () => {
    const input = '{"a":1,"b":2,}';
    const expected = '{"a":1,"b":2}';
    expect(fixJSON(input)).toBe(expected);
  });

  it("deve remover vírgulas duplicadas", () => {
    const input = '{"a":1,,,"b":2}';
    const expected = '{"a":1,"b":2}';
    expect(fixJSON(input)).toBe(expected);
  });

  it("deve corrigir número formato brasileiro com separador de milhar e decimal (2.707,22)", () => {
    const input = '{"valor":2.707,22,"documentType":"folha_pagamento"}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(2707.22);
  });

  it("deve manter números com ponto decimal inalterados", () => {
    const input = '{"valor":134.01}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(134.01);
  });

  it("deve corrigir documentos múltiplos com valor brasileiro no segundo", () => {
    const input = '[{"isNotaFiscal":false,"companyName":"EMPRESA","valor":134.01},{"isNotaFiscal":false,"companyName":"PREFEITURA","valor":2.707,22}]';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].valor).toBe(134.01);
    expect(parsed[1].valor).toBe(2707.22);
  });

  it("deve remover caracteres de controle", () => {
    const input = '{"a":1\x00\x01\x02}';
    const result = fixJSON(input);
    expect(result).toBe('{"a":1}');
  });

  it("deve remover espaços extras no início/fim", () => {
    const input = '  {"a":1}  ';
    const result = fixJSON(input);
    expect(result).toBe('{"a":1}');
  });

  it("deve corrigir JSON com array de objetos", () => {
    const input = ' [ { "a" : 1 } , { "b" : 2 } ] ';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("não deve quebrar array com espaço entre elementos", () => {
    const input = '{"items":[1, 5, 10]}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.items).toEqual([1, 5, 10]);
  });

  it("deve corrigir 1.234,56 sem espaço após vírgula", () => {
    const input = '{"valor":1.234,56,"nome":"teste"}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(1234.56);
    expect(parsed.nome).toBe("teste");
  });
});
