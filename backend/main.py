#!/usr/bin/env python3
"""
NebulonGPT Unified Backend
Single FastAPI application with REST API + WebSocket endpoints for Vosk and TTS
Run with: uvicorn backend.main:app --host 0.0.0.0 --port 3001
"""

import os
import json
import logging
import shutil
import platform
import subprocess
import asyncio
import pathlib
import time
from pathlib import Path
from typing import Dict, Optional
from datetime import datetime
from collections import defaultdict

from fastapi import FastAPI, HTTPException, UploadFile, File, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import aiofiles

# Vosk imports
from vosk import Model, SpkModel, KaldiRecognizer

# Kokoro TTS imports
import torch
import soundfile as sf
import io
import base64
import re

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURATION
# =============================================================================

PORT = int(os.environ.get('REST_API_PORT', 3001))
DATA_DIR = Path(os.environ.get('DATA_DIR', './data'))
CHATS_FILE = DATA_DIR / 'chats.json'
VOSK_MODELS_DIR = Path(os.environ.get('VOSK_MODELS_DIR', './models/vosk'))

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
VOSK_MODELS_DIR.mkdir(parents=True, exist_ok=True)

# Initialize chats file
if not CHATS_FILE.exists():
    CHATS_FILE.write_text('[]')

logger.info(f"Data directory: {DATA_DIR}")
logger.info(f"Vosk models directory: {VOSK_MODELS_DIR}")

# =============================================================================
# FASTAPI APP INITIALIZATION
# =============================================================================

