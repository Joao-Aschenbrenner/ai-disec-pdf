#!/usr/bin/env python3
"""
OCR Processor - Processa uma imagem e retorna texto extraído via Tesseract
"""
import sys
import json
import pytesseract
from PIL import Image

# Caminho do Tesseract (ajustar se necessário)
TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH

def process_image(image_path, output_path):
    try:
        img = Image.open(image_path)
        
        # OCR com português e inglês
        text = pytesseract.image_to_string(img, lang='por+eng')
        
        # Confiança média
        data = pytesseract.image_to_data(img, lang='por+eng', output_type=pytesseract.Output.DICT)
        confs = [int(c) for c in data['conf'] if int(c) > 0]
        confidence = sum(confs) / len(confs) if confs else 0.0
        
        result = {
            "text": text.strip(),
            "confidence": round(confidence, 1)
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False)
            
        sys.exit(0)
        
    except Exception as e:
        result = {"text": "", "confidence": 0.0, "error": str(e)}
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python ocr_processor.py <input_image> <output_json>")
        sys.exit(1)
    
    process_image(sys.argv[1], sys.argv[2])