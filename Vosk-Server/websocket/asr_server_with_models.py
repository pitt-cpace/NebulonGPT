#!/usr/bin/env python3

import json
import os
import sys
import asyncio
import pathlib
import websockets
import concurrent.futures
import logging
from collections import defaultdict
from vosk import Model, SpkModel, KaldiRecognizer

# Global caches for model management
model_cache = {}  # maps name -> Model()
model_refcnt = defaultdict(int)  # name -> number of live clients
spk_model = None
pool = None
args = None

# Default model directory - can be overridden by environment variable
MODEL_DIR = pathlib.Path(os.environ.get('VOSK_MODELS_DIR', 'models'))

def load_model(name: str) -> Model:
    """Load a model once, then reuse it across clients."""
    if name not in model_cache:
        model_path = MODEL_DIR / name
        if not model_path.exists():
            raise ValueError(f"Model '{name}' not found in {MODEL_DIR}")
        
        logging.info(f"[vosk-hub] Loading model: {name}")
        try:
            model_cache[name] = Model(str(model_path))
            logging.info(f"[vosk-hub] Model loaded successfully: {name}")
        except Exception as e:
            logging.error(f"[vosk-hub] Failed to load model {name}: {e}")
            raise
    
    model_refcnt[name] += 1
    return model_cache[name]

async def load_model_async(name: str, loop, pool) -> Model:
    """Load a model asynchronously with timeout."""
    if name not in model_cache:
        model_path = MODEL_DIR / name
        if not model_path.exists():
            raise ValueError(f"Model '{name}' not found in {MODEL_DIR}")
        
        logging.info(f"[vosk-hub] Loading model asynchronously: {name}")
        try:
            # Run model loading in thread pool with timeout
            model_cache[name] = await asyncio.wait_for(
                loop.run_in_executor(pool, Model, str(model_path)),
                timeout=120.0  # 2 minute timeout for large models
            )
            logging.info(f"[vosk-hub] Model loaded successfully: {name}")
        except asyncio.TimeoutError:
            logging.error(f"[vosk-hub] Timeout loading model {name} (exceeded 2 minutes)")
            raise TimeoutError(f"Model '{name}' loading timed out")
        except Exception as e:
            logging.error(f"[vosk-hub] Failed to load model {name}: {e}")
            raise
    
    model_refcnt[name] += 1
    return model_cache[name]

def release_model(name: str) -> None:
    """Release a model reference and unload if no longer needed."""
    if name in model_refcnt:
        model_refcnt[name] -= 1
        if model_refcnt[name] <= 0:
            logging.info(f"[vosk-hub] Unloading model: {name}")
            model_cache.pop(name, None)  # Allow GC to free memory
            model_refcnt.pop(name, None)

def get_available_models():
    """Get list of available models in the models directory."""
    if not MODEL_DIR.exists():
        return []
    
    models = []
    for path in MODEL_DIR.iterdir():
        if path.is_dir():
            # Check if it looks like a valid Vosk model directory
            if (path / 'am' / 'final.mdl').exists() or (path / 'conf' / 'model.conf').exists():
                models.append(path.name)
    
    return sorted(models)

def process_chunk(rec, message):
    """Process audio chunk with the recognizer."""
    # Handle string messages (JSON commands)
    if isinstance(message, str):
        if message == '{"eof" : 1}':
            return rec.FinalResult(), True
        if message == '{"reset" : 1}':
            return rec.FinalResult(), False
        # For other string messages, try to parse as JSON
        try:
            msg = json.loads(message)
            if msg.get("eof") == 1:
                return rec.FinalResult(), True
            if msg.get("reset") == 1:
                return rec.FinalResult(), False
        except json.JSONDecodeError:
            pass
        return rec.PartialResult(), False
    
    # Handle binary audio data
    elif isinstance(message, bytes):
        if rec.AcceptWaveform(message):
            return rec.Result(), False
        else:
            return rec.PartialResult(), False
    
    # Fallback for unknown message types
    return rec.PartialResult(), False

