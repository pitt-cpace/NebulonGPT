#!/usr/bin/env python3

import asyncio
import websockets
import json
import base64
import logging
import re
import time
import uuid
from pathlib import Path
import sys
import os
from enum import Enum
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Any

# Import Kokoro TTS components
try:
    from kokoro import KPipeline, KModel
    import torch
    import soundfile as sf
    import io
except ImportError:
    print("Error: Could not import Kokoro TTS components.")
    print("Make sure Kokoro TTS is properly installed with: pip install kokoro-tts")
    sys.exit(1)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class QueueState(Enum):
    IDLE = "idle"
    PLAYING = "playing"
    PAUSED = "paused"
    STOPPED = "stopped"

class ItemState(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    PLAYING = "playing"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"

@dataclass
class QueueItem:
    id: str
    text: str
    voice: str
    speed: float
    language: str
    state: ItemState
    audio_data: Optional[bytes] = None
    created_at: float = 0
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    
    def __post_init__(self):
        if self.created_at == 0:
            self.created_at = time.time()

class TTSQueue:
    def __init__(self):
        self.items: List[QueueItem] = []
        self.state = QueueState.IDLE
        self.current_item: Optional[QueueItem] = None
        self.current_position = 0
        self.lock = asyncio.Lock()
    
    async def add_item(self, text: str, voice: str = "af_heart", speed: float = 1.0, language: str = "a") -> str:
        """Add item to queue and return its ID"""
        async with self.lock:
            item_id = str(uuid.uuid4())
            item = QueueItem(
                id=item_id,
                text=text,
                voice=voice,
                speed=speed,
                language=language,
                state=ItemState.PENDING
            )
            self.items.append(item)
            logger.info(f"Added item {item_id} to queue: '{text[:50]}...'")
            return item_id
    
    async def get_next_item(self) -> Optional[QueueItem]:
        """Get next pending item from queue"""
        async with self.lock:
            for item in self.items[self.current_position:]:
                if item.state == ItemState.PENDING:
                    return item
            return None
    
    async def pause(self):
        """Pause the queue"""
        async with self.lock:
            if self.state == QueueState.PLAYING:
                self.state = QueueState.PAUSED
                logger.info("Queue paused")
                return True
            return False
    
    async def resume(self):
        """Resume the queue"""
        async with self.lock:
            if self.state == QueueState.PAUSED:
                self.state = QueueState.PLAYING
                logger.info("Queue resumed")
                return True
            return False
    
    async def stop(self):
        """Stop the queue and clear all items"""
        async with self.lock:
            self.state = QueueState.STOPPED
            self.current_item = None
            self.current_position = 0
            # Mark all pending/processing items as cancelled
            for item in self.items:
                if item.state in [ItemState.PENDING, ItemState.PROCESSING]:
                    item.state = ItemState.CANCELLED
            logger.info("Queue stopped and cleared")
    
    async def skip_current(self):
        """Skip current item"""
        async with self.lock:
            if self.current_item:
                self.current_item.state = ItemState.SKIPPED
                self.current_item.completed_at = time.time()
                logger.info(f"Skipped item {self.current_item.id}")
                self.current_item = None
                return True
            return False
    
    async def skip_to_item(self, item_id: str):
        """Skip to specific item in queue"""
        async with self.lock:
            for i, item in enumerate(self.items):
                if item.id == item_id:
                    # Mark all items before this one as skipped
                    for j in range(self.current_position, i):
                        if self.items[j].state == ItemState.PENDING:
                            self.items[j].state = ItemState.SKIPPED
                    
                    self.current_position = i
                    if self.current_item:
                        self.current_item.state = ItemState.SKIPPED
                    self.current_item = None
                    logger.info(f"Skipped to item {item_id}")
                    return True
            return False
    
    async def remove_item(self, item_id: str):
        """Remove item from queue"""
        async with self.lock:
            for i, item in enumerate(self.items):
                if item.id == item_id:
                    if item.state == ItemState.PLAYING and item == self.current_item:
                        # Can't remove currently playing item
                        return False
                    item.state = ItemState.CANCELLED
                    logger.info(f"Removed item {item_id}")
                    return True
            return False
    
    async def get_status(self) -> Dict[str, Any]:
        """Get current queue status"""
        async with self.lock:
            def item_to_dict(item):
                """Convert QueueItem to dict with enum values"""
                item_dict = asdict(item)
                item_dict['state'] = item.state.value
                # Remove audio_data as it's not JSON serializable and not needed for status
                if 'audio_data' in item_dict:
                    del item_dict['audio_data']
                return item_dict
            
            return {
                "state": self.state.value,
                "total_items": len(self.items),
                "current_position": self.current_position,
                "current_item": item_to_dict(self.current_item) if self.current_item else None,
                "pending_items": len([i for i in self.items if i.state == ItemState.PENDING]),
                "completed_items": len([i for i in self.items if i.state == ItemState.COMPLETED]),
                "items": [item_to_dict(item) for item in self.items]
            }
    
    async def clear_completed(self):
        """Remove completed items from queue"""
        async with self.lock:
            original_count = len(self.items)
            self.items = [item for item in self.items if item.state not in [ItemState.COMPLETED, ItemState.SKIPPED, ItemState.CANCELLED]]
            removed_count = original_count - len(self.items)
            if removed_count > 0:
                self.current_position = max(0, self.current_position - removed_count)
                logger.info(f"Cleared {removed_count} completed items")

class QueueTTSServer:
    def __init__(self, host='localhost', port=2702, device='cpu', language='a'):
        self.host = host
        self.port = port
        self.device = device
        self.language = language
        self.pipeline = None
        self.queue = TTSQueue()
        self.clients: Dict[str, websockets.WebSocketServerProtocol] = {}
        self.processing_task = None
        
    async def initialize_pipeline(self):
        """Initialize Kokoro TTS pipeline"""
        try:
            loop = asyncio.get_event_loop()
            self.pipeline = await loop.run_in_executor(
                None, 
                lambda: KPipeline(lang_code=self.language, device=self.device)
            )
            logger.info(f"Kokoro pipeline initialized with language={self.language}, device={self.device}")
        except Exception as e:
            logger.error(f"Failed to initialize Kokoro pipeline: {str(e)}")
            raise
    
    async def start_processing_loop(self):
        """Start the queue processing loop"""
        self.processing_task = asyncio.create_task(self._process_queue())
    
    async def _process_queue(self):
        """Main queue processing loop"""
        while True:
            try:
                if self.queue.state == QueueState.PLAYING:
                    # Get next item to process
                    next_item = await self.queue.get_next_item()
                    
                    if next_item:
                        # Set as current item
                        async with self.queue.lock:
                            self.queue.current_item = next_item
                            next_item.state = ItemState.PROCESSING
                            next_item.started_at = time.time()
                        
                        # Generate audio
                        await self._process_item(next_item)
                        
                        # Play audio if still current and queue is playing
                        if (self.queue.current_item == next_item and 
                            self.queue.state == QueueState.PLAYING and
                            next_item.state == ItemState.READY):
                            
                            await self._play_item(next_item)
                        
                        # Mark as completed
                        async with self.queue.lock:
                            if next_item.state not in [ItemState.SKIPPED, ItemState.CANCELLED]:
                                next_item.state = ItemState.COMPLETED
                                next_item.completed_at = time.time()
                            
                            if self.queue.current_item == next_item:
                                self.queue.current_item = None
                                self.queue.current_position += 1
                        
                        # Broadcast status update
                        await self._broadcast_status()
                    
                    else:
                        # No more items, set to idle
                        async with self.queue.lock:
                            self.queue.state = QueueState.IDLE
                        await self._broadcast_status()
                
                await asyncio.sleep(0.1)  # Small delay to prevent busy waiting
                
            except Exception as e:
                logger.error(f"Error in processing loop: {str(e)}")
                await asyncio.sleep(1)
    
    async def _process_item(self, item: QueueItem):
        """Generate audio for queue item"""
        try:
            audio_data = await self.generate_audio(item.text, item.voice, item.speed, item.language)
            if audio_data:
                async with self.queue.lock:
                    item.audio_data = audio_data
                    item.state = ItemState.READY
                logger.info(f"Generated audio for item {item.id}")
            else:
                async with self.queue.lock:
                    item.state = ItemState.CANCELLED
                logger.error(f"Failed to generate audio for item {item.id}")
        except Exception as e:
            logger.error(f"Error processing item {item.id}: {str(e)}")
            async with self.queue.lock:
                item.state = ItemState.CANCELLED
    
    async def _play_item(self, item: QueueItem):
        """Send audio to all connected clients"""
        if not item.audio_data:
            return
        
        async with self.queue.lock:
            item.state = ItemState.PLAYING
        
        # Send audio to all clients
        audio_message = {
            "type": "audio_play",
            "item_id": item.id,
            "text": item.text,
            "voice": item.voice,
            "speed": item.speed,
            "audio_data": base64.b64encode(item.audio_data).decode('utf-8'),
            "audio_format": "wav",
            "sample_rate": 24000
        }
        
        await self._broadcast_message(audio_message)
        logger.info(f"Playing item {item.id}: '{item.text[:50]}...'")
    
    async def _broadcast_message(self, message: Dict[str, Any]):
        """Broadcast message to all connected clients"""
        if not self.clients:
            return
        
        message_str = json.dumps(message)
        disconnected_clients = []
        
        for client_id, websocket in self.clients.items():
            try:
                await websocket.send(message_str)
            except websockets.exceptions.ConnectionClosed:
                disconnected_clients.append(client_id)
            except Exception as e:
                logger.error(f"Error sending to client {client_id}: {str(e)}")
                disconnected_clients.append(client_id)
        
        # Remove disconnected clients
        for client_id in disconnected_clients:
            del self.clients[client_id]
    
    async def _broadcast_status(self):
        """Broadcast queue status to all clients"""
        status = await self.queue.get_status()
        await self._broadcast_message({
            "type": "queue_status",
            "status": status
        })
    
    async def handle_client(self, websocket, path=None):
        """Handle WebSocket client connections"""
        client_id = str(uuid.uuid4())
        client_address = websocket.remote_address
        logger.info(f"Queue TTS Connection from {client_address} (ID: {client_id})")
        
        # Add client
        self.clients[client_id] = websocket
        
        # Send initial status
        await websocket.send(json.dumps({
            "type": "connected",
            "client_id": client_id
        }))
        await self._broadcast_status()
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    response = await self.process_message(websocket, data)
                    if response:
                        await websocket.send(json.dumps(response))
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({
                        'error': 'Invalid JSON format'
                    }))
                except Exception as e:
                    logger.error(f"Error processing message: {str(e)}")
                    await websocket.send(json.dumps({
                        'error': f'Server error: {str(e)}'
                    }))
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client {client_address} disconnected")
        except Exception as e:
            logger.error(f"Connection error: {str(e)}")
        finally:
            # Remove client
            if client_id in self.clients:
                del self.clients[client_id]
    
    async def process_message(self, websocket, data):
        """Process incoming WebSocket messages"""
        
        # Add text to queue
        if data.get('action') == 'add':
            text = data.get('text', '')
            voice = data.get('voice', 'af_heart')
            speed = data.get('speed', 1.0)
            language = data.get('language', 'a')
            
            if not text:
                return {'error': 'No text provided'}
            
            item_id = await self.queue.add_item(text, voice, speed, language)
            
            # Start playing if queue was idle
            if self.queue.state == QueueState.IDLE:
                async with self.queue.lock:
                    self.queue.state = QueueState.PLAYING
            
            await self._broadcast_status()
            return {
                'success': True,
                'item_id': item_id,
                'message': 'Item added to queue'
            }
        
        # Play/Resume queue
        elif data.get('action') == 'play':
            success = await self.queue.resume()
            if not success and self.queue.state == QueueState.IDLE:
                async with self.queue.lock:
                    self.queue.state = QueueState.PLAYING
                success = True
            
            await self._broadcast_status()
            return {
                'success': success,
                'message': 'Queue playing' if success else 'Could not start playback'
            }
        
        # Pause queue
        elif data.get('action') == 'pause':
            success = await self.queue.pause()
            await self._broadcast_status()
            return {
                'success': success,
                'message': 'Queue paused' if success else 'Could not pause'
            }
        
        # Stop queue
        elif data.get('action') == 'stop':
            await self.queue.stop()
            await self._broadcast_status()
            return {
                'success': True,
                'message': 'Queue stopped'
            }
        
        # Skip current item
        elif data.get('action') == 'skip':
            success = await self.queue.skip_current()
            await self._broadcast_status()
            return {
                'success': success,
                'message': 'Item skipped' if success else 'No item to skip'
            }
        
        # Skip to specific item
        elif data.get('action') == 'skip_to':
            item_id = data.get('item_id')
            if not item_id:
                return {'error': 'No item_id provided'}
            
            success = await self.queue.skip_to_item(item_id)
            await self._broadcast_status()
            return {
                'success': success,
                'message': f'Skipped to item {item_id}' if success else 'Item not found'
            }
        
        # Remove item
        elif data.get('action') == 'remove':
            item_id = data.get('item_id')
            if not item_id:
                return {'error': 'No item_id provided'}
            
            success = await self.queue.remove_item(item_id)
            await self._broadcast_status()
            return {
                'success': success,
                'message': f'Item {item_id} removed' if success else 'Could not remove item'
            }
        
        # Get queue status
        elif data.get('action') == 'status':
            status = await self.queue.get_status()
            return {
                'success': True,
                'status': status
            }
        
        # Clear completed items
        elif data.get('action') == 'clear_completed':
            await self.queue.clear_completed()
            await self._broadcast_status()
            return {
                'success': True,
                'message': 'Completed items cleared'
            }
        
        else:
            return {'error': 'Unknown action'}
    
    async def generate_audio(self, text, voice, speed, language):
        """Generate audio using Kokoro pipeline"""
        try:
            if not self.pipeline:
                logger.error("Kokoro pipeline not initialized")
                return None
                
            # Use asyncio to run the synchronous Kokoro pipeline call
            loop = asyncio.get_event_loop()
            
            def _generate_audio():
                # Generate audio using Kokoro pipeline
                generator = self.pipeline(text, voice=voice, speed=speed)
                
                # Collect all audio segments
                audio_segments = []
                for i, (gs, ps, audio) in enumerate(generator):
                    audio_segments.append(audio)
                
                if not audio_segments:
                    return None
                    
                # Concatenate audio segments
                full_audio = torch.cat(audio_segments, dim=0) if len(audio_segments) > 1 else audio_segments[0]
                
                # Convert to bytes for transmission
                audio_buffer = io.BytesIO()
                sf.write(audio_buffer, full_audio.numpy(), 24000, format='WAV')
                return audio_buffer.getvalue()
            
            audio_data = await loop.run_in_executor(None, _generate_audio)
            return audio_data
            
        except Exception as e:
            logger.error(f"Kokoro pipeline error: {str(e)}")
            return None
    
    async def start_server(self):
        """Start the WebSocket server"""
        logger.info(f"Starting Queue TTS Server on {self.host}:{self.port}")
        
        # Start processing loop
        await self.start_processing_loop()
        
        server = await websockets.serve(
            self.handle_client,
            self.host,
            self.port,
            ping_interval=20,
            ping_timeout=10
        )
        
        logger.info(f"✅ Queue TTS Server running on ws://{self.host}:{self.port}")
        logger.info("🎵 Queue-based TTS with pause/resume/skip functionality")
        logger.info("📋 Commands: add, play, pause, stop, skip, skip_to, remove, status, clear_completed")
        
        return server

async def run_server():
    """Run the queue TTS server"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Queue-based Kokoro TTS Server with Pause/Resume/Skip")
    parser.add_argument('--host', default='localhost', help='Host to bind to')
    parser.add_argument('--port', type=int, default=2702, help='Port to bind to')
    parser.add_argument('--device', default='cpu', help='Device to use (cpu/cuda)')
    parser.add_argument('--language', default='a', help='Default language code')
    
    args = parser.parse_args()
    
    logger.info(f"Starting Queue TTS Server on {args.host}:{args.port}")
    logger.info(f"Device: {args.device}, Language: {args.language}")
    
    server = QueueTTSServer(args.host, args.port, args.device, args.language)
    
    try:
        # Initialize Kokoro pipeline
        await server.initialize_pipeline()
        
        # Start the server
        await server.start_server()
        
        # Keep running
        await asyncio.Future()  # Run forever
        
    except Exception as e:
        logger.error(f"❌ Server error: {str(e)}")
        raise

def main():
    try:
        asyncio.run(run_server())
    except KeyboardInterrupt:
        logger.info("🛑 Server stopped by user")
    except Exception as e:
        logger.error(f"❌ Failed to start server: {str(e)}")

if __name__ == "__main__":
    main()