app = FastAPI(
    title="NebulonGPT Backend",
    description=" REST API + WebSocket server for chat management, Vosk ASR, and Kokoro TTS",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================================================================
# VOSK ASR GLOBALS
# =============================================================================

vosk_model_cache = {}
vosk_model_refcnt = defaultdict(int)
vosk_default_model_name = None
vosk_session_models = {}
vosk_active_sessions = {}
vosk_spk_model = None

# =============================================================================
# KOKORO TTS GLOBALS
# =============================================================================

tts_pipeline = None
tts_active_sessions = {}
tts_session_states = {}

# =============================================================================
# STARTUP EVENT - Initialize models
# =============================================================================

@app.on_event("startup")
async def startup_event():
    """Initialize models on startup"""
    global vosk_default_model_name, tts_pipeline
    
    logger.info("=" * 80)
    logger.info("STARTING NEBULONGPT BACKEND")
    logger.info("=" * 80)
    
    # Initialize Vosk
    logger.info("Initializing Vosk ASR...")
    available_models = get_available_vosk_models()
    if available_models:
        logger.info(f"Available Vosk models: {', '.join(available_models)}")
        default_model = next(
            (m for m in ['vosk-model-small-en-us-0.15', 'vosk-model-en-us-0.22'] if m in available_models),
            available_models[0]
        )
        try:
            logger.info(f"Loading default Vosk model: {default_model}")
            load_vosk_model(default_model)
            vosk_default_model_name = default_model
            logger.info(f"Vosk default model loaded: {default_model}")
        except Exception as e:
            logger.error(f"Failed to load Vosk model: {e}")
    
    # Initialize Kokoro TTS
    logger.info("Initializing Kokoro TTS...")
    try:
        await initialize_tts_pipeline()
        logger.info("Kokoro TTS initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize Kokoro TTS: {e}")
    
    logger.info("=" * 80)
    logger.info("Backend initialization complete")
    logger.info("=" * 80)

# =============================================================================
# REST API ENDPOINTS - CHAT MANAGEMENT
# =============================================================================

@app.get("/api/chats")
async def get_chats():
    """Get all chats from the chats file"""
    try:
        async with aiofiles.open(CHATS_FILE, 'r') as f:
            content = await f.read()
            chats = json.loads(content)
        return chats
    except Exception as e:
        logger.error(f"Error reading chats: {e}")
        raise HTTPException(status_code=500, detail="Failed to load chats")

@app.post("/api/chats/{chat_id}")
async def save_chat(chat_id: str, request: Request):
    """Save or update a specific chat by ID"""
    try:
        chat_data = await request.json()
        
        if not chat_id or not chat_data:
            raise HTTPException(status_code=400, detail="Chat ID and data required")
        
        try:
            async with aiofiles.open(CHATS_FILE, 'r') as f:
                chats = json.loads(await f.read())
        except:
            chats = []
        
        existing_index = next((i for i, c in enumerate(chats) if c.get('id') == chat_id), -1)
        
        if existing_index >= 0:
            chats[existing_index] = {**chats[existing_index], **chat_data, 'id': chat_id}
        else:
            chats.insert(0, {**chat_data, 'id': chat_id})
        
        async with aiofiles.open(CHATS_FILE, 'w') as f:
            await f.write(json.dumps(chats, indent=2))
        
        return {"success": True}
    except Exception as e:
        logger.error(f"Error saving chat: {e}")
        raise HTTPException(status_code=500, detail="Failed to save chat")

@app.post("/api/chats")
async def save_all_chats(request: Request):
    """Legacy endpoint - saves entire chats array"""
    try:
        body = await request.json()
        chats = body if isinstance(body, list) else body.get('chats', body)
        
        async with aiofiles.open(CHATS_FILE, 'w') as f:
            await f.write(json.dumps(chats, indent=2))
        
        return {"success": True}
    except Exception as e:
        logger.error(f"Error saving chats: {e}")
        raise HTTPException(status_code=500, detail="Failed to save chats")

# =============================================================================
# REST API ENDPOINTS - VOSK MODEL MANAGEMENT
# =============================================================================

def get_directory_size(dir_path: Path) -> int:
    """Calculate total directory size"""
    return sum(f.stat().st_size for f in dir_path.rglob('*') if f.is_file())

def is_vosk_model(dir_path: Path) -> bool:
    """Check if directory is a valid Vosk model"""
    required = ['conf/model.conf', 'am/final.mdl', 'graph/HCLG.fst']
    has_required = sum(1 for f in required if (dir_path / f).exists())
    return has_required >= 2

@app.get("/api/vosk/models/all")
async def get_all_models():
    """Get all models from models directory"""
    try:
        if not VOSK_MODELS_DIR.exists():
            VOSK_MODELS_DIR.mkdir(parents=True, exist_ok=True)
            return {"models": []}
        
        models = []
        for item in VOSK_MODELS_DIR.iterdir():
            stats = item.stat()
            model_type = 'file'
            status = 'other'
            size = stats.st_size
            
            if item.is_dir():
                model_type = 'directory'
                status = 'ready' if is_vosk_model(item) else 'other'
                size = get_directory_size(item)
            elif item.suffix == '.zip':
                model_type = 'zip'
                status = 'archived'
            
            models.append({
                'name': item.name,
                'type': model_type,
                'size': size,
                'modified': stats.st_mtime,
                'status': status
            })
        
        models.sort(key=lambda m: ({'ready': 0, 'archived': 1, 'other': 2}.get(m['status'], 3), m['name']))
        return {"models": models}
    except Exception as e:
        logger.error(f"Error listing models: {e}")
        raise HTTPException(status_code=500, detail="Failed to list models")

@app.post("/api/vosk/models/upload")
async def upload_model(model: UploadFile = File(...)):
    """Upload a Vosk model ZIP file"""
    try:
        if not model.filename.endswith('.zip'):
            raise HTTPException(status_code=400, detail="Only ZIP files supported")
        
        target_path = VOSK_MODELS_DIR / model.filename
        
        async with aiofiles.open(target_path, 'wb') as f:
            await f.write(await model.read())
        
        # Auto-extract
        try:
            import zipfile
            with zipfile.ZipFile(target_path, 'r') as zip_ref:
                zip_ref.extractall(VOSK_MODELS_DIR)
            return {
                "message": "Model uploaded and extracted successfully",
                "filename": model.filename,
                "extracted": True
            }
        except Exception as e:
            return {
                "message": "Model uploaded but extraction failed",
                "filename": model.filename,
                "extracted": False,
                "extractError": str(e)
            }
    except Exception as e:
        logger.error(f"Error uploading model: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload model")

@app.post("/api/vosk/models/{model_name}/extract")
async def extract_model(model_name: str):
    """Extract a Vosk model ZIP file"""
    try:
        zip_path = VOSK_MODELS_DIR / model_name
        
        if not zip_path.exists():
            raise HTTPException(status_code=404, detail="Model not found")
        
        if not model_name.endswith('.zip'):
            raise HTTPException(status_code=400, detail="Not a ZIP file")
        
        import zipfile
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(VOSK_MODELS_DIR)
        
        return {"message": "Model extracted successfully"}
    except Exception as e:
        logger.error(f"Error extracting model: {e}")
        raise HTTPException(status_code=500, detail="Failed to extract model")

@app.delete("/api/vosk/models/{model_name}")
async def delete_model(model_name: str):
    """Delete a Vosk model"""
    try:
        model_path = VOSK_MODELS_DIR / model_name
        
        if not model_path.exists():
            raise HTTPException(status_code=404, detail="Model not found")
        
        if model_path.is_dir():
            shutil.rmtree(model_path)
        else:
            model_path.unlink()
        
        return {"message": "Model deleted successfully"}
    except Exception as e:
        logger.error(f"Error deleting model: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete model")

# =============================================================================
# REST API ENDPOINTS - PDF PROCESSING
# =============================================================================
#
# PDF extraction for sending to LLMs.
#
# NOTE (2025): This endpoint has been REDUCED to TEXT-ONLY extraction.
# Extraction of tables, figures, images, and vector charts has been
# intentionally DISABLED (the code is preserved below, wrapped in
# `if False:` blocks, so it can be re-enabled later if needed).
#
# Rationale: visual-element extraction was unreliable across diverse PDF
# layouts and occasionally introduced incorrect or noisy data into the
# LLM context. The frontend warns the user on upload that PDF support is
# text-only and that some information may be lost or imperfect.
#
# What is still extracted:
#   - PyMuPDF (fitz)   -> page text, metadata, TOC, links
#
# What is disabled (commented via `if False:`):
#   - pdfplumber       -> table extraction
#   - PyMuPDF drawings -> vector chart / figure-region detection & rendering
#   - PyMuPDF rasters  -> embedded image extraction

def _extract_pdf_payload(pdf_bytes: bytes, filename: str,
                         max_image_dim: int = 1600,
                         render_vector_figures: bool = True) -> dict:
    """
    Extract structured content from a PDF (text, FIGURE REGIONS as composite
    images, tables, metadata).

    Key design (rewritten 2025-11):
      Scientific PDFs build a single visual "Fig. 1" out of dozens of tiny
      embedded raster sprites (protein blobs, dots, arrows) combined with
      vector paths. Extracting each embedded raster individually produces 40+
      garbage thumbnails per figure. Instead we detect FIGURE REGIONS using
      caption anchoring + visual-ink clustering, then RENDER each region as
      one high-DPI composite from the page itself.

      1. Caption-anchored detection (primary): every "Fig./Figure/Table/Scheme/
         Chart N …" label on the page anchors a figure/table region. The
         figure occupies the area ABOVE/AROUND its caption, bounded by the
         column it lives in and by the previous caption/figure.
      2. Visual-ink clustering (fallback): on pages with no captions but clear
         drawing/raster content, cluster all visual bboxes with a generous
         gap to merge multi-panel figures.
      3. Tables come from pdfplumber (find_tables) and are EXCLUDED from
         figure regions (so a figure region never overlaps a table bbox).
      4. Each figure is rendered ONCE at ~200 DPI, bounded by `max_image_dim`
         on the longest side, and tagged with kind/page/bbox/caption/index.
      5. Text-only pages produce zero figure images. We never render a whole
         text page as an image.

    Returns:
        {
          "filename": str,
          "metadata": {...},
          "page_count": int,
          "pages": [
            {
              "page": int,
              "text": str,
              "tables": [ [[cell, ...], ...], ... ],
              "tables_meta": [{"rows", "cols", "bbox", "caption"}, ...],
              "images": [{... see schema below ...}, ...],
              "charts_detected": int,
              "links": [str, ...]
            }, ...
          ],
          "toc": [ {"level": int, "title": str, "page": int}, ... ],
          "combined_text": str,
          "llm_summary_prompt": str,
          "stats": {"total_images", "total_vector_figures", "total_tables",
                    "total_chars", "total_charts_detected"}
        }

    Each image dict:
        {
          "index":   int,         # 1-based, document-wide
          "kind":    "figure_region",  # composite figure crop
          "page":    int,
          "bbox":    [x0,y0,x1,y1],
          "caption": str | None,
          "width":   int (px),
          "height":  int (px),
          "format":  "jpeg" | "png",
          "data":    "<base64>",
        }
    """

    import fitz  # PyMuPDF
    # NOTE: pdfplumber + Pillow are no longer needed for the active code path
    # (tables / figures / images extraction is disabled below). They're left
    # imported lazily inside the disabled blocks if those are ever re-enabled.
    import re

    # ------------------------------------------------------------------------
    # TEXT-ONLY MODE FLAG
    # ------------------------------------------------------------------------
    # When True, the function ONLY extracts text + metadata + TOC + links.
    # Tables, figures, embedded images, and vector-chart detection/rendering
    # are skipped entirely. This was disabled because visual-element extraction
    # was unreliable on diverse PDF layouts and sometimes injected noisy or
    # incorrect data into the LLM context. Set to False to restore the full
    # pipeline (see commented `if not TEXT_ONLY_MODE:` blocks below).
    TEXT_ONLY_MODE = True

    result = {
        "filename": filename,
        "metadata": {},
        "page_count": 0,
        "pages": [],
        "toc": [],
        "combined_text": "",
        "llm_summary_prompt": "",
        "stats": {
            "total_images": 0,
            "total_vector_figures": 0,
            "total_tables": 0,
            "total_chars": 0,
            "total_charts_detected": 0,
        },
    }

    # -------------------------------------------------------------------------
    # Helpers: caption detection + bbox clustering
    # -------------------------------------------------------------------------
    # Match common scientific-figure caption openers, e.g.
    #   "Fig. 1 | Title …"                 "Figure 2: Title …"
    #   "Figure S3 — Title …"              "Table 1. Title …"
    #   "Scheme 4 | …"                     "Chart 2 – …"
    #   "Extended Data Fig. 1 | Title …"   "Extended Data Table 2: …"
    #   "Supplementary Fig. 3 …"           "Supplementary Table 4 …"
    #   "Supplementary Figure S5 …"        "Supp. Fig. 6 …"
    # The optional prefix group captures "Extended Data ", "Supplementary ",
    # "Supp. ", etc., and is preserved so we can build a sensible label
    # ("Extended Data Figure 1" instead of just "Figure 1") downstream.
    CAPTION_RE = re.compile(
        r"^\s*"
        r"(?P<prefix>(?:Extended\s+Data|Supplementary|Supplemental|Supp\.?|"
        r"Online\s+(?:Methods\s+)?)?\s*)"
        r"(?P<keyword>Fig(?:ure|\.)?|Table|Chart|Diagram|Scheme|Plate|Panel|Box)"
        r"\s*(?P<num>S?\d+[A-Za-z]?)?"
        r"\s*[\.\:\|\-\u2013\u2014]?\s*(?P<rest>.+)",
        re.IGNORECASE,
    )


    def _find_caption(text_blocks, target_bbox, kind_hint="figure"):
        """Find the nearest 'Figure N: …' / 'Table N: …' caption to a visual.

        `text_blocks` is the list returned by page.get_text("blocks") on the
        same page. `target_bbox` is (x0,y0,x1,y1) of the visual. `kind_hint`
        steers caption matching toward 'table' vs 'figure'.
        """
        if not text_blocks or not target_bbox:
            return None
        tx0, ty0, tx1, ty1 = target_bbox
        target_cx = (tx0 + tx1) / 2.0
        best_text = None
        best_distance = float("inf")
        for b in text_blocks:
            try:
                bx0, by0, bx1, by1, btext = b[0], b[1], b[2], b[3], b[4]
            except Exception:
                continue
            if not isinstance(btext, str):
                continue
            first_line = btext.strip().split("\n", 1)[0].strip()
            m = CAPTION_RE.match(first_line)
            if not m:
                continue
            keyword = (m.group("keyword") or "").lower()
            is_table = keyword.startswith("table")
            if kind_hint == "table" and not is_table:
                continue
            if kind_hint != "table" and is_table:
                continue
            # Vertical distance from caption block to the visual bbox

            if by0 >= ty1:
                d = by0 - ty1  # caption appears below
            elif by1 <= ty0:
                d = ty0 - by1  # caption appears above
            else:
                d = 0  # overlapping/inside
            # Penalize captions in a different page column horizontally
            block_cx = (bx0 + bx1) / 2.0
            if abs(target_cx - block_cx) > 250:
                d += 200
            # Only accept captions reasonably close (within ~250 pts vertically)
            if d < best_distance and d < 250:
                best_distance = d
                best_text = btext.strip()
        if best_text:
            # Collapse whitespace, cap length
            return " ".join(best_text.split())[:500]
        return None

    def _cluster_rects(rects, gap=20.0):
        """Greedy bbox clustering: merge rects whose bounding boxes overlap or
        come within `gap` PDF points of each other (both axes). Returns a list
        of union bboxes [(x0,y0,x1,y1), ...]. Used to fuse the many little
        path segments that make up a single vector figure into one bbox.
        """
        clusters = []
        for r in rects:
            try:
                rx0, ry0, rx1, ry1 = r.x0, r.y0, r.x1, r.y1
            except AttributeError:
                try:
                    rx0, ry0, rx1, ry1 = r[0], r[1], r[2], r[3]
                except Exception:
                    continue
            if rx1 <= rx0 or ry1 <= ry0:
                continue
            placed = False
            for c in clusters:
                cx0, cy0, cx1, cy1 = c
                if not (rx0 > cx1 + gap or rx1 < cx0 - gap or
                        ry0 > cy1 + gap or ry1 < cy0 - gap):
                    c[0] = min(cx0, rx0); c[1] = min(cy0, ry0)
                    c[2] = max(cx1, rx1); c[3] = max(cy1, ry1)
                    placed = True
                    break
            if not placed:
                clusters.append([rx0, ry0, rx1, ry1])
        return [tuple(c) for c in clusters]

    def _rects_overlap(a, b):
        ax0, ay0, ax1, ay1 = a
        bx0, by0, bx1, by1 = b
        return not (ax0 >= bx1 or ax1 <= bx0 or ay0 >= by1 or ay1 <= by0)

    def _rect_area(r):
        return max(0.0, (r[2] - r[0])) * max(0.0, (r[3] - r[1]))

    def _detect_columns(text_blocks, page_rect):
        """Heuristically detect column x-boundaries on a page by histogramming
        text-block left edges. Returns a sorted list of (col_x0, col_x1) tuples.
        Falls back to one full-page column if detection is unclear.
        """
        pw = page_rect.width
        if pw <= 0:
            return [(page_rect.x0, page_rect.x1)]

        # Collect left/right edges of substantial text blocks
        lefts = []
        rights = []
        for b in text_blocks:
            try:
                bx0, by0, bx1, by1, btext = b[0], b[1], b[2], b[3], b[4]
            except Exception:
                continue
            if not isinstance(btext, str) or not btext.strip():
                continue
            if (bx1 - bx0) < pw * 0.08:
                continue  # too narrow to be body text
            lefts.append(bx0)
            rights.append(bx1)

        if len(lefts) < 6:
            return [(page_rect.x0, page_rect.x1)]

        # Quantize lefts into 20pt buckets and find dominant ones
        from collections import Counter
        bucket = lambda v: int(round(v / 20.0)) * 20
        left_counts = Counter(bucket(v) for v in lefts)
        # Pick all buckets with at least 3 blocks
        candidates = sorted(
            [(bx, cnt) for bx, cnt in left_counts.items() if cnt >= 3]
        )
        if len(candidates) < 2:
            return [(page_rect.x0, page_rect.x1)]

        # Take the two strongest column starts (most common)
        top = sorted(candidates, key=lambda x: -x[1])[:3]
        top = sorted(top, key=lambda x: x[0])
        # Need at least two well-separated columns (> 80pt apart)
        if len(top) < 2 or (top[1][0] - top[0][0]) < 80:
            return [(page_rect.x0, page_rect.x1)]

        col_starts = [top[0][0], top[1][0]]
        # Right edges: midpoint between adjacent column starts; last column ends at page right
        cols = []
        for i, cs in enumerate(col_starts):
            if i + 1 < len(col_starts):
                ce = (cs + col_starts[i + 1]) / 2.0
            else:
                ce = page_rect.x1
            cols.append((cs - 5.0, ce))  # tiny left pad
        # First column may extend slightly to the left of its detected start
        cols[0] = (page_rect.x0, cols[0][1])
        return cols

    def _column_for_bbox(bbox, columns):
        """Return the (cx0, cx1) column that best contains `bbox`."""
        if not columns:
            return None
        bx0, by0, bx1, by1 = bbox
        bcx = (bx0 + bx1) / 2.0
        best = None
        best_d = float("inf")
        for (cx0, cx1) in columns:
            if cx0 <= bcx <= cx1:
                return (cx0, cx1)
            # distance from center to nearest column edge
            d = min(abs(bcx - cx0), abs(bcx - cx1))
            if d < best_d:
                best_d = d
                best = (cx0, cx1)
        return best

    def _find_caption_blocks(text_blocks, kind=None):
        """Return all caption text blocks on a page matching CAPTION_RE.

        Each entry: {"bbox": (x0,y0,x1,y1), "text": str, "kind": "figure"|"table",
                     "label": "Figure 1"|"Table 2"|...}
        `kind`: if "figure", drop table captions; if "table", drop figure
                captions; if None, return all.
        """
        out = []
        for b in text_blocks:
            try:
                bx0, by0, bx1, by1, btext = b[0], b[1], b[2], b[3], b[4]
            except Exception:
                continue
            if not isinstance(btext, str):
                continue
            first_line = btext.strip().split("\n", 1)[0].strip()
            m = CAPTION_RE.match(first_line)
            if not m:
                continue
            keyword = (m.group("keyword") or "").lower()
            is_table = keyword.startswith("table")
            cap_kind = "table" if is_table else "figure"
            if kind == "figure" and is_table:
                continue
            if kind == "table" and not is_table:
                continue
            num = (m.group("num") or "").strip()
            # Preserve the optional prefix ("Extended Data", "Supplementary",
            # "Supp.", …) so the label downstream matches what the reader
            # sees in the PDF (e.g. "Extended Data Figure 1" vs just "Figure 1").
            prefix_raw = (m.group("prefix") or "").strip()
            prefix_norm = " ".join(prefix_raw.split())
            # Normalize a couple of common short forms for prettier labels.
            if prefix_norm.lower() in ("supp", "supp."):
                prefix_norm = "Supplementary"
            elif prefix_norm.lower() == "supplemental":
                prefix_norm = "Supplementary"
            elif prefix_norm.lower().startswith("extended data"):
                prefix_norm = "Extended Data"
            label_word = (
                "Table" if is_table
                else ("Scheme" if keyword.startswith("scheme")
                      else ("Chart" if keyword.startswith("chart")
                            else ("Box" if keyword.startswith("box")
                                  else "Figure")))
            )
            base_label = f"{label_word} {num}".strip() if num else label_word
            label = f"{prefix_norm} {base_label}".strip() if prefix_norm else base_label

            out.append({
                "bbox": (float(bx0), float(by0), float(bx1), float(by1)),
                "text": " ".join(btext.split())[:500],
                "kind": cap_kind,
                "label": label,
            })
        return out

    def _compute_figure_region(caption_block, columns, all_visual_rects,
                               page_rect, other_caption_blocks,
                               table_bboxes):
        """Given a figure-caption block, compute the bbox of the figure it
        describes. The figure typically lives DIRECTLY ABOVE the caption,
        bounded horizontally by the column the caption sits in (or the whole
        column-span the caption covers) and bounded vertically by:
          - the previous figure/caption block above in the same column, OR
          - the top of the page.
        We then SHRINK-WRAP that vertical band to only the rectangle
        actually covered by visual ink (embedded raster bboxes + vector
        drawing rects) so we don't crop the surrounding white space and
        text on the same page.
        """
        cap_bbox = caption_block["bbox"]
        cx0, cy0, cx1, cy1 = cap_bbox

        # Horizontal span: union of all columns the caption overlaps. This
        # handles single-column captions ("Fig. 1 | …" on left column) and
        # full-width captions that span both columns.
        cap_left = cx0
        cap_right = cx1
        overlapping_cols = []
        for (col_x0, col_x1) in columns:
            if not (cap_right < col_x0 or cap_left > col_x1):
                overlapping_cols.append((col_x0, col_x1))
        if overlapping_cols:
            h_x0 = min(c[0] for c in overlapping_cols)
            h_x1 = max(c[1] for c in overlapping_cols)
        else:
            h_x0, h_x1 = page_rect.x0, page_rect.x1

        # Vertical band: from page top down to the caption top, bounded
        # below by the next caption-above (so two stacked figures don't
        # merge), and bounded above by any previous caption/table below
        # the page top.
        v_y1 = cy0  # bottom of band = top of caption
        v_y0 = page_rect.y0
        for other in other_caption_blocks:
            if other is caption_block:
                continue
            ox0, oy0, ox1, oy1 = other["bbox"]
            # Same horizontal band?
            if ox1 < h_x0 or ox0 > h_x1:
                continue
            # If other caption ends above this caption, it bounds us from above
            if oy1 < v_y1 - 5:
                if oy1 > v_y0:
                    v_y0 = oy1
        # Tables also bound us from above (so a figure region doesn't swallow
        # a table sitting above it).
        for tb in table_bboxes:
            tx0, ty0, tx1, ty1 = tb
            if tx1 < h_x0 or tx0 > h_x1:
                continue
            if ty1 < v_y1 - 5 and ty1 > v_y0:
                v_y0 = ty1

        band = (h_x0, v_y0, h_x1, v_y1)
        if band[2] - band[0] < 30 or band[3] - band[1] < 30:
            return None

        # Shrink-wrap: keep only the union of visual-ink rects that fall
        # inside `band`. This is what makes the crop tight on the figure
        # itself rather than including surrounding body text/white space.
        union = None
        for r in all_visual_rects:
            if not _rects_overlap(r, band):
                continue
            rx0 = max(r[0], band[0]); ry0 = max(r[1], band[1])
            rx1 = min(r[2], band[2]); ry1 = min(r[3], band[3])
            if rx1 - rx0 < 4 or ry1 - ry0 < 4:
                continue
            if union is None:
                union = [rx0, ry0, rx1, ry1]
            else:
                union[0] = min(union[0], rx0); union[1] = min(union[1], ry0)
                union[2] = max(union[2], rx1); union[3] = max(union[3], ry1)

        if union is None:
            # No visual ink found in the band — fall back to the band itself
            # only if the band is sensibly figure-shaped (not the whole page).
            page_area = max(1.0, page_rect.width * page_rect.height)
            band_area = (band[2] - band[0]) * (band[3] - band[1])
            if band_area / page_area > 0.6:
                return None
            return tuple(band)

        return tuple(union)



    # ---- PyMuPDF: text, images, metadata, links, drawings -------------------
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        meta = doc.metadata or {}
        result["metadata"] = {
            "title": meta.get("title") or "",
            "author": meta.get("author") or "",
            "subject": meta.get("subject") or "",
            "keywords": meta.get("keywords") or "",
            "creator": meta.get("creator") or "",
            "producer": meta.get("producer") or "",
            "creation_date": meta.get("creationDate") or "",
            "modification_date": meta.get("modDate") or "",
            "encrypted": doc.is_encrypted,
            "page_count": doc.page_count,
        }
        result["page_count"] = doc.page_count

        # Table of contents (outline)
        try:
            toc = doc.get_toc(simple=True) or []
            result["toc"] = [
                {"level": int(l), "title": str(t), "page": int(p)}
                for (l, t, p) in toc
            ]
        except Exception as e:
            logger.debug(f"[PDF] TOC extraction failed: {e}")

        # Global running index assigned to each extracted visual so the LLM
        # can refer to them as "Figure 1", "Figure 2", etc. across the whole
        # document.
        figure_counter = 0

        # -------------------------------------------------------------------
        # PASS 1 (PyMuPDF): collect per-page text, text_blocks, vector
        # drawing rects, embedded raster bboxes (as visual-ink hints), links.
        # We DO NOT render any images here — figure-region rendering happens
        # after pdfplumber tells us where the tables are so figure regions
        # never overlap a table.
        # -------------------------------------------------------------------
        per_page_ctx = []
        for page_index in range(doc.page_count):
            page = doc.load_page(page_index)
            page_num = page_index + 1
            page_rect = page.rect

            # Text
            try:
                page_text = page.get_text("text") or ""
            except Exception as e:
                logger.debug(f"[PDF] Text extraction failed page {page_index}: {e}")
                page_text = ""
            try:
                text_blocks = page.get_text("blocks") or []
            except Exception:
                text_blocks = []

            # Links
            page_links = []
            try:
                for link in page.get_links() or []:
                    if link.get("uri"):
                        page_links.append(link["uri"])
            except Exception:
                pass

            # Vector drawings
            drawing_rects = []
            charts_count = 0
            # ------------------------------------------------------------
            # DISABLED in TEXT_ONLY_MODE: vector-drawing detection is only
            # used downstream to seed figure-region rendering (PASS 3) and
            # to populate `charts_detected` in the digest. Skipping it
            # here avoids paying the cost when figures aren't rendered.
            # ------------------------------------------------------------
            if not TEXT_ONLY_MODE:
                try:
                    drawings = page.get_drawings() or []
                    for d in drawings:
                        items = d.get("items", []) or []
                        if len(items) < 3:
                            continue
                        rect = d.get("rect")
                        if rect is None:
                            continue
                        if rect.width < 6 or rect.height < 6:
                            continue
                        drawing_rects.append((float(rect.x0), float(rect.y0),
                                              float(rect.x1), float(rect.y1)))
                    charts_count = len(drawing_rects)
                except Exception:
                    charts_count = 0

            # Embedded raster bboxes (visual-ink hints; we do NOT extract
            # individual rasters anymore — each one is a tiny sprite that
            # belongs to a larger figure).
            raster_bboxes = []
            # ------------------------------------------------------------
            # DISABLED in TEXT_ONLY_MODE: raster bboxes are only consumed
            # by the figure-region renderer (PASS 3). With that disabled,
            # gathering them does nothing useful.
            # ------------------------------------------------------------
            if not TEXT_ONLY_MODE:
                try:
                    raster_infos = page.get_images(full=True) or []
                    for img_info in raster_infos:
                        xref = img_info[0]
                        try:
                            rects = page.get_image_rects(xref) or []
                        except Exception:
                            rects = []
                        for r in rects:
                            if r.width < 8 or r.height < 8:
                                continue
                            raster_bboxes.append(
                                (float(r.x0), float(r.y0),
                                 float(r.x1), float(r.y1))
                            )
                except Exception as e:
                    logger.debug(f"[PDF] get_images failed page {page_num}: {e}")

            per_page_ctx.append({
                "page_num": page_num,
                "page_rect": page_rect,
                "page_text": page_text,
                "text_blocks": text_blocks,
                "page_links": page_links,
                "drawing_rects": drawing_rects,
                "raster_bboxes": raster_bboxes,
                "charts_count": charts_count,
            })

            # Pre-seed the page entry in result["pages"]; images filled in pass 3
            result["pages"].append({
                "page": page_num,
                "text": page_text,
                "tables": [],
                "tables_meta": [],
                "images": [],
                "charts_detected": charts_count,
                "links": page_links,
                "_text_blocks": text_blocks,
            })
            result["stats"]["total_chars"] += len(page_text)
            result["stats"]["total_charts_detected"] += charts_count


        # -------------------------------------------------------------------
        # PASS 2 (pdfplumber): tables with bbox + caption. Done before the
        # figure pass so figure regions can exclude table bboxes (otherwise
        # a wide figure region above a caption would swallow a table sitting
        # between them).
        #
        # DISABLED in TEXT_ONLY_MODE: table extraction is intentionally
        # skipped — table cell text is already part of the per-page
        # `page.get_text("text")` output captured in PASS 1, so the LLM
        # still sees the table content as plain text, just without the
        # structured row/column layout. Wrapping the whole block in
        # `if not TEXT_ONLY_MODE` preserves the original logic so it can
        # be re-enabled by flipping the flag.
        # -------------------------------------------------------------------
        per_page_table_bboxes = [[] for _ in range(len(result["pages"]))]
        if not TEXT_ONLY_MODE:
          try:
            import pdfplumber  # lazy import (only used in full-extraction mode)
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pp:
                for page_index, pp_page in enumerate(pp.pages):
                    if page_index >= len(result["pages"]):
                        break

                    table_objs = []
                    try:
                        table_objs = pp_page.find_tables() or []
                    except Exception as e:
                        logger.debug(
                            f"[PDF] find_tables failed page {page_index}: {e}"
                        )

                    if not table_objs:
                        try:
                            raw = pp_page.extract_tables() or []
                        except Exception as e:
                            logger.debug(
                                f"[PDF] extract_tables failed page {page_index}: {e}"
                            )
                            raw = []
                        table_objs = [(None, t) for t in raw]
                    else:
                        table_objs = [(t.bbox, t.extract()) for t in table_objs]

                    page_text_blocks = result["pages"][page_index].get(
                        "_text_blocks", []
                    )

                    clean_tables = []
                    clean_tables_meta = []
                    for bbox, tbl in table_objs:
                        if not tbl:
                            continue
                        norm = [
                            [("" if cell is None else str(cell)).strip()
                             for cell in row]
                            for row in tbl
                            if any(cell is not None and str(cell).strip()
                                   for cell in row)
                        ]
                        if not norm:
                            continue
                        # Reject "tables" that are really 1-row/1-col text
                        # blocks (pdfplumber over-detects on dense text).
                        if len(norm) < 2 or max((len(r) for r in norm), default=0) < 2:
                            continue

                        rows = len(norm)
                        cols = max((len(r) for r in norm), default=0)
                        bbox_list = list(bbox) if bbox is not None else None
                        caption = (
                            _find_caption(page_text_blocks, bbox_list,
                                          kind_hint="table")
                            if bbox_list else None
                        )

                        clean_tables.append(norm)
                        clean_tables_meta.append({
                            "page": result["pages"][page_index]["page"],
                            "rows": rows,
                            "cols": cols,
                            "bbox": bbox_list,
                            "caption": caption,
                        })
                        if bbox_list:
                            per_page_table_bboxes[page_index].append(
                                tuple(bbox_list)
                            )

                    result["pages"][page_index]["tables"] = clean_tables
                    result["pages"][page_index]["tables_meta"] = clean_tables_meta
                    result["stats"]["total_tables"] += len(clean_tables)
          except Exception as e:
              logger.warning(f"[PDF] pdfplumber pass failed: {e}")


        # -------------------------------------------------------------------
        # PASS 3 (PyMuPDF rendering): figure regions per page using the
        # ITERATIVE EXPAND-AND-MERGE algorithm.
        #
        # Idea (user-suggested, much simpler & more robust):
        #   1. Start with EVERY visual seed bbox on the page:
        #        - embedded raster sprite bboxes
        #        - vector drawing rects
        #        - figure caption text bboxes (so captions get pulled INTO
        #          their parent figure region, instead of being cropped off)
        #        - table bboxes are kept SEPARATE and never merged into a
        #          figure region — but they DO participate as "anchors" so a
        #          figure region next to a table won't swallow the table.
        #   2. Pad every seed by 30% on each side (the user's "30% all around"
        #      rule). This is what merges sprites that belong to the same
        #      logical figure: their padded boxes overlap, so they fuse.
        #   3. Find any two padded boxes that overlap → merge them into one
        #      union box (using the UN-padded contents for the next round).
        #   4. Re-pad the merged box by 30% and repeat until no more merges
        #      happen. That converges to one box per logical figure cluster.
        #   5. For each final cluster, take the union of contained ORIGINAL
        #      seeds, pad by 30% one last time, clip to page bounds, render
        #      as ONE composite JPEG at ~216 DPI.
        #   6. Try to attach a caption: nearest caption block whose bbox is
        #      either inside, just below, or just above the final region.
        #
        # Why this beats the previous approach:
        #   - No reliance on "column detection" heuristics (which fail on
        #     full-width figures or single-column layouts).
        #   - No reliance on captions being present (works on cover figures,
        #     supplementary pages, posters, anything).
        #   - Naturally merges multi-panel figures (panels a/b/c/d) into one
        #     image, because their padded bboxes overlap each other.
        # -------------------------------------------------------------------
        # 50% padding on every side. The expansion is ALWAYS clipped to the
        # current page rect (see _expand below), so growth is per-page and
        # can never bleed into the previous or next page. Each page is
        # processed independently inside the per_page_ctx loop.
        EXPAND_RATIO = 0.50  # 50% on each side of the original bbox


        def _expand(rect, ratio, page_rect):
            x0, y0, x1, y1 = rect
            dx = (x1 - x0) * ratio
            dy = (y1 - y0) * ratio
            return (
                max(page_rect.x0, x0 - dx),
                max(page_rect.y0, y0 - dy),
                min(page_rect.x1, x1 + dx),
                min(page_rect.y1, y1 + dy),
            )

        def _union(a, b):
            return (
                min(a[0], b[0]), min(a[1], b[1]),
                max(a[2], b[2]), max(a[3], b[3]),
            )

        def _iterative_merge(seeds, page_rect, ratio, table_bboxes):
            """Iteratively merge seed bboxes: expand each by `ratio`, merge
            any pair whose expanded forms overlap, and repeat until stable.

            Tables block merging: two seeds on opposite sides of a table
            don't merge through it (we test the merged candidate against
            every table bbox and reject the merge if the merged box's CENTER
            line crosses a table).
            """
            # Start with the original (un-expanded) seeds. We always re-expand
            # from these originals so repeated padding doesn't compound.
            regions = [tuple(s) for s in seeds]

            def _merge_would_cross_table(merged, a, b):
                """Reject the merge if a table bbox sits BETWEEN a and b and
                the merge would swallow it. Specifically: if any table is
                fully contained in `merged` but does NOT overlap either `a`
                or `b`, the merge clearly jumped over the table → reject.
                """
                for tb in table_bboxes:
                    if (tb[0] >= merged[0] and tb[1] >= merged[1] and
                            tb[2] <= merged[2] and tb[3] <= merged[3]):
                        if (not _rects_overlap(tb, a)
                                and not _rects_overlap(tb, b)):
                            return True
                return False

            changed = True
            max_iters = 50  # safety bound
            iters = 0
            while changed and iters < max_iters:
                changed = False
                iters += 1
                new_regions = []
                consumed = [False] * len(regions)
                expanded = [_expand(r, ratio, page_rect) for r in regions]

                for i in range(len(regions)):
                    if consumed[i]:
                        continue
                    cur = regions[i]
                    cur_exp = expanded[i]
                    for j in range(i + 1, len(regions)):
                        if consumed[j]:
                            continue
                        if _rects_overlap(cur_exp, expanded[j]):
                            candidate = _union(cur, regions[j])
                            if _merge_would_cross_table(
                                candidate, cur, regions[j]
                            ):
                                continue
                            cur = candidate
                            cur_exp = _expand(cur, ratio, page_rect)
                            consumed[j] = True
                            changed = True
                    new_regions.append(cur)
                regions = new_regions
            return regions

        # ---------------------------------------------------------------
        # DISABLED in TEXT_ONLY_MODE: skip the entire figure-region
        # rendering pass. With drawings + rasters not collected and
        # tables not extracted, there are no seeds to render anyway,
        # but skipping the loop explicitly avoids paying the cost of
        # iterating through page contexts.
        # ---------------------------------------------------------------
        if TEXT_ONLY_MODE:
            per_page_ctx = []  # empty out so the loop below is a no-op
        for page_index, ctx in enumerate(per_page_ctx):
            page_num = ctx["page_num"]
            page_rect = ctx["page_rect"]
            text_blocks = ctx["text_blocks"]
            drawing_rects = ctx["drawing_rects"]
            raster_bboxes = ctx["raster_bboxes"]
            table_bboxes = per_page_table_bboxes[page_index]
            page = doc.load_page(page_index)

            # ----------------- Build seed bboxes -----------------------------
            # Detection is purely GEOMETRIC / language-agnostic. We do NOT
            # rely on caption-keyword matching ("Figure", "Table", "Fig.")
            # to seed regions — that would only work for English / Latin
            # papers and would silently fail on Persian (شکل / جدول /
            # تصویر), Arabic, Chinese, Japanese, etc.
            #
            # Seed sources:
            #   (1) Embedded raster sprite bboxes (any language, any layout)
            #   (2) Vector drawing rects (any language, any layout) — we
            #       drop ones that span basically the whole page (borders).
            #   (3) "Figure-associated" text blocks, selected purely by
            #       geometry, not content:
            #         - narrow (width < 40% of page width)  AND
            #         - short content (< 200 visible chars), AND
            #         - not inside a table.
            #       This captures axis labels, panel sub-labels ("a", "b",
            #       "c"), legend entries, tick labels, and short captions in
            #       ANY language — while excluding full body-text paragraphs
            #       which would otherwise pull the entire page into one
            #       giant "figure".
            #
            # Tables are kept separate and never become figure seeds (they
            # are emitted as structured rows by the pdfplumber pass).
            page_area = max(1.0, page_rect.width * page_rect.height)
            page_width = page_rect.width

            seed_bboxes = []
            # (1) Rasters
            for r in raster_bboxes:
                seed_bboxes.append(r)
            # (2) Vector drawings — drop page-wide overlays/borders
            for r in drawing_rects:
                w = r[2] - r[0]; h = r[3] - r[1]
                if w * h / page_area > 0.85:
                    continue
                seed_bboxes.append(r)

            # (3) Language-agnostic figure-associated text seeds
            for b in text_blocks:
                try:
                    bx0, by0, bx1, by1, btext = b[0], b[1], b[2], b[3], b[4]
                except Exception:
                    continue
                if not isinstance(btext, str):
                    continue
                stripped = btext.strip()
                if not stripped:
                    continue
                bw = bx1 - bx0
                bh = by1 - by0
                if bw <= 0 or bh <= 0:
                    continue
                # Body text is wide; figure-internal text is narrow.
                if bw >= page_width * 0.40:
                    continue
                # Long text blocks are paragraphs, not labels/legends.
                visible_chars = len(stripped.replace("\n", " "))
                if visible_chars >= 200:
                    continue
                # Many lines = paragraph fragment, even if narrow.
                line_count = stripped.count("\n") + 1
                if line_count >= 8:
                    continue
                seed_bboxes.append(
                    (float(bx0), float(by0), float(bx1), float(by1))
                )

            # Drop seeds that sit entirely inside a table bbox
            filtered_seeds = []
            for r in seed_bboxes:
                inside_table = False
                for tb in table_bboxes:
                    if (r[0] >= tb[0] - 2 and r[1] >= tb[1] - 2 and
                            r[2] <= tb[2] + 2 and r[3] <= tb[3] + 2):
                        inside_table = True
                        break
                if not inside_table:
                    filtered_seeds.append(r)

            # Caption labeling is BEST-EFFORT and English/Latin-only — we
            # only use it to give the detected region a friendly name like
            # "Figure 3" or "Extended Data Figure 1". If no recognizable
            # caption is found (e.g. the paper is in Persian), the figure
            # is STILL emitted, just without a `label` field. Detection
            # never depends on this.
            caption_blocks = _find_caption_blocks(text_blocks, kind="figure")

            if not filtered_seeds:
                result["pages"][page_index]["images"] = []
                continue


            # ----------------- Iterative expand+merge -----------------------
            regions = _iterative_merge(
                filtered_seeds, page_rect, EXPAND_RATIO, table_bboxes,
            )

            # Re-attach captions: for each final region, find the caption
            # block whose bbox falls inside (or closest below/above) it.
            def _caption_for_region(region):
                rx0, ry0, rx1, ry1 = region
                best = None
                best_d = float("inf")
                for cap in caption_blocks:
                    cx0, cy0, cx1, cy1 = cap["bbox"]
                    # Strongly prefer captions whose bbox lies INSIDE the region
                    if (cx0 >= rx0 - 2 and cx1 <= rx1 + 2 and
                            cy0 >= ry0 - 2 and cy1 <= ry1 + 2):
                        return cap
                    # Otherwise nearest caption directly below the region
                    # in the same horizontal span
                    if cy0 >= ry1 - 5 and cx0 < rx1 and cx1 > rx0:
                        d = cy0 - ry1
                        if d < best_d and d < 80:
                            best_d = d
                            best = cap
                return best

            # Filter out final regions that ended up trivially small or
            # page-sized.
            merged_regions = []
            for r in regions:
                rw = r[2] - r[0]; rh = r[3] - r[1]
                if rw < 30 or rh < 30:
                    continue
                if rw * rh / page_area > 0.95:
                    continue
                cap = _caption_for_region(r)
                cap_text = cap["text"] if cap else None
                label = cap["label"] if cap else None
                merged_regions.append((r, cap_text, label))

            # Sort top-to-bottom, left-to-right
            merged_regions.sort(key=lambda x: (round(x[0][1] / 20), x[0][0]))


            page_images = []
            for (bbox, cap_text, label) in merged_regions:
                if not render_vector_figures:
                    # Still record metadata so text-only LLMs know there's
                    # a figure here, even if we don't render the bytes.
                    figure_counter += 1
                    page_images.append({
                        "index": figure_counter,
                        "kind": "figure_region",
                        "page": page_num,
                        "bbox": [float(b) for b in bbox],
                        "caption": cap_text,
                        "label": label,
                        "format": "jpeg",
                        "width": 0,
                        "height": 0,
                        "data": "",
                    })
                    result["stats"]["total_vector_figures"] += 1
                    continue

                try:
                    # FINAL padding pass: after the iterative merge has
                    # converged on the largest stable region per figure
                    # cluster, apply ONE MORE 50% expansion (clipped to the
                    # current page) before cropping. This guarantees we
                    # don't shear off:
                    #   - panel sub-labels ("a", "b", "c") that sit just
                    #     ABOVE the figure ink,
                    #   - figure legends / class-key icons that sit slightly
                    #     to the RIGHT of the main figure body,
                    #   - axis tick labels at the edges.
                    # Stays per-page because we clip to page_rect on all
                    # four sides — it cannot bleed onto the previous/next page.
                    final_crop_bbox = _expand(bbox, EXPAND_RATIO, page_rect)

                    # Tables sitting on the same page must NOT be swallowed
                    # by the final padding. If the padded box now overlaps a
                    # table bbox that the un-padded region didn't, clip the
                    # padding back to the table edge on the appropriate side.
                    fcx0, fcy0, fcx1, fcy1 = final_crop_bbox
                    bx0, by0, bx1, by1 = bbox
                    for tb in table_bboxes:
                        tx0, ty0, tx1, ty1 = tb
                        # Already overlapping pre-pad? leave it (caller already
                        # decided that overlap is acceptable for this region).
                        if _rects_overlap((bx0, by0, bx1, by1), tb):
                            continue
                        if not _rects_overlap(
                            (fcx0, fcy0, fcx1, fcy1), tb
                        ):
                            continue
                        # Pull whichever padded side first enters the table
                        # back to the table edge.
                        if tx0 >= bx1 and fcx1 > tx0:   # table to the right
                            fcx1 = tx0
                        if tx1 <= bx0 and fcx0 < tx1:   # table to the left
                            fcx0 = tx1
                        if ty0 >= by1 and fcy1 > ty0:   # table below
                            fcy1 = ty0
                        if ty1 <= by0 and fcy0 < ty1:   # table above
                            fcy0 = ty1
                    crop = fitz.Rect(fcx0, fcy0, fcx1, fcy1)
                    if crop.width < 30 or crop.height < 30:
                        continue


                    # Render at ~216 DPI (3x zoom) for crisp figure detail
                    matrix = fitz.Matrix(3, 3)
                    pm = page.get_pixmap(matrix=matrix, alpha=False, clip=crop)
                    pil_img = Image.open(io.BytesIO(pm.tobytes("png")))
                    w, h = pil_img.size
                    if max(w, h) > max_image_dim:
                        scale = max_image_dim / float(max(w, h))
                        pil_img = pil_img.resize(
                            (max(1, int(w * scale)), max(1, int(h * scale))),
                            Image.LANCZOS,
                        )
                        w, h = pil_img.size

                    out_buf = io.BytesIO()
                    pil_img.convert("RGB").save(
                        out_buf, format="JPEG", quality=88, optimize=True
                    )

                    figure_counter += 1
                    page_images.append({
                        "index": figure_counter,
                        "kind": "figure_region",
                        "page": page_num,
                        "bbox": [float(crop.x0), float(crop.y0),
                                 float(crop.x1), float(crop.y1)],
                        "caption": cap_text,
                        "label": label,
                        "format": "jpeg",
                        "width": w,
                        "height": h,
                        "data": base64.b64encode(out_buf.getvalue()).decode("utf-8"),
                    })
                    result["stats"]["total_vector_figures"] += 1
                except Exception as e:
                    logger.debug(
                        f"[PDF] Figure-region render failed on page {page_num}: {e}"
                    )

            result["pages"][page_index]["images"] = page_images
            # total_images now reports composite figure regions (the only
            # kind of image we emit). Keep the field name for backward
            # compatibility with the frontend.
            result["stats"]["total_images"] += len(page_images)
    finally:
        doc.close()

    # Drop the internal `_text_blocks` field — it was only needed during the
    # pdfplumber + figure-region passes and would balloon the JSON response.
    for p in result["pages"]:
        p.pop("_text_blocks", None)


    # ---- Build LLM-friendly text digest -------------------------------------
    # The digest is what gets fed to text-only LLMs. For visual elements we
    # inline rich metadata markers so the LLM knows EXACTLY which figure /
    # table is being referenced even when it cannot see images.
    combined_chunks = []
    for p in result["pages"]:
        combined_chunks.append(f"\n===== Page {p['page']} =====\n")
        if p["text"].strip():
            combined_chunks.append(p["text"].strip())

        # Tables with caption + dimensions
        for ti, (tbl, tmeta) in enumerate(
            zip(p.get("tables", []), p.get("tables_meta", [])), start=1
        ):
            cap = (tmeta or {}).get("caption")
            rows = (tmeta or {}).get("rows", len(tbl))
            cols = (tmeta or {}).get("cols",
                                     max((len(r) for r in tbl), default=0))
            header_line = (
                f"\n[Table {ti} — page {p['page']}, {rows}x{cols}"
                + (f", caption: \"{cap}\"" if cap else "")
                + "]"
            )
            combined_chunks.append(header_line)
            for row in tbl:
                combined_chunks.append(" | ".join(row))

        # Images / figures with kind + caption + bbox + dimensions
        for im in p.get("images", []):
            kind = im.get("kind", "image")
            cap = im.get("caption")
            label = im.get("label")
            w = im.get("width")
            h = im.get("height")
            idx = im.get("index")
            # All emitted images are now composite figure regions, but we
            # keep the older labels around so legacy stored payloads still
            # render sensibly.
            kind_label = (
                "Figure" if kind in ("figure_region", "vector_figure") else
                "Image"  if kind == "embedded_image" else
                "Visual"
            )
            head = label if label else f"{kind_label} {idx}"
            size_part = f"{w}x{h}px" if (w and h) else "metadata-only"
            marker = (
                f"\n[{head} — page {p['page']}, {size_part}"
                + (f", caption: \"{cap}\"" if cap else "")
                + (", attached as image payload" if (w and h) else "")
                + "]"
            )
            combined_chunks.append(marker)

        if p.get("charts_detected") and not any(
            im.get("kind") in ("figure_region", "vector_figure")
            for im in p.get("images", [])
        ):
            # We detected vector drawings but rendering wasn't requested (or
            # produced no crop). Still tell the LLM they exist on this page.
            combined_chunks.append(
                f"\n[Note: {p['charts_detected']} vector chart/drawing region(s) "
                f"detected on page {p['page']} but not attached as image.]"
            )


        if p.get("links"):
            combined_chunks.append("\nLinks: " + ", ".join(p["links"][:20]))

    combined_text = "\n".join(combined_chunks).strip()
    result["combined_text"] = combined_text

    meta = result["metadata"]
    header = (
        f"PDF document: {filename}\n"
        f"Title: {meta.get('title') or '(none)'}\n"
        f"Author: {meta.get('author') or '(none)'}\n"
        f"Pages: {result['page_count']}\n"
        f"Embedded images extracted: {result['stats']['total_images']}\n"
        f"Vector figures rendered: {result['stats']['total_vector_figures']}\n"
        f"Tables extracted: {result['stats']['total_tables']}\n"
        f"Vector chart/drawing regions detected: "
        f"{result['stats']['total_charts_detected']}\n"
    )
    result["llm_summary_prompt"] = (
        header
        + "\n--- BEGIN DOCUMENT CONTENT ---\n"
        + combined_text
        + "\n--- END DOCUMENT CONTENT ---\n"
    )

    return result


@app.post("/api/pdf/extract")
async def extract_pdf(
    file: UploadFile = File(...),
    include_images: str = "true",
    render_pages: str = "false",
):
    """
    Extract text, images, tables, charts and metadata from an uploaded PDF.

    Query/form params:
      - include_images: "true"/"false" — whether to return base64 image
                        payloads. Stats (counts, captions, bboxes) are
                        always returned regardless of this flag.
      - render_pages:   "true"/"false" — when true, also render bounding-box
                        crops of detected vector figures/charts so vision LLMs
                        can analyze them. Whole text-only pages are NEVER
                        rendered; only regions containing actual visuals.

    There is NO cap on how many images / figures / tables are extracted —
    every visual element present in the document is returned, with rich
    per-element metadata (page, bbox, caption, dimensions) so even text-only
    LLMs understand the document's structure.
    """
    try:
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400, detail="Only .pdf files are supported"
            )

        pdf_bytes = await file.read()
        if not pdf_bytes:
            raise HTTPException(status_code=400, detail="Empty file")

        size_mb = len(pdf_bytes) / (1024 * 1024)
        logger.info(f"[PDF] Extracting '{file.filename}' ({size_mb:.2f} MB)")

        wants_images = str(include_images).lower() in ("1", "true", "yes")
        wants_rendered = str(render_pages).lower() in ("1", "true", "yes")

        loop = asyncio.get_event_loop()
        payload = await loop.run_in_executor(
            None,
            lambda: _extract_pdf_payload(
                pdf_bytes,
                file.filename,
                render_vector_figures=wants_rendered,
            ),
        )

        # If the caller doesn't want image bytes back, strip the base64 data
        # but KEEP all metadata (counts, captions, bboxes) so the frontend
        # can still warn the user about visual content present in the PDF.
        if not wants_images:
            for p in payload["pages"]:
                for im in p.get("images", []):
                    im["data"] = ""

        logger.info(
            f"[PDF] '{file.filename}' -> {payload['page_count']} pages, "
            f"{payload['stats']['total_chars']} chars, "
            f"{payload['stats']['total_tables']} tables, "
            f"{payload['stats']['total_images']} embedded images, "
            f"{payload['stats']['total_vector_figures']} vector figures, "
            f"{payload['stats']['total_charts_detected']} chart regions"
        )

        return payload

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[PDF] Extraction failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"PDF extraction failed: {e}"
        )



