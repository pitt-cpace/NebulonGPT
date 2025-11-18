#!/usr/bin/env python3
"""
Vosk ASR WebSocket Server
Automatic Speech Recognition service for NebulonGPT
Migrated from Vosk-Server/websocket/asr_server_with_models.py
"""

import json
import os
import asyncio
import pathlib
import websockets
import concurrent.futures
import logging
import time
from collections import defaultdict
from vosk import Model, SpkModel, KaldiRecognizer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global caches
model_cache = {}
model_refcnt = defaultdict(int)
default_model_name = None
session_models = {}
active_sessions = {}
spk_model = None
pool = None
args = None

# Model directory
MODEL_DIR = pathlib.Path(os.environ.get('VOSK_MODELS_DIR', '/app/vosk-server/models'))

def load_model(name: str) -> Model:
    """Load a model once, then reuse it across clients."""
    if name not in model_cache:
        model_path = MODEL_DIR / name
        if not model_path.exists():
            raise ValueError(f"Model '{name}' not found in {MODEL_DIR}")
        
        logger.info(f"[vosk] Loading model: {name}")
        model_cache[name] = Model(str(model_path))
        logger.info(f"[vosk] Model loaded: {name}")
    
    model_refcnt[name] += 1
    return model_cache[name]

async def load_model_async(name: str, loop, pool) -> Model:
    """Load model asynchronously with timeout."""
    if name not in model_cache:
        model_path = MODEL_DIR / name
        if not model_path.exists():
            raise ValueError(f"Model '{name}' not found")
        
        logger.info(f"[vosk] Loading model async: {name}")
        model_cache[name] = await asyncio.wait_for(
            loop.run_in_executor(pool, Model, str(model_path)),
            timeout=120.0
        )
        logger.info(f"[vosk] Model loaded: {name}")
    
    model_refcnt[name] += 1
    return model_cache[name]

def release_model(name: str):
    """Release model reference."""
    if name in model_refcnt:
        model_refcnt[name] -= 1

def get_available_models():
    """Get list of available models."""
    if not MODEL_DIR.exists():
        return []
    
    models = []
    for path in MODEL_DIR.iterdir():
        if path.is_dir() and ((path / 'am' / 'final.mdl').exists() or (path / 'conf' / 'model.conf').exists()):
            models.append(path.name)
    
    return sorted(models)

