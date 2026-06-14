import { useState } from 'react';
import axios, { AxiosProgressEvent } from 'axios';

interface OcrPage {
  index: number;
  text: string;
  confidence: number;
  char_count: number;
  processing_time_ms: number;
  success: boolean;
  error: string | null;
}

interface ProcessResult {
  success: boolean;
  pdf_path: string;
  page_count: number;
  pages: OcrPage[];
  total_text: string;
  total_chars: number;
  avg_confidence: number;
  render_time_ms: number;
  ocr_time_ms: number;
  total_time_ms: number;
  error: string | null;
}

const PdfUploader = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setResult(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a PDF file');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post<ProcessResult>(
        'http://localhost:8000/process-pdf/',
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent: AxiosProgressEvent) => {
            if (progressEvent.total) {
              const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              setProgress(percent);
            }
          },
        }
      );

      setResult(response.data);
      setProgress(100);
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { detail?: string } } };
      setError(axiosError.response?.data?.detail || 'Failed to process PDF');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ textAlign: 'center', color: '#333' }}>PDF OCR Processor</h1>

      <form onSubmit={handleSubmit} style={{ marginBottom: '20px', textAlign: 'center' }}>
        <div style={{ marginBottom: '15px' }}>
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            style={{ padding: '10px' }}
          />
        </div>
        <button
          type="submit"
          disabled={isProcessing}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            backgroundColor: isProcessing ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: isProcessing ? 'not-allowed' : 'pointer'
          }}
        >
          {isProcessing ? 'Processing...' : 'Process PDF'}
        </button>
      </form>

      {isProcessing && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{
            width: '100%',
            height: '20px',
            backgroundColor: '#f0f0f0',
            borderRadius: '10px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              backgroundColor: '#007bff',
              transition: 'width 0.3s ease'
            }} />
          </div>
          <p style={{ textAlign: 'center', marginTop: '5px' }}>{progress}%</p>
        </div>
      )}

      {error && (
        <div style={{ color: 'red', marginTop: '10px', padding: '10px', backgroundColor: '#ffe6e6', borderRadius: '5px' }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '10px' }}>
          <h2 style={{ color: '#28a745' }}>Processing Complete!</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '15px' }}>
            <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '5px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <strong>PDF File:</strong> {result.pdf_path}
            </div>
            <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '5px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <strong>Pages:</strong> {result.page_count}
            </div>
            <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '5px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <strong>Total Characters:</strong> {result.total_chars.toLocaleString()}
            </div>
            <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '5px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <strong>Avg. Confidence:</strong> {result.avg_confidence}%
            </div>
            <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '5px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <strong>Render Time:</strong> {result.render_time_ms}ms
            </div>
            <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '5px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <strong>OCR Time:</strong> {result.ocr_time_ms}ms
            </div>
          </div>

          <div style={{ marginTop: '15px', textAlign: 'center' }}>
            <strong>Total Processing Time:</strong> {result.total_time_ms}ms
            ({(result.total_time_ms / result.page_count).toFixed(2)}ms per page)
          </div>

          <details style={{ marginTop: '20px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
              View Extracted Text ({result.total_chars.toLocaleString()} characters)
            </summary>
            <pre style={{
              marginTop: '10px',
              padding: '15px',
              backgroundColor: 'white',
              borderRadius: '5px',
              maxHeight: '300px',
              overflow: 'auto',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {result.total_text.substring(0, 5000)}
              {result.total_text.length > 5000 && '\n\n... (truncated)'}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
};

export default PdfUploader;