async def recognize_loop(websocket, path=None):
    """Main WebSocket handler for each client connection."""
    global spk_model, args, pool
    
    loop = asyncio.get_running_loop()
    rec = None
    current_model_name = None
    phrase_list = None
    sample_rate = args.sample_rate
    show_words = args.show_words
    max_alternatives = args.max_alternatives

    logging.info('Connection from %s', websocket.remote_address)

    try:
        async for raw in websocket:
            # Handle binary audio data
            if isinstance(raw, bytes):
                if rec:
                    if rec.AcceptWaveform(raw):
                        # Final result
                        result = json.loads(rec.Result())
                        if result.get("text"):
                            await websocket.send(json.dumps({
                                "type": "result",
                                "text": result["text"]
                            }))
                    else:
                        # Partial result
                        partial_result = json.loads(rec.PartialResult())
                        if partial_result.get("partial"):
                            await websocket.send(json.dumps({
                                "type": "partial",
                                "partial": partial_result["partial"]
                            }))
                continue

            # Handle text messages (JSON commands)
            try:
                msg = json.loads(raw)
                msg_type = msg.get("type")

                # Handle model discovery
                if msg_type == "get_models":
                    models = get_available_models()
                    await websocket.send(json.dumps({
                        "type": "models",
                        "models": models
                    }))

                # Handle model selection
                elif msg_type == "select_model":
                    # Release previous model if any
                    if current_model_name:
                        release_model(current_model_name)
                        rec = None

                    # Load new model
                    model_name = msg["model"]
                    try:
                        # Send loading status to client
                        await websocket.send(json.dumps({
                            "type": "model_loading",
                            "model": model_name,
                            "message": f"Loading model '{model_name}'..."
                        }))
                        
                        # Load model asynchronously with timeout
                        model = await load_model_async(model_name, loop, pool)
                        current_model_name = model_name
                        
                        # Create new recognizer with the selected model
                        if phrase_list:
                            rec = KaldiRecognizer(model, sample_rate, json.dumps(phrase_list, ensure_ascii=False))
                        else:
                            rec = KaldiRecognizer(model, sample_rate)
                        
                        rec.SetWords(show_words)
                        rec.SetMaxAlternatives(max_alternatives)
                        if spk_model:
                            rec.SetSpkModel(spk_model)

                        # Broadcast to all clients that model is loaded
                        broadcast_msg = json.dumps({
                            "type": "model_loaded",
                            "model": model_name
                        })
                        
                        # Send to all connected clients
                        if hasattr(websocket, 'server') and hasattr(websocket.server, 'websockets'):
                            for client in websocket.server.websockets.copy():
                                try:
                                    await client.send(broadcast_msg)
                                except websockets.exceptions.ConnectionClosed:
                                    pass
                        else:
                            # Fallback: just send to current client
                            await websocket.send(broadcast_msg)

                    except asyncio.TimeoutError:
                        error_msg = f"Model '{model_name}' loading timed out (exceeded 2 minutes)"
                        logging.error(error_msg)
                        await websocket.send(json.dumps({
                            "type": "error",
                            "message": error_msg
                        }))
                    except Exception as e:
                        error_msg = f"Failed to load model '{model_name}': {str(e)}"
                        logging.error(error_msg)
                        await websocket.send(json.dumps({
                            "type": "error",
                            "message": error_msg
                        }))

                # Handle audio chunk as JSON (base64 encoded)
                elif msg_type == "audio_chunk":
                    if rec and "bytes" in msg:
                        import base64
                        audio_data = base64.b64decode(msg["bytes"])
                        response, stop = await loop.run_in_executor(pool, process_chunk, rec, audio_data)
                        await websocket.send(response)
                        if stop:
                            break

                # Handle legacy configuration (for backward compatibility)
                elif "config" in msg:
                    jobj = msg['config']
                    logging.info("Config %s", jobj)
                    if 'phrase_list' in jobj:
                        phrase_list = jobj['phrase_list']
                    if 'sample_rate' in jobj:
                        sample_rate = float(jobj['sample_rate'])
                    if 'words' in jobj:
                        show_words = bool(jobj['words'])
                    if 'max_alternatives' in jobj:
                        max_alternatives = int(jobj['max_alternatives'])

                # Handle EOF and reset signals
                elif msg.get("eof") == 1:
                    if rec:
                        # Send final result but don't break the connection
                        final_result = json.loads(rec.FinalResult())
                        if final_result.get("text"):
                            await websocket.send(json.dumps({
                                "type": "result",
                                "text": final_result["text"]
                            }))
                    # Don't break - keep connection alive
                    
                elif msg.get("reset") == 1:
                    if rec:
                        # Reset recognizer state but don't break connection
                        rec.FinalResult()  # Clear internal state
                    # Don't break - keep connection alive

                # Handle other legacy messages
                else:
                    if rec:
                        response, stop = await loop.run_in_executor(pool, process_chunk, rec, raw)
                        await websocket.send(response)
                        # Don't break on stop for EOF/reset - keep connection alive

            except json.JSONDecodeError:
                # Handle legacy binary messages
                if rec:
                    response, stop = await loop.run_in_executor(pool, process_chunk, rec, raw)
                    await websocket.send(response)
                    # Don't break on stop for EOF/reset - keep connection alive

    except websockets.exceptions.ConnectionClosed:
        logging.info("Client disconnected")
    except Exception as e:
        logging.error(f"Error in recognize_loop: {e}")
    finally:
        # Clean up: release model reference
        if current_model_name:
            release_model(current_model_name)