async def recognize_loop(websocket, path=None):
    """Main WebSocket handler."""
    global spk_model, args, pool, default_model_name, session_models
    
    loop = asyncio.get_running_loop()
    rec = None
    current_model_name = default_model_name
    
    session_id = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}:{id(websocket)}"
    logger.info(f'Connection: {session_id}')
    
    active_sessions[session_id] = {'start_time': time.time()}
    
    # Initialize recognizer
    if model_cache:
        available = list(model_cache.keys())
        selected = session_models.get(session_id) or next((m for m in ['vosk-model-small-en-us-0.15', 'vosk-model-en-us-0.22'] if m in available), available[0] if available else None)
        
        if selected:
            current_model_name = selected
            model = model_cache[selected]
            model_refcnt[selected] += 1
            rec = KaldiRecognizer(model, args.sample_rate)
            rec.SetWords(args.show_words)
            rec.SetMaxAlternatives(args.max_alternatives)
            if spk_model:
                rec.SetSpkModel(spk_model)

    try:
        async for raw in websocket:
            # Binary audio data
            if isinstance(raw, bytes):
                if rec:
                    if rec.AcceptWaveform(raw):
                        result = json.loads(rec.Result())
                        if result.get("text"):
                            await websocket.send(json.dumps({"type": "result", "text": result["text"]}))
                    else:
                        partial = json.loads(rec.PartialResult())
                        if partial.get("partial"):
                            await websocket.send(json.dumps({"type": "partial", "partial": partial["partial"]}))
                continue

            # JSON commands
            try:
                msg = json.loads(raw)
                msg_type = msg.get("type")

                if msg_type == "get_models":
                    await websocket.send(json.dumps({"type": "models", "models": get_available_models()}))

                elif msg_type == "get_current_model":
                    await websocket.send(json.dumps({"type": "current_model", "model": current_model_name or "none"}))

                elif msg_type == "get_server_status":
                    await websocket.send(json.dumps({
                        "type": "server_status",
                        "current_model": current_model_name or "none",
                        "loaded_models": list(model_cache.keys()),
                        "model_ref_counts": dict(model_refcnt),
                        "available_models": get_available_models(),
                        "active_connections": len(active_sessions)
                    }))

                elif msg_type == "select_model":
                    if current_model_name:
                        release_model(current_model_name)
                        rec = None

                    model_name = msg["model"]
                    try:
                        await websocket.send(json.dumps({"type": "model_loading", "model": model_name}))
                        model = await load_model_async(model_name, loop, pool)
                        current_model_name = model_name
                        session_models[session_id] = model_name
                        
                        rec = KaldiRecognizer(model, args.sample_rate)
                        rec.SetWords(args.show_words)
                        rec.SetMaxAlternatives(args.max_alternatives)
                        if spk_model:
                            rec.SetSpkModel(spk_model)

                        await websocket.send(json.dumps({"type": "model_loaded", "model": model_name}))
                    except Exception as e:
                        await websocket.send(json.dumps({"type": "error", "message": str(e)}))

                elif msg.get("eof") == 1 and rec:
                    final = json.loads(rec.FinalResult())
                    if final.get("text"):
                        await websocket.send(json.dumps({"type": "result", "text": final["text"]}))

                elif msg.get("reset") == 1 and rec:
                    rec.FinalResult()

            except json.JSONDecodeError:
                pass

    except websockets.exceptions.ConnectionClosed:
        logger.info(f"Connection closed: {session_id}")
    finally:
        if current_model_name:
            release_model(current_model_name)
        if session_id in active_sessions:
            del active_sessions[session_id]

async def start():
    """Start Vosk WebSocket server."""
    global spk_model, args, pool, default_model_name

    logging.basicConfig(level=logging.INFO)

    # Parse arguments
    args = type('', (), {})()
    args.interface = os.environ.get('VOSK_SERVER_INTERFACE', '0.0.0.0')
    args.port = int(os.environ.get('VOSK_SERVER_PORT', 2700))
    args.sample_rate = float(os.environ.get('VOSK_SAMPLE_RATE', 16000))
    args.max_alternatives = int(os.environ.get('VOSK_ALTERNATIVES', 0))
    args.show_words = bool(os.environ.get('VOSK_SHOW_WORDS', True))
    args.spk_model_path = os.environ.get('VOSK_SPK_MODEL_PATH')

    # Load speaker model if specified
    if args.spk_model_path:
        spk_model = SpkModel(args.spk_model_path)

    # Create thread pool
    pool = concurrent.futures.ThreadPoolExecutor((os.cpu_count() or 1))

    # Ensure models directory exists
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    # Auto-load default model
    available_models = get_available_models()
    if available_models:
        logger.info(f"Available models: {', '.join(available_models)}")
        
        default_model = next(
            (m for m in ['vosk-model-small-en-us-0.15', 'vosk-model-en-us-0.22'] if m in available_models),
            available_models[0]
        )
        
        try:
            logger.info(f"Auto-loading default model: {default_model}")
            load_model(default_model)
            default_model_name = default_model
            logger.info(f"Default model loaded: {default_model}")
        except Exception as e:
            logger.error(f"Failed to load default model: {e}")
    else:
        logger.warning(f"No models found in {MODEL_DIR}")

    logger.info(f"Starting Vosk server on {args.interface}:{args.port}")

    async with websockets.serve(
        recognize_loop,
        args.interface,
        args.port,
        max_size=2**23,
        ping_interval=30,
        ping_timeout=10,
        close_timeout=10
    ):
        await asyncio.Future()

if __name__ == '__main__':
    asyncio.run(start())
