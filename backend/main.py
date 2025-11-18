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
DATA_DIR = Path(os.environ.get('DATA_DIR', '/app/data'))
CHATS_FILE = DATA_DIR / 'chats.json'
VOSK_MODELS_DIR = Path(os.environ.get('VOSK_MODELS_DIR', '/app/backend/models/vosk'))

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
# REST API ENDPOINTS - NETWORK INFO
# =============================================================================

@app.get("/api/network-info")
async def get_network_info():
    """Get network addresses"""
    try:
        import netifaces
        
        wifi_ips = []
        ethernet_ips = []
        https_port = int(os.environ.get('HTTPS_PORT', 3443))
        
        for interface in netifaces.interfaces():
            try:
                addrs = netifaces.ifaddresses(interface)
                if netifaces.AF_INET not in addrs:
                    continue
                
                for addr_info in addrs[netifaces.AF_INET]:
                    ip = addr_info.get('addr')
                    if not ip or ip.startswith('127.'):
                        continue
                    
                    address = f"https://{ip}:{https_port}"
                    interface_lower = interface.lower()
                    
                    if any(p in interface_lower for p in ['wlan', 'wl', 'wifi', 'wi-fi', 'air', 'awdl', 'bridge']):
                        wifi_ips.append(address)
                    else:
                        ethernet_ips.append(address)
            except:
                continue
        
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
            data = await websocket.receive()
            
            # Binary audio data
            if 'bytes' in data:
                if rec:
                    if rec.AcceptWaveform(data['bytes']):
                        result = json.loads(rec.Result())
                        if result.get("text"):
                            await websocket.send_json({"type": "result", "text": result["text"]})
                    else:
                        partial = json.loads(rec.PartialResult())
                        if partial.get("partial"):
                            await websocket.send_json({"type": "partial", "partial": partial["partial"]})
            
            # JSON commands
            elif 'text' in data:
                try:
                    msg = json.loads(data['text'])
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
                except:
                    pass
    
    except WebSocketDisconnect:
        logger.info(f"[Vosk] Disconnected: {session_id}")
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
        
        # Set cache directories
        cache_dir = os.environ.get('HF_HOME', '/app/.cache/huggingface')
        os.environ["HF_HOME"] = cache_dir
        os.environ["TRANSFORMERS_CACHE"] = f"{cache_dir}/transformers"
        os.environ["HF_DATASETS_CACHE"] = f"{cache_dir}/datasets"
        
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

@app.websocket("/tts")
async def tts_websocket(websocket: WebSocket):
    """Kokoro TTS WebSocket endpoint"""
    await websocket.accept()
    
    session_id = f"{websocket.client.host}:{websocket.client.port}:{id(websocket)}"
    logger.info(f"[TTS] Connection: {session_id}")
    
    session_state = {
        'paused': False,
        'active_message_id': None,
        'queue': []
    }
    
    try:
        while True:
            data = await websocket.receive_json()
            
            # Handle actions (stop, pause, resume)
            if 'action' in data:
                action = data['action'].lower()
                
                if action in ['stop', 'clear']:
                    session_state['queue'].clear()
                    session_state['paused'] = False
                    session_state['active_message_id'] = None
                    await websocket.send_json({
                        'type': 'queue_cleared',
                        'status': 'success'
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
                
                # Check message ID match
                if session_state['active_message_id'] and session_state['active_message_id'] != msg_id:
                    logger.info(f"[TTS] Skipping - message ID mismatch")
                    continue
                
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
