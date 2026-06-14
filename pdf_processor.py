#!/usr/bin/env python3
"""
PDF Processor - Extrai texto diretamente do PDF usando PyMuPDF (sem OCR)
Muito mais rápido e preciso para PDFs com texto embutido
"""
import sys
import json
import fitz  # PyMuPDF

def process_pdf(pdf_path, output_path):
    try:
        doc = fitz.open(pdf_path)
        page_count = len(doc)
        
        all_text = []
        total_chars = 0
        
        for i in range(page_count):
            page = doc[i]
            text = page.get_text()
            if text.strip():
                all_text.append(text.strip())
                total_chars += len(text.strip())
        
        doc.close()
        
        combined_text = "\n".join(all_text)
        
        result = {
            "success": True,
            "total_text": combined_text,
            "page_count": page_count,
            "total_chars": total_chars,
            "avg_confidence": 100.0,  # Text extraction is 100% confident
            "error": None
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False)
            
        sys.exit(0)
        
    except Exception as e:
        result = {
            "success": False,
            "error": str(e),
            "total_text": "",
            "page_count": 0,
            "total_chars": 0,
            "avg_confidence": 0.0
        }
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python pdf_processor.py <input_pdf> <output_json>")
        sys.exit(1)
    
    process_pdf(sys.argv[1], sys.argv[2])