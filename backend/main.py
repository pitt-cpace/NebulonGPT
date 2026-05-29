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
# PDF text + image + table + metadata extraction for sending to LLMs.
# Uses:
#   - PyMuPDF (fitz)   -> fast text extraction, embedded images, metadata,
#                          drawings/charts detection, links, TOC
#   - pdfplumber       -> accurate table extraction (built on pdfminer.six)
#   - Pillow           -> re-encode extracted images to a safe PNG/JPEG payload
#
# The endpoint accepts a PDF upload and returns a structured JSON document
# that the frontend can drop into a FileAttachment (type='pdf') and forward
# to the LLM via the existing chat pipeline.

def _extract_pdf_payload(pdf_bytes: bytes, filename: str,
                         max_image_dim: int = 1280,
                         render_vector_figures: bool = False) -> dict:
    """
    Extract structured content from a PDF (text, embedded images, vector
    figures/charts, tables, metadata).

    Design goals (all driven by user feedback):
      1. NO CAP on how many visual elements are extracted. Every embedded
         raster image, every detected vector-figure region, and every
         pdfplumber-found table is returned.
      2. NEVER render a whole text-only page as an image. Pages that contain
         only body text produce zero rendered images. Pages with figures
         produce tight crops of just the figure region (via bbox clustering
         of vector drawings), not the whole page.
      3. Each visual carries rich metadata for the LLM:
              {
                "kind":   "embedded_image" | "vector_figure",
                "page":   int,           # 1-indexed page number
                "bbox":   [x0,y0,x1,y1], # in PDF points (top-left origin)
                "caption": str | None,   # nearest "Figure N: …" / "Table N: …"
                "width":  int (px),
                "height": int (px),
                "format": "png" | "jpeg",
                "data":   "<base64>",
              }
         Tables carry parallel metadata via `tables_meta`:
              {"rows": int, "cols": int, "bbox": [...], "caption": str|None}
         This way even text-only LLMs receive structured `[Figure N — page P,
         caption "…"]` markers inline with the document text, so they know
         where figures/tables belong.
      4. Per-image dimensions are still bounded by `max_image_dim` on the
         longest side. This is a per-image quality knob, NOT a per-document
         count cap.

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
              "images": [{... see schema above ...}, ...],
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
    """
    import fitz  # PyMuPDF
    import pdfplumber
    from PIL import Image
    import re

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
    #   "Fig. 1 | Title …"        "Figure 2: Title …"
    #   "Figure S3 — Title …"     "Table 1. Title …"
    #   "Scheme 4 | …"            "Chart 2 – …"
    CAPTION_RE = re.compile(
        r"^\s*(Fig(?:ure|\.)?|Table|Chart|Diagram|Scheme|Plate|Panel)"
        r"\s*(S?\d+[A-Za-z]?)?\s*[\.\:\|\-\u2013\u2014]?\s*(.+)",
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
            keyword = m.group(1).lower()
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
        # document. Embedded raster images and rendered vector-figure crops
        # share the same counter.
        figure_counter = 0

        for page_index in range(doc.page_count):
            page = doc.load_page(page_index)
            page_num = page_index + 1
            page_rect = page.rect  # (0,0,width,height) in PDF points

            # ---- Text + per-page text blocks (for caption matching) ----------
            try:
                page_text = page.get_text("text") or ""
            except Exception as e:
                logger.debug(f"[PDF] Text extraction failed page {page_index}: {e}")
                page_text = ""

            try:
                text_blocks = page.get_text("blocks") or []
            except Exception:
                text_blocks = []

            # ---- Links --------------------------------------------------------
            page_links = []
            try:
                for link in page.get_links() or []:
                    if link.get("uri"):
                        page_links.append(link["uri"])
            except Exception:
                pass

            # ---- Vector drawings (used both for charts_detected heuristic
            #      AND to compute figure-region bboxes for cropping) -----------
            drawing_rects = []
            charts_count = 0
            try:
                drawings = page.get_drawings() or []
                for d in drawings:
                    items = d.get("items", []) or []
                    if len(items) < 5:
                        continue  # ignore trivial drawings (page borders, etc.)
                    rect = d.get("rect")
                    if rect is None:
                        continue
                    # Skip absurdly small rects (likely glyph artifacts)
                    if rect.width < 8 or rect.height < 8:
                        continue
                    drawing_rects.append(rect)
                charts_count = len(drawing_rects)
            except Exception:
                charts_count = 0

            # Cluster the many small path bboxes that make up a single
            # vector figure into one merged bbox per figure.
            figure_clusters = _cluster_rects(drawing_rects, gap=20.0)
            # Drop clusters that are page-sized (would mean the whole page
            # is one giant "drawing", which usually means our heuristic
            # picked up the body text via vector outlines — not useful as
            # an image crop).
            page_area = max(1.0, page_rect.width * page_rect.height)
            filtered_clusters = []
            for c in figure_clusters:
                cw = c[2] - c[0]
                ch = c[3] - c[1]
                area_ratio = (cw * ch) / page_area
                if cw < 40 or ch < 40:
                    continue
                if area_ratio > 0.9:
                    continue  # likely whole-page text, not a figure
                filtered_clusters.append(c)

            page_images = []

            # ---- Embedded raster images (NO COUNT CAP) -----------------------
            # Extract every embedded raster image. Each gets bbox (where it
            # actually sits on the page), nearest figure caption, and a
            # running figure index for the LLM.
            try:
                raster_infos = page.get_images(full=True) or []
            except Exception as e:
                logger.debug(f"[PDF] get_images failed page {page_num}: {e}")
                raster_infos = []

            for img_info in raster_infos:
                xref = img_info[0]
                try:
                    # Find where on the page this image is actually placed
                    bbox = None
                    try:
                        rects = page.get_image_rects(xref) or []
                        if rects:
                            r = rects[0]
                            bbox = [float(r.x0), float(r.y0),
                                    float(r.x1), float(r.y1)]
                    except Exception:
                        bbox = None

                    pix = fitz.Pixmap(doc, xref)
                    if pix.n - pix.alpha >= 4:  # CMYK -> RGB
                        pix = fitz.Pixmap(fitz.csRGB, pix)

                    img_bytes = pix.tobytes("png")
                    pil_img = Image.open(io.BytesIO(img_bytes))
                    w, h = pil_img.size

                    # Skip 1-pixel/tiny "decorative" PDF images
                    if w < 16 or h < 16:
                        continue

                    if max(w, h) > max_image_dim:
                        scale = max_image_dim / float(max(w, h))
                        pil_img = pil_img.resize(
                            (max(1, int(w * scale)), max(1, int(h * scale))),
                            Image.LANCZOS,
                        )
                        w, h = pil_img.size

                    out_buf = io.BytesIO()
                    if pil_img.mode in ("RGBA", "LA"):
                        pil_img.save(out_buf, format="PNG", optimize=True)
                        fmt = "png"
                    else:
                        pil_img.convert("RGB").save(
                            out_buf, format="JPEG", quality=82, optimize=True
                        )
                        fmt = "jpeg"

                    caption = _find_caption(text_blocks, bbox,
                                            kind_hint="figure") if bbox else None

                    figure_counter += 1
                    page_images.append({
                        "index": figure_counter,
                        "kind": "embedded_image",
                        "page": page_num,
                        "bbox": bbox,
                        "caption": caption,
                        "format": fmt,
                        "width": w,
                        "height": h,
                        "data": base64.b64encode(out_buf.getvalue()).decode("utf-8"),
                    })
                except Exception as ie:
                    logger.debug(
                        f"[PDF] Failed to decode raster xref={xref} on page {page_num}: {ie}"
                    )
                    continue
                finally:
                    try:
                        pix = None
                    except Exception:
                        pass

            # ---- Vector-figure region crops ----------------------------------
            # Only crop where vector drawings actually live on the page. Pages
            # whose `filtered_clusters` is empty produce ZERO rendered images
            # — we never render full text-only pages.
            if render_vector_figures and filtered_clusters:
                for clust in filtered_clusters:
                    try:
                        # Expand the crop a little so axis labels / legends
                        # near the figure also make it into the image.
                        pad = 8.0
                        crop = fitz.Rect(
                            max(page_rect.x0, clust[0] - pad),
                            max(page_rect.y0, clust[1] - pad),
                            min(page_rect.x1, clust[2] + pad),
                            min(page_rect.y1, clust[3] + pad),
                        )
                        if crop.width < 20 or crop.height < 20:
                            continue

                        matrix = fitz.Matrix(2, 2)  # ~144 DPI
                        pm = page.get_pixmap(matrix=matrix, alpha=False,
                                             clip=crop)
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
                            out_buf, format="JPEG", quality=82, optimize=True
                        )

                        bbox = [float(crop.x0), float(crop.y0),
                                float(crop.x1), float(crop.y1)]
                        caption = _find_caption(text_blocks, bbox,
                                                kind_hint="figure")

                        figure_counter += 1
                        page_images.append({
                            "index": figure_counter,
                            "kind": "vector_figure",
                            "page": page_num,
                            "bbox": bbox,
                            "caption": caption,
                            "format": "jpeg",
                            "width": w,
                            "height": h,
                            "data": base64.b64encode(out_buf.getvalue()).decode("utf-8"),
                        })
                        result["stats"]["total_vector_figures"] += 1
                    except Exception as e:
                        logger.debug(
                            f"[PDF] Vector-figure crop failed on page {page_num}: {e}"
                        )

            result["pages"].append({
                "page": page_num,
                "text": page_text,
                "tables": [],         # filled by pdfplumber pass below
                "tables_meta": [],    # filled by pdfplumber pass below
                "images": page_images,
                "charts_detected": charts_count,
                "links": page_links,
                # Internal: kept for caption matching during pdfplumber pass
                "_text_blocks": text_blocks,
            })

            result["stats"]["total_images"] += sum(
                1 for im in page_images if im.get("kind") == "embedded_image"
            )
            result["stats"]["total_chars"] += len(page_text)
            result["stats"]["total_charts_detected"] += charts_count
    finally:
        doc.close()


    # ---- pdfplumber: tables (with bbox + nearest caption metadata) ----------
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pp:
            for page_index, pp_page in enumerate(pp.pages):
                if page_index >= len(result["pages"]):
                    break

                # Use find_tables() so we also get a bbox for each table; this
                # lets us locate the matching "Table N: …" caption on the page.
                table_objs = []
                try:
                    table_objs = pp_page.find_tables() or []
                except Exception as e:
                    logger.debug(
                        f"[PDF] find_tables failed page {page_index}: {e}"
                    )

                # Fall back to extract_tables if find_tables didn't yield results
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

                result["pages"][page_index]["tables"] = clean_tables
                result["pages"][page_index]["tables_meta"] = clean_tables_meta
                result["stats"]["total_tables"] += len(clean_tables)
    except Exception as e:
        logger.warning(f"[PDF] pdfplumber pass failed: {e}")

    # Drop the internal `_text_blocks` field — it was only needed during the
    # pdfplumber pass and would balloon the JSON response otherwise.
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
            w = im.get("width")
            h = im.get("height")
            idx = im.get("index")
            kind_label = (
                "Figure" if kind == "vector_figure" else
                "Image"  if kind == "embedded_image" else
                "Visual"
            )
            marker = (
                f"\n[{kind_label} {idx} — page {p['page']}, {w}x{h}px"
                + (f", caption: \"{cap}\"" if cap else "")
                + ", attached as image payload]"
            )
            combined_chunks.append(marker)

        if p.get("charts_detected") and not any(
            im.get("kind") == "vector_figure" for im in p.get("images", [])
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