async def start():
    """Start the Vosk WebSocket server with multi-model support."""
    global spk_model, args, pool

    # Enable logging
    logging.basicConfig(level=logging.INFO)

    # Parse arguments and environment variables
    args = type('', (), {})()
    args.interface = os.environ.get('VOSK_SERVER_INTERFACE', '0.0.0.0')
    args.port = int(os.environ.get('VOSK_SERVER_PORT', 2700))
    args.spk_model_path = os.environ.get('VOSK_SPK_MODEL_PATH')
    args.sample_rate = float(os.environ.get('VOSK_SAMPLE_RATE', 16000))
    args.max_alternatives = int(os.environ.get('VOSK_ALTERNATIVES', 0))
    args.show_words = bool(os.environ.get('VOSK_SHOW_WORDS', True))

    # Override MODEL_DIR if provided as command line argument
    global MODEL_DIR
    if len(sys.argv) > 1:
        MODEL_DIR = pathlib.Path(sys.argv[1])

    # Load speaker model if specified
    spk_model = SpkModel(args.spk_model_path) if args.spk_model_path else None

    # Create thread pool for audio processing
    pool = concurrent.futures.ThreadPoolExecutor((os.cpu_count() or 1))

    # Check if models directory exists
    if not MODEL_DIR.exists():
        logging.warning(f"Models directory '{MODEL_DIR}' does not exist. Creating it...")
        MODEL_DIR.mkdir(parents=True, exist_ok=True)

    # List available models
    available_models = get_available_models()
    if available_models:
        logging.info(f"Available models: {', '.join(available_models)}")
    else:
        logging.warning(f"No models found in '{MODEL_DIR}'. Please add Vosk models to this directory.")

    logging.info(f"Starting Vosk WebSocket server on {args.interface}:{args.port}")
    logging.info(f"Models directory: {MODEL_DIR}")

    # Start the WebSocket server
    async with websockets.serve(
        recognize_loop, 
        args.interface, 
        args.port,
        max_size=2**23  # ~8 MB per frame
    ):
        await asyncio.Future()

if __name__ == '__main__':
    asyncio.run(start())
