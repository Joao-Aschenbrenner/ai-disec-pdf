use anyhow::{Context, Result};
use clap::Parser;
use leptess::LepTess;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Parser)]
#[command(name = "ocr-processor")]
#[command(about = "Fast parallel OCR processor")]
struct Args {
    #[arg(short, long)]
    input_dir: PathBuf,

    #[arg(short, long)]
    output_file: Option<PathBuf>,

    #[arg(long, default_value = "por+eng")]
    languages: String,

    #[arg(long)]
    json: bool,
}

#[derive(Serialize, Deserialize)]
struct PageResult {
    index: usize,
    file: String,
    text: String,
    confidence: f32,
    char_count: usize,
    processing_time_ms: u64,
}

#[derive(Serialize, Deserialize)]
struct OcrOutput {
    success: bool,
    error: Option<String>,
    total_pages: usize,
    pages: Vec<PageResult>,
    total_text: String,
    total_chars: usize,
    total_processing_time_ms: u64,
}

fn find_tessdata() -> PathBuf {
    let candidates = [
        PathBuf::from("tessdata"),
        PathBuf::from("../tessdata"),
        PathBuf::from("../../tessdata"),
        PathBuf::from("../../../publish_nonSF/tessdata"),
        PathBuf::from("../../../src/SeparadorDePdf.Wpf/tessdata"),
    ];
    for c in &candidates {
        if c.exists() {
            return c.clone();
        }
    }
    PathBuf::from("tessdata")
}

fn ocr_single_image(
    img_path: &Path,
    tessdata_path: &Path,
    languages: &str,
    index: usize,
) -> Result<PageResult> {
    let start = std::time::Instant::now();

    let img = image::open(img_path).with_context(|| format!("Failed to open: {}", img_path.display()))?;
    let gray = img.to_luma8();

    let mut lep = LepTess::new(Some(tessdata_path.to_str().unwrap()), languages)
        .context("Failed to init Tesseract")?;

    lep.set_image_from_grey_bytes(gray.as_raw(), gray.width(), gray.height())?;
    lep.recognize()?;

    let text = lep.get_utf8_text().unwrap_or_default();
    let confidence = lep.mean_text_confidence().unwrap_or(0.0);
    let elapsed = start.elapsed().as_millis() as u64;

    let trimmed = text.trim().to_string();

    Ok(PageResult {
        index,
        file: img_path.file_name().unwrap().to_string_lossy().to_string(),
        text: trimmed.clone(),
        confidence,
        char_count: trimmed.len(),
        processing_time_ms: elapsed,
    })
}

fn collect_image_files(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .with_context(|| format!("Failed to read dir: {}", dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file() && matches!(
                p.extension().and_then(|e| e.to_str()),
                Some("png" | "jpg" | "jpeg" | "bmp" | "tiff")
            )
        })
        .collect();

    files.sort();
    Ok(files)
}

fn run(args: Args) -> Result<()> {
    let tessdata = find_tessdata();
    eprintln!("Tessdata: {}", tessdata.display());

    let files = collect_image_files(&args.input_dir)
        .with_context(|| format!("Failed to collect images from: {}", args.input_dir.display()))?;

    let total = files.len();
    eprintln!("Found {} images to process", total);

    if total == 0 {
        let output = OcrOutput {
            success: true,
            error: None,
            total_pages: 0,
            pages: vec![],
            total_text: String::new(),
            total_chars: 0,
            total_processing_time_ms: 0,
        };
        println!("{}", serde_json::to_string(&output)?);
        return Ok(());
    }

    let start = std::time::Instant::now();
    let counter = AtomicUsize::new(0);

    let mut pages: Vec<PageResult> = files
        .par_iter()
        .enumerate()
        .filter_map(|(i, path)| {
            match ocr_single_image(path, &tessdata, &args.languages, i) {
                Ok(result) => {
                    let count = counter.fetch_add(1, Ordering::SeqCst) + 1;
                    if count % 5 == 0 || count == total {
                        eprintln!("  OCR {}/{} pages done", count, total);
                    }
                    Some(result)
                }
                Err(e) => {
                    eprintln!("  Failed page {}: {}", i, e);
                    Some(PageResult {
                        index: i,
                        file: path.file_name().unwrap().to_string_lossy().to_string(),
                        text: String::new(),
                        confidence: 0.0,
                        char_count: 0,
                        processing_time_ms: 0,
                    })
                }
            }
        })
        .collect();

    pages.sort_by_key(|p| p.index);

    let total_time = start.elapsed().as_millis() as u64;
    let total_chars: usize = pages.iter().map(|p| p.char_count).sum();
    let total_text: String = pages
        .iter()
        .filter(|p| !p.text.is_empty())
        .map(|p| p.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    eprintln!("Done: {} pages, {} chars, {}ms", total, total_chars, total_time);

    let output = OcrOutput {
        success: true,
        error: None,
        total_pages: total,
        pages,
        total_text,
        total_chars,
        total_processing_time_ms: total_time,
    };

    if args.json {
        println!("{}", serde_json::to_string(&output)?);
    } else if let Some(out_path) = &args.output_file {
        std::fs::write(out_path, &output.total_text)?;
        eprintln!("Text saved to: {}", out_path.display());
    } else {
        println!("{}", serde_json::to_string_pretty(&output)?);
    }

    Ok(())
}

fn main() {
    let args = Args::parse();

    if let Err(e) = run(args) {
        eprintln!("Error: {:#}", e);
        let output = OcrOutput {
            success: false,
            error: Some(format!("{:#}", e)),
            total_pages: 0,
            pages: vec![],
            total_text: String::new(),
            total_chars: 0,
            total_processing_time_ms: 0,
        };
        println!("{}", serde_json::to_string(&output).unwrap_or_default());
        std::process::exit(1);
    }
}