# =============================================================================
# REST API ENDPOINTS - NETWORK INFO
# =============================================================================

def get_macos_wifi_interfaces():
    """Get WiFi interface names on macOS using networksetup"""
    wifi_interfaces = set()
    try:
        # Get hardware ports mapping
        result = subprocess.run(
            ['networksetup', '-listallhardwareports'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            lines = result.stdout.split('\n')
            current_is_wifi = False
            for line in lines:
                if 'Hardware Port:' in line:
                    port_name = line.split('Hardware Port:')[1].strip().lower()
                    # Check if this hardware port is WiFi
                    current_is_wifi = any(w in port_name for w in ['wi-fi', 'wifi', 'airport', 'wireless'])
                elif 'Device:' in line and current_is_wifi:
                    device = line.split('Device:')[1].strip()
                    if device:
                        wifi_interfaces.add(device)
                    current_is_wifi = False
    except Exception as e:
        logger.debug(f"Could not get macOS WiFi interfaces: {e}")
    return wifi_interfaces

def get_macos_hotspot_bridges():
    """Get bridge interfaces used for Internet Sharing (hotspot) on macOS"""
    hotspot_bridges = set()
    try:
        # Check for active bridge interfaces that are used for Internet Sharing
        # Internet Sharing creates bridge100, bridge101, etc.
        result = subprocess.run(
            ['ifconfig'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            lines = result.stdout.split('\n')
            current_interface = None
            for line in lines:
                # Check for interface definition line (starts with interface name)
                if line and not line.startswith('\t') and not line.startswith(' '):
                    if ':' in line:
                        current_interface = line.split(':')[0]
                # Look for bridge interfaces with typical hotspot characteristics
                # bridge100+ interfaces with member ap1 are hotspot bridges
                if current_interface and current_interface.startswith('bridge'):
                    # Check if this bridge has an IP in hotspot range (192.168.x.1 pattern)
                    if 'inet ' in line:
                        parts = line.strip().split()
                        if len(parts) >= 2:
                            ip = parts[1]
                            # Hotspot bridges typically have .1 as the last octet
                            if ip.endswith('.1') and not ip.startswith('127.'):
                                hotspot_bridges.add(current_interface)
                                logger.info(f"Detected macOS hotspot bridge: {current_interface} with IP {ip}")
    except Exception as e:
        logger.debug(f"Could not detect macOS hotspot bridges: {e}")
    return hotspot_bridges

def get_linux_interface_type(interface: str) -> str:
    """Determine interface type on Linux"""
    interface_lower = interface.lower()
    
    # Check for wireless indicators in name
    if any(p in interface_lower for p in ['wlan', 'wlp', 'wl', 'wifi', 'wlo']):
        return 'wifi'
    
    # Check /sys/class/net for wireless capability
    try:
        wireless_path = f'/sys/class/net/{interface}/wireless'
        if os.path.exists(wireless_path):
            return 'wifi'
    except:
        pass
    
    # Check for ethernet indicators
    if any(p in interface_lower for p in ['eth', 'enp', 'eno', 'ens']):
        return 'ethernet'
    
    return 'unknown'

def get_windows_wifi_interfaces():
    """Get WiFi interface GUIDs on Windows using multiple detection methods"""
    wifi_interface_guids = set()
    interface_guid_to_description = {}  # Map interface GUID to description
    
    # Method 1: Use PowerShell Get-NetAdapter with InterfaceGuid for comprehensive detection
    try:
        # Get all adapters with their GUIDs and descriptions - GUIDs match what netifaces returns
        ps_command = "Get-NetAdapter | Select-Object Name,InterfaceDescription,PhysicalMediaType,InterfaceGuid | ConvertTo-Json"
        result = subprocess.run(
            ['powershell', '-Command', ps_command],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            try:
                adapters = json.loads(result.stdout)
                # Handle both single adapter (dict) and multiple adapters (list)
                if isinstance(adapters, dict):
                    adapters = [adapters]
                
                for adapter in adapters:
                    name = adapter.get('Name', '')
                    description = (adapter.get('InterfaceDescription', '') or '').lower()
                    media_type = (adapter.get('PhysicalMediaType', '') or '').lower()
                    interface_guid = adapter.get('InterfaceGuid', '')
                    
                    if not interface_guid:
                        continue
                    
                    # Normalize GUID format to match netifaces (with curly braces)
                    if not interface_guid.startswith('{'):
                        interface_guid = '{' + interface_guid + '}'
                    interface_guid = interface_guid.upper()
                    
                    interface_guid_to_description[interface_guid] = description
                    
                    # Check if this is a WiFi adapter based on description or media type
                    is_wifi = any(w in description for w in [
                        'wi-fi', 'wifi', 'wireless', '802.11', 'wlan',
                        'wi-fi direct', 'wifi direct', 'mobile hotspot'
                    ]) or any(w in media_type for w in [
                        'wireless', '802.11', 'native 802.11'
                    ])
                    
                    if is_wifi:
                        wifi_interface_guids.add(interface_guid)
                        logger.info(f"Windows WiFi interface found: {name} (GUID: {interface_guid}, desc: {description})")
                    else:
                        logger.debug(f"Windows non-WiFi interface: {name} (GUID: {interface_guid}, desc: {description})")
            except json.JSONDecodeError:
                logger.debug("Failed to parse PowerShell JSON output")
    except Exception as e:
        logger.debug(f"Could not get Windows interfaces via PowerShell: {e}")
    
    return wifi_interface_guids, interface_guid_to_description

@app.get("/api/network-info")
async def get_network_info():
    """Get network addresses"""
    try:
        import netifaces
        
        wifi_ips = []
        ethernet_ips = []
        https_port = int(os.environ.get('HTTPS_PORT', 3443))
        
        # Determine OS and get WiFi interfaces
        is_macos = platform.system() == 'Darwin'
        is_linux = platform.system() == 'Linux'
        is_windows = platform.system() == 'Windows'
        
        macos_wifi_interfaces = set()
        macos_hotspot_bridges = set()
        windows_wifi_interfaces = set()
        windows_interface_descriptions = {}
        
        if is_macos:
            macos_wifi_interfaces = get_macos_wifi_interfaces()
            macos_hotspot_bridges = get_macos_hotspot_bridges()
            logger.debug(f"macOS WiFi interfaces: {macos_wifi_interfaces}")
            logger.info(f"macOS hotspot bridges: {macos_hotspot_bridges}")
        elif is_windows:
            windows_wifi_interfaces, windows_interface_descriptions = get_windows_wifi_interfaces()
            logger.info(f"Windows WiFi interfaces: {windows_wifi_interfaces}")
            logger.info(f"Windows interface descriptions: {windows_interface_descriptions}")
        
        for interface in netifaces.interfaces():
            try:
                # Skip virtual/internal interfaces (but NOT on Windows - we need to check descriptions)
                interface_lower = interface.lower()
                
                # On Windows, we only skip clearly virtual interfaces
                if is_windows:
                    if any(skip in interface_lower for skip in ['docker', 'veth', 'vmnet', 'vbox', 'loopback']):
                        continue
                else:
                    # On macOS/Linux, skip more interfaces but allow hotspot bridges
                    # Check if this is a hotspot bridge before skipping
                    is_hotspot_bridge = is_macos and interface in macos_hotspot_bridges
                    
                    if not is_hotspot_bridge:
                        if any(skip in interface_lower for skip in ['lo', 'docker', 'veth', 'br-', 'vmnet', 'vbox', 'awdl', 'llw', 'utun', 'gif', 'stf', 'anpi', 'bridge', 'loopback']):
                            continue
                
                addrs = netifaces.ifaddresses(interface)
                if netifaces.AF_INET not in addrs:
                    continue
                
                for addr_info in addrs[netifaces.AF_INET]:
                    ip = addr_info.get('addr')
                    if not ip or ip.startswith('127.') or ip.startswith('169.254.'):
                        continue
                    
                    address = f"https://{ip}:{https_port}"
                    
                    # Determine if WiFi or Ethernet
                    is_wifi = False
                    
                    if is_macos:
                        # On macOS, check against known WiFi interfaces and hotspot bridges
                        if interface in macos_wifi_interfaces:
                            is_wifi = True
                            logger.debug(f"Interface {interface} ({ip}) -> WiFi (hardware WiFi)")
                        elif interface in macos_hotspot_bridges:
                            is_wifi = True
                            logger.info(f"Interface {interface} ({ip}) -> WiFi (Internet Sharing hotspot)")
                    elif is_linux:
                        # On Linux, use interface naming conventions and /sys
                        is_wifi = get_linux_interface_type(interface) == 'wifi'
                    elif is_windows:
                        # On Windows, netifaces returns interface GUIDs like {13698B45-A730-4370-B54B-228754DCB913}
                        # Normalize the interface name to uppercase for comparison
                        interface_upper = interface.upper()
                        
                        # Method 1: Check against known WiFi interface GUIDs from PowerShell
                        if interface_upper in windows_wifi_interfaces:
                            is_wifi = True
                            logger.info(f"Interface {interface} ({ip}) -> WiFi (matched by GUID)")
                        
                        # Method 2: Check interface description for WiFi keywords
                        elif interface_upper in windows_interface_descriptions:
                            desc = windows_interface_descriptions[interface_upper]
                            if any(w in desc for w in ['wi-fi', 'wifi', 'wireless', '802.11', 'wlan', 'wi-fi direct']):
                                is_wifi = True
                                logger.info(f"Interface {interface} ({ip}) -> WiFi (description: {desc})")
                        
                        # Method 3: Windows Mobile Hotspot IP range (192.168.137.x is default)
                        elif ip.startswith('192.168.137.'):
                            is_wifi = True
                            logger.info(f"Interface {interface} ({ip}) -> WiFi (Windows hotspot IP range)")
                        
                        # Method 4: Check for common Windows WiFi adapter naming patterns
                        elif any(p in interface_lower for p in ['wlan', 'wifi', 'wireless', 'wi-fi']):
                            is_wifi = True
                            logger.info(f"Interface {interface} ({ip}) -> WiFi (name pattern)")
                        
                        # Method 5: Check for "Local Area Connection*" which is often used by Mobile Hotspot
                        elif 'local area connection' in interface_lower and '*' in interface:
                            # Check if description indicates it's WiFi Direct
                            desc = windows_interface_descriptions.get(interface_upper, '')
                            if 'wi-fi direct' in desc or 'microsoft wi-fi' in desc:
                                is_wifi = True
                                logger.info(f"Interface {interface} ({ip}) -> WiFi (Mobile Hotspot)")
                        
                        if not is_wifi:
                            logger.info(f"Interface {interface} ({ip}) -> Ethernet (no WiFi indicators)")
                    else:
                        # Unknown OS - use name patterns as fallback
                        is_wifi = any(p in interface_lower for p in ['wlan', 'wifi', 'wireless', 'wi-fi'])
                    
                    if is_wifi:
                        wifi_ips.append(address)
                        logger.debug(f"WiFi interface {interface}: {ip}")
                    else:
                        ethernet_ips.append(address)
                        logger.debug(f"Ethernet interface {interface}: {ip}")
            except Exception as e:
                logger.debug(f"Error processing interface {interface}: {e}")
                continue
        
        logger.info(f"Network detection - WiFi: {wifi_ips}, Ethernet: {ethernet_ips}")
        
        return {
            'wifiIPs': wifi_ips,
            'ethernetIPs': ethernet_ips,
            'networkIPs': wifi_ips + ethernet_ips,
            'httpsPort': https_port,
            'httpPort': PORT
        }
    except Exception as e:
        logger.error(f"Error getting network info: {e}")
        raise HTTPException(status_code=500, detail="Failed to get network info")

# =============================================================================
# VOSK ASR WEBSOCKET
# =============================================================================

def load_vosk_model(name: str) -> Model:
    """Load Vosk model"""
    if name not in vosk_model_cache:
        model_path = VOSK_MODELS_DIR / name
        if not model_path.exists():
            raise ValueError(f"Model not found: {name}")
        vosk_model_cache[name] = Model(str(model_path))
    vosk_model_refcnt[name] += 1
    return vosk_model_cache[name]

def get_available_vosk_models():
    """Get available Vosk models"""
    if not VOSK_MODELS_DIR.exists():
        return []
    return sorted([p.name for p in VOSK_MODELS_DIR.iterdir() 
                   if p.is_dir() and ((p / 'am' / 'final.mdl').exists() or (p / 'conf' / 'model.conf').exists())])

@app.websocket("/vosk")
async def vosk_websocket(websocket: WebSocket):
    """Vosk ASR WebSocket endpoint"""
    await websocket.accept()
    
    session_id = f"{websocket.client.host}:{websocket.client.port}:{id(websocket)}"
    logger.info(f"[Vosk] Connection: {session_id}")
    
    rec = None
    current_model = vosk_default_model_name
    sample_rate = 16000
    
    # Initialize recognizer
    if current_model and current_model in vosk_model_cache:
        model = vosk_model_cache[current_model]
        vosk_model_refcnt[current_model] += 1
        rec = KaldiRecognizer(model, sample_rate)
        rec.SetWords(True)
    
    try:
        while True:
            message = await websocket.receive()
            
            # Check for disconnect message
            if message.get('type') == 'websocket.disconnect':
                logger.info(f"[Vosk] Received disconnect message: {session_id}")
                break
            
            # Handle binary audio data
            if 'bytes' in message:
                audio_data = message['bytes']
                if rec:
                    if rec.AcceptWaveform(audio_data):
                        result = json.loads(rec.Result())
                        if result.get("text"):
                            await websocket.send_json({"type": "result", "text": result["text"]})
                    else:
                        partial = json.loads(rec.PartialResult())
                        if partial.get("partial"):
                            await websocket.send_json({"type": "partial", "partial": partial["partial"]})
            
            # Handle text messages (JSON commands)
            elif 'text' in message:
                try:
                    msg = json.loads(message['text'])
                    msg_type = msg.get("type")
                    
                    if msg_type == "get_models":
                        await websocket.send_json({"type": "models", "models": get_available_vosk_models()})
                    
                    elif msg_type == "get_current_model":
                        await websocket.send_json({"type": "current_model", "model": current_model or "none"})
                    
                    elif msg_type == "select_model":
                        model_name = msg["model"]
                        if current_model:
                            vosk_model_refcnt[current_model] -= 1
                        
                        model = load_vosk_model(model_name)
                        current_model = model_name
                        rec = KaldiRecognizer(model, sample_rate)
                        rec.SetWords(True)
                        await websocket.send_json({"type": "model_loaded", "model": model_name})
                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    logger.error(f"[Vosk] Error processing message: {e}")
    
    except WebSocketDisconnect:
        logger.info(f"[Vosk] Client disconnected: {session_id}")
    except Exception as e:
        logger.error(f"[Vosk] Error in WebSocket handler: {e}")
    finally:
        if current_model:
            vosk_model_refcnt[current_model] -= 1

# =============================================================================
# KOKORO TTS WEBSOCKET
# =============================================================================

async def initialize_tts_pipeline():
    """Initialize Kokoro TTS pipeline"""
    global tts_pipeline
    
    try:
        # Import Kokoro
        from kokoro import KPipeline
        
        # Get cache directory from environment (Electron sets this to ~/.nebulon-gpt/huggingface)
        cache_dir = os.environ.get('HF_HOME')
        
        if not cache_dir:
            logger.error("HF_HOME environment variable not set!")
            raise ValueError("HF_HOME not configured")
        
        logger.info(f"Using HuggingFace cache directory: {cache_dir}")
        
        # Ensure cache directories exist
        os.makedirs(cache_dir, exist_ok=True)
        os.makedirs(f"{cache_dir}/transformers", exist_ok=True)
        os.makedirs(f"{cache_dir}/datasets", exist_ok=True)
        
        # Set cache directories explicitly
        os.environ["HF_HOME"] = cache_dir
        os.environ["TRANSFORMERS_CACHE"] = f"{cache_dir}/transformers"
        os.environ["HF_DATASETS_CACHE"] = f"{cache_dir}/datasets"
        
        logger.info(f"TRANSFORMERS_CACHE: {os.environ['TRANSFORMERS_CACHE']}")
        logger.info(f"HF_DATASETS_CACHE: {os.environ['HF_DATASETS_CACHE']}")
        
        # Try offline first
        try:
            os.environ["HF_HUB_OFFLINE"] = "1"
            loop = asyncio.get_event_loop()
            tts_pipeline = await loop.run_in_executor(None, lambda: KPipeline(lang_code='a', device='cpu'))
            logger.info("TTS pipeline initialized (offline)")
        except:
            os.environ["HF_HUB_OFFLINE"] = "0"
            loop = asyncio.get_event_loop()
            tts_pipeline = await loop.run_in_executor(None, lambda: KPipeline(lang_code='a', device='cpu'))
            logger.info("TTS pipeline initialized (online)")
    except Exception as e:
        logger.error(f"Failed to initialize TTS: {e}")
        raise

async def generate_tts_audio(text: str, voice: str, speed: float):
    """Generate TTS audio"""
    global tts_pipeline
    
    if not tts_pipeline:
        return None
    
    try:
        loop = asyncio.get_event_loop()
        
        def _generate():
            generator = tts_pipeline(text, voice=voice, speed=speed)
            audio_segments = [audio for _, _, audio in generator]
            if not audio_segments:
                return None
            full_audio = torch.cat(audio_segments, dim=0) if len(audio_segments) > 1 else audio_segments[0]
            audio_buffer = io.BytesIO()
            sf.write(audio_buffer, full_audio.numpy(), 24000, format='WAV')
            return audio_buffer.getvalue()
        
        return await loop.run_in_executor(None, _generate)
    except Exception as e:
        logger.error(f"TTS generation error: {e}")
        return None

def process_next_in_queue(websocket: WebSocket, session_state: dict):
    """Process the next item in the TTS queue"""
    tts_queue = session_state['tts_queue']
    is_paused = session_state['paused']
    
    if tts_queue and not is_paused:
        task_fn = tts_queue.pop(0)
        task = asyncio.create_task(task_fn())
        session_state['current_task'] = task
    else:
        session_state['current_task'] = None

@app.websocket("/tts")
async def tts_websocket(websocket: WebSocket):
    """Kokoro TTS WebSocket endpoint"""
    await websocket.accept()
    
    session_id = f"{websocket.client.host}:{websocket.client.port}:{id(websocket)}"
    logger.info(f"[TTS] Connection: {session_id}")
    
    session_state = {
        'paused': False,
        'active_message_id': None,
        'queued_audio': [],
        'processing': False,
        'tts_queue': [],
        'current_task': None
    }
    
    try:
        while True:
            data = await websocket.receive_json()
            
            # Handle actions (stop, pause, resume)
            if 'action' in data:
                action = data['action'].lower()
                
                if action in ['stop', 'clear']:
                    # Clear TTS queue and state
                    session_state['tts_queue'].clear()
                    session_state['queued_audio'].clear()
                    session_state['paused'] = False
                    session_state['active_message_id'] = None
                    session_state['processing'] = False
                    session_state['current_task'] = None
                    
                    # Clear runtime cache while preserving model cache
                    try:
                        if tts_pipeline:
                            # Clear PyTorch cache if using GPU
                            if torch.cuda.is_available():
                                torch.cuda.empty_cache()
                                logger.info("[TTS] Cleared CUDA cache")
                            
                            # Force Python garbage collection
                            import gc
                            gc.collect()
                            logger.info("[TTS] Forced garbage collection")
                    except Exception as e:
                        logger.warning(f"[TTS] Error clearing runtime cache: {e}")
                    
                    # Verification loop - check until everything is cleared (max 1 second)
                    max_attempts = 10
                    attempt = 0
                    cleared = False
                    
                    while not cleared and attempt < max_attempts:
                        await asyncio.sleep(0.1)
                        attempt += 1
                        
                        # Check if everything is properly cleared
                        buffers_empty = len(session_state.get('queued_audio', [])) == 0
                        queue_empty = len(session_state.get('tts_queue', [])) == 0
                        not_paused = session_state.get('paused', False) == False
                        not_processing = session_state.get('processing', False) == False
                        
                        cleared = all([buffers_empty, queue_empty, not_paused, not_processing])
                        
                        if cleared:
                            logger.info(f"[TTS] Completely cleared after {attempt * 100}ms")
                            break
                    
                    if not cleared:
                        logger.warning(f"[TTS] Clearing verification timeout after 1 second")
                    
                    await websocket.send_json({
                        'type': 'queue_cleared',
                        'action': action,
                        'status': 'success' if cleared else 'partial',
                        'message': f'Server-side TTS cleared after {attempt * 100}ms verification',
                        'verification_time_ms': attempt * 100,
                        'fully_cleared': cleared,
                        'ready_for_next_operation': cleared
                    })
                
                elif action == 'pause':
                    session_state['paused'] = True
                    await websocket.send_json({'type': 'queue_paused', 'status': 'success'})
                
                elif action == 'resume':
                    session_state['paused'] = False
                    await websocket.send_json({'type': 'queue_resumed', 'status': 'success'})
                
                elif action == 'set_active_msg_id':
                    session_state['active_message_id'] = data.get('assistantMessageId')
                    await websocket.send_json({
                        'type': 'active_msg_id_set',
                        'success': True,
                        'assistantMessageId': session_state['active_message_id'],
                        'requestId': data.get('requestId')
                    })
            
            # Handle TTS request
            elif 'text' in data:
                text = data.get('text', '')
                if not text:
                    continue
                
                voice = data.get('voice', 'af_heart')
                speed = data.get('speed', 1.0)
                msg_id = data.get('assistantMessageId')
                
                # Create async task function for queue
                async def tts_task():
                    try:
                        # Check message ID match
                        if session_state['active_message_id'] and session_state['active_message_id'] != msg_id:
                            logger.info(f"[TTS] Skipping - message ID mismatch: active={session_state['active_message_id']}, incoming={msg_id}")
                            return
                        
                        logger.info(f"[TTS] Processing - message ID match: {msg_id}, text: {text[:50]}...")
                        
                        # Generate audio
                        audio_data = await generate_tts_audio(text, voice, speed)
                        
                        if audio_data:
                            await websocket.send_json({
                                'type': 'complete_audio',
                                'text': text,
                                'voice': voice,
                                'speed': speed,
                                'audio': base64.b64encode(audio_data).decode('utf-8'),
                                'audio_format': 'wav',
                                'sample_rate': 24000,
                                'assistantMessageId': msg_id
                            })
                    except Exception as e:
                        logger.error(f"[TTS] Error in TTS task: {e}")
                    finally:
                        # Process next item in queue
                        process_next_in_queue(websocket, session_state)
                
                # Add task to queue
                session_state['tts_queue'].append(tts_task)
                
                # If no current task or current task is done, start processing
                current_task = session_state.get('current_task')
                if not current_task or current_task.done():
                    process_next_in_queue(websocket, session_state)
    
    except WebSocketDisconnect:
        logger.info(f"[TTS] Disconnected: {session_id}")

# =============================================================================
# HEALTH CHECK
# =============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "unified-backend",
        "port": PORT,
        "timestamp": datetime.now().isoformat(),
        "vosk_models_loaded": len(vosk_model_cache),
        "tts_initialized": tts_pipeline is not None
    }

# =============================================================================
# TTS MODELS CHECK ENDPOINT
# =============================================================================

@app.get("/api/tts/models-check")
async def check_tts_models():
    """Check if TTS models exist in the huggingface cache directory"""
    try:
        # Get the HuggingFace cache directory from environment or use default
        hf_home = os.environ.get('HF_HOME', '')
        
        if not hf_home:
            # Try to construct the default path based on OS
            home_dir = os.path.expanduser('~')
            hf_home = os.path.join(home_dir, '.nebulon-gpt', 'huggingface')
        
        # The TTS models are stored in the 'hub' subdirectory
        tts_models_path = os.path.join(hf_home, 'hub')
        
        # Get the base data directory (.nebulon-gpt)
        data_dir = os.path.dirname(hf_home)
        
        logger.info(f"Checking TTS models at: {tts_models_path}")
        
        # Check if directory exists and has content
        exists = False
        if os.path.exists(tts_models_path) and os.path.isdir(tts_models_path):
            contents = os.listdir(tts_models_path)
            # Filter out system files
            actual_content = [
                item for item in contents 
                if not item.startswith('.') and item not in ['Thumbs.db', 'desktop.ini']
            ]
            exists = len(actual_content) > 0
            logger.info(f"TTS models directory exists, has models: {exists}, contents: {len(actual_content)}")
        else:
            logger.info(f"TTS models directory not found at: {tts_models_path}")
        
        # Determine platform for displaying correct path to user
        current_platform = platform.system().lower()
        if current_platform == 'darwin':
            current_platform = 'macos'
        elif current_platform == 'windows':
            current_platform = 'windows'
        else:
            current_platform = 'linux'
        
        return {
            "exists": exists,
            "path": tts_models_path,
            "dataDirectory": data_dir,
            "platform": current_platform
        }
    except Exception as e:
        logger.error(f"Error checking TTS models: {e}")
        return {
            "exists": False,
            "path": "",
            "dataDirectory": "",
            "platform": platform.system().lower(),
            "error": str(e)
        }

# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    
    logger.info("=" * 80)
    logger.info("Starting NebulonGPT Unified Backend")
    logger.info(f"Port: {PORT}")
    logger.info("=" * 80)
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        log_level="info"
    )
