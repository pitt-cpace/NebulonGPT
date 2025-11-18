#!/usr/bin/env python3
"""
NebulonGPT Backend REST API
FastAPI server for chat management, model management, and network info
Replaces Node.js server.js functionality
"""

import os
import sys
import json
import logging
import asyncio
import shutil
import platform
import subprocess
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import aiofiles

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
PORT = int(os.environ.get('REST_API_PORT', 3001))
DATA_DIR = Path(os.environ.get('DATA_DIR', '/app/data'))
CHATS_FILE = DATA_DIR / 'chats.json'

# Vosk models directory - detect environment
VOSK_MODELS_DIR = Path('/app/vosk-server/models') if Path('/app/vosk-server/models').exists() else Path.home() / '.nebulon-gpt' / 'vosk-models'

logger.info(f"Using data directory: {DATA_DIR}")
logger.info(f"Using Vosk models directory: {VOSK_MODELS_DIR}")

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
VOSK_MODELS_DIR.mkdir(parents=True, exist_ok=True)

# Initialize chats file if it doesn't exist
if not CHATS_FILE.exists():
    CHATS_FILE.write_text('[]')
    logger.info(f"Created empty chats file: {CHATS_FILE}")

# Initialize FastAPI app
app = FastAPI(
    title="NebulonGPT Backend API",
    description="REST API for chat management, model management, and system info",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# CHAT MANAGEMENT ENDPOINTS
# ============================================================================

@app.get("/api/chats")
async def get_chats():
    """Get all chats from the chats file"""
    try:
        async with aiofiles.open(CHATS_FILE, 'r') as f:
            content = await f.read()
            chats = json.loads(content)
        return chats
    except Exception as e:
        logger.error(f"Error reading chats file: {e}")
        raise HTTPException(status_code=500, detail="Failed to load chats")

@app.post("/api/chats/{chat_id}")
async def save_chat(chat_id: str, request: Request):
    """Save or update a specific chat by ID"""
    try:
        chat_data = await request.json()
        
        if not chat_id or not chat_data:
            raise HTTPException(status_code=400, detail="Chat ID and chat data are required")
        
        # Read existing chats
        try:
            async with aiofiles.open(CHATS_FILE, 'r') as f:
                content = await f.read()
                chats = json.loads(content)
        except:
            logger.info("No existing chats file, starting with empty array")
            chats = []
        
        # Find existing chat by ID
        existing_chat_index = -1
        for i, chat in enumerate(chats):
            if chat.get('id') == chat_id:
                existing_chat_index = i
                break
        
        if existing_chat_index >= 0:
            # Update existing chat
            chats[existing_chat_index] = {**chats[existing_chat_index], **chat_data, 'id': chat_id}
        else:
            # Add new chat
            chats.insert(0, {**chat_data, 'id': chat_id})
            logger.info(f"Added new chat: {chat_id}")
        
        # Save updated chats
        async with aiofiles.open(CHATS_FILE, 'w') as f:
            await f.write(json.dumps(chats, indent=2))
        
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving chat: {e}")
        raise HTTPException(status_code=500, detail="Failed to save chat")

@app.post("/api/chats")
async def save_all_chats(request: Request):
    """Legacy endpoint for backward compatibility - saves entire chats array"""
    try:
        body = await request.json()
        
        # Handle both simple array format and session-based format
        if isinstance(body, list):
            chats = body
        elif isinstance(body, dict):
            chats = body.get('chats', body)
        else:
            chats = body
        
        if not chats:
            raise HTTPException(status_code=400, detail="No chats data provided")
        
        async with aiofiles.open(CHATS_FILE, 'w') as f:
            await f.write(json.dumps(chats, indent=2))
        
        logger.info(f"Saved {len(chats)} chats to file (legacy endpoint)")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error writing chats: {e}")
        raise HTTPException(status_code=500, detail="Failed to save chats")

# ============================================================================
# VOSK MODEL MANAGEMENT ENDPOINTS
# ============================================================================

def get_directory_size(dir_path: Path) -> int:
    """Calculate total size of directory recursively"""
    total_size = 0
    try:
        for item in dir_path.rglob('*'):
            if item.is_file():
                total_size += item.stat().st_size
    except Exception as e:
        logger.error(f"Error calculating directory size for {dir_path}: {e}")
    return total_size

def is_vosk_model(dir_path: Path) -> bool:
    """Check if a directory is a valid Vosk model"""
    try:
        required_files = ['conf/model.conf', 'am/final.mdl', 'graph/HCLG.fst']
        alternative_files = ['ivector/final.ie', 'ivector/final.dubm', 'ivector/global_cmvn.stats']
        
        has_required = sum(1 for f in required_files if (dir_path / f).exists())
        has_alternative = sum(1 for f in alternative_files if (dir_path / f).exists())
        
        return has_required >= 2 or (has_required >= 1 and has_alternative >= 1)
    except:
        return False

@app.get("/api/vosk/models/all")
async def get_all_models():
    """Get all models (files and directories) from the models directory"""
    try:
        logger.info(f"Listing models from: {VOSK_MODELS_DIR}")
        
        if not VOSK_MODELS_DIR.exists():
            logger.info("Vosk models directory does not exist, creating it...")
            VOSK_MODELS_DIR.mkdir(parents=True, exist_ok=True)
            return {"models": []}
        
        models = []
        for item in VOSK_MODELS_DIR.iterdir():
            try:
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
            except Exception as e:
                logger.error(f"Error processing item {item}: {e}")
                continue
        
        # Sort models: Vosk models first, then ZIP files, then others
        priority = {'ready': 0, 'archived': 1, 'other': 2}
        models.sort(key=lambda m: (priority.get(m['status'], 3), m['name']))
        
        logger.info(f"Found {len(models)} models/files")
        return {"models": models}
    except Exception as e:
        logger.error(f"Error listing models: {e}")
        raise HTTPException(status_code=500, detail="Failed to list models")

@app.post("/api/vosk/models/upload")
async def upload_model(model: UploadFile = File(...)):
    """Upload a Vosk model ZIP file"""
    try:
        if not model.filename.endswith('.zip'):
            raise HTTPException(status_code=400, detail="Only ZIP files are supported")
        
        logger.info(f"Uploading model: {model.filename}")
        
        target_path = VOSK_MODELS_DIR / model.filename
        
        # Save uploaded file
        async with aiofiles.open(target_path, 'wb') as f:
            content = await model.read()
            await f.write(content)
        
        logger.info(f"Model uploaded successfully: {target_path}")
        
        # Auto-extract ZIP file after upload
        try:
            logger.info(f"Auto-extracting model: {model.filename}")
            import zipfile
            with zipfile.ZipFile(target_path, 'r') as zip_ref:
                zip_ref.extractall(VOSK_MODELS_DIR)
            logger.info(f"Model auto-extracted successfully: {model.filename}")
            
            return {
                "message": "Model uploaded and extracted successfully",
                "filename": model.filename,
                "extracted": True
            }
        except Exception as extract_error:
            logger.error(f"Error auto-extracting model: {extract_error}")
            return {
                "message": "Model uploaded successfully, but auto-extraction failed. You can extract manually.",
                "filename": model.filename,
                "extracted": False,
                "extractError": str(extract_error)
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading model: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload model")

@app.post("/api/vosk/models/{model_name}/extract")
async def extract_model(model_name: str):
    """Extract a Vosk model ZIP file"""
    try:
        zip_path = VOSK_MODELS_DIR / model_name
        
        logger.info(f"Extracting model: {model_name}")
        
        if not zip_path.exists():
            raise HTTPException(status_code=404, detail="Model file not found")
        
        if not model_name.endswith('.zip'):
            raise HTTPException(status_code=400, detail="File is not a ZIP archive")
        
        # Extract ZIP file
        import zipfile
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(VOSK_MODELS_DIR)
        
        logger.info(f"Model extracted successfully: {model_name}")
        return {"message": "Model extracted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error extracting model: {e}")
        raise HTTPException(status_code=500, detail="Failed to extract model")

@app.delete("/api/vosk/models/{model_name}")
async def delete_model(model_name: str):
    """Delete a Vosk model (file or directory)"""
    try:
        model_path = VOSK_MODELS_DIR / model_name
        
        logger.info(f"Deleting model: {model_name}")
        
        if not model_path.exists():
            raise HTTPException(status_code=404, detail="Model not found")
        
        if model_path.is_dir():
            shutil.rmtree(model_path)
        else:
            model_path.unlink()
        
        logger.info(f"Model deleted successfully: {model_name}")
        return {"message": "Model deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting model: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete model")

# ============================================================================
# NETWORK INFO ENDPOINT
# ============================================================================

def get_network_interfaces() -> Dict:
    """Get network interface information"""
    import socket
    import netifaces
    
    wifi_ips = []
    ethernet_ips = []
    https_port = int(os.environ.get('HTTPS_PORT', 3443))
    http_port = int(os.environ.get('PORT', 3001))
    
    try:
        # Get WiFi interface names (platform-specific)
        wifi_interfaces = set()
        
        if platform.system() == 'Darwin':  # macOS
            try:
                output = subprocess.check_output(['networksetup', '-listallhardwareports'], text=True)
                lines = output.split('\n')
                for i, line in enumerate(lines):
                    if 'Wi-Fi' in line or 'WiFi' in line or 'AirPort' in line:
                        if i + 1 < len(lines) and 'Device:' in lines[i + 1]:
                            device = lines[i + 1].split('Device:')[1].strip()
                            wifi_interfaces.add(device)
                            logger.info(f"🔍 Detected WiFi interface on macOS: {device}")
            except Exception as e:
                logger.warning(f"Could not run networksetup command: {e}")
        
        # Process all interfaces
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
                    
                    logger.info(f"📡 Processing interface: {interface} → {ip}")
                    
                    # Classify interface
                    if interface in wifi_interfaces:
                        logger.info(f"  Classified as WiFi (platform detection: {interface})")
                        wifi_ips.append(address)
                    elif any(pattern in interface_lower for pattern in ['wlan', 'wlp', 'wl', 'wifi', 'wi-fi', 'air', 'airport', 'wlx', 'wireless', 'wi_fi']):
                        logger.info(f"  Classified as WiFi (name pattern: {interface})")
                        wifi_ips.append(address)
                    elif 'awdl' in interface_lower:
                        logger.info(f"  Classified as WiFi (AWDL: {interface})")
                        wifi_ips.append(address)
                    elif 'bridge' in interface_lower:
                        logger.info(f"  Classified as WiFi (bridge: {interface})")
                        wifi_ips.append(address)
                    elif any(pattern in interface_lower for pattern in ['eth', 'enp', 'en', 'eno', 'ens', 'em', 'ethernet', 'lan', 'enx', 'usb']):
                        logger.info(f"  ℹClassified as Ethernet (name pattern: {interface})")
                        ethernet_ips.append(address)
                    else:
                        logger.info(f"  ℹClassified as Ethernet (fallback: {interface})")
                        ethernet_ips.append(address)
            except Exception as e:
                logger.error(f"Error processing interface {interface}: {e}")
                continue
        
        logger.info(f"WiFi/Hotspot addresses: {wifi_ips}")
        logger.info(f"Ethernet/Cable addresses: {ethernet_ips}")
        
    except Exception as e:
        logger.error(f"Error getting network interfaces: {e}")
    
    return {
        'wifiIPs': wifi_ips,
        'ethernetIPs': ethernet_ips,
        'networkIPs': wifi_ips + ethernet_ips,
        'httpsPort': https_port,
        'httpPort': http_port
    }

@app.get("/api/network-info")
async def get_network_info():
    """Get network addresses for WiFi and Ethernet interfaces"""
    try:
        return get_network_interfaces()
    except Exception as e:
        logger.error(f"Error getting network addresses: {e}")
        raise HTTPException(status_code=500, detail="Failed to get network addresses")

# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "rest-api",
        "port": PORT,
        "timestamp": datetime.now().isoformat()
    }

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    logger.info("=" * 80)
    logger.info("STARTING NEBULONGPT REST API SERVER")
    logger.info("=" * 80)
    logger.info(f"Port: {PORT}")
    logger.info(f"Data directory: {DATA_DIR}")
    logger.info(f"Vosk models directory: {VOSK_MODELS_DIR}")
    logger.info(f"Chats file: {CHATS_FILE}")
    logger.info("=" * 80)
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        log_level="info",
        access_log=True
    )
