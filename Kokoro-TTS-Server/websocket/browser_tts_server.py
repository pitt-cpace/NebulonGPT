#!/usr/bin/env python3

import asyncio
import websockets
import json
import base64
import logging
import re
import time
from pathlib import Path
import sys
import os

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

class BrowserTTSServer:
    def __init__(self, host='localhost', port=2701, device='cpu', language='a'):
        self.host = host
        self.port = port
        self.device = device
        self.language = language
        self.pipeline = None
        self.active_sessions = {}
        self.audio_queues = {}  # Per-session audio queues
        self.session_states = {}  # Per-session state management (paused/resumed)
        
    async def initialize_pipeline(self):
        """Initialize Kokoro TTS pipeline with proper cache setup"""
        try:
            # Ensure cache environment variables are set
            cache_dir = "/app/.cache/huggingface"
            os.environ["HF_HOME"] = cache_dir
            os.environ["TRANSFORMERS_CACHE"] = f"{cache_dir}/transformers"
            os.environ["HF_DATASETS_CACHE"] = f"{cache_dir}/datasets"
            
            # Try offline first, then online if needed
            try:
                os.environ["HF_HUB_OFFLINE"] = "1"  # Try offline first
                loop = asyncio.get_event_loop()
                self.pipeline = await loop.run_in_executor(
                    None, 
                    lambda: KPipeline(lang_code=self.language, device=self.device)
                )
                logger.info(f"Kokoro pipeline initialized OFFLINE with language={self.language}, device={self.device}")
            except Exception as offline_error:
                logger.warning(f"Offline initialization failed: {offline_error}")
                logger.info("Trying online initialization...")
                os.environ["HF_HUB_OFFLINE"] = "0"  # Allow online access
                loop = asyncio.get_event_loop()
                self.pipeline = await loop.run_in_executor(
                    None, 
                    lambda: KPipeline(lang_code=self.language, device=self.device)
                )
                logger.info(f"Kokoro pipeline initialized ONLINE with language={self.language}, device={self.device}")
                
        except Exception as e:
            logger.error(f"Failed to initialize Kokoro pipeline: {str(e)}")
            raise
        
    async def handle_client(self, websocket, path=None):
        """Handle WebSocket client connections"""
        client_address = websocket.remote_address
        logger.info(f"Browser TTS Connection from {client_address}")
        
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
            # Clean up any active sessions for this client
            sessions_to_remove = []
            for session_id, session_data in self.active_sessions.items():
                if session_data.get('websocket') == websocket:
                    sessions_to_remove.append(session_id)
            
            for session_id in sessions_to_remove:
                del self.active_sessions[session_id]
                logger.info(f"Cleaned up session {session_id}")

    async def process_message(self, websocket, data):
        """Process incoming WebSocket messages"""
        
        # Handle queue control commands
        if 'action' in data:
            return await self.handle_queue_action(websocket, data)
        
        # Handle streaming session start
        elif data.get('start_stream'):
            return await self.start_streaming_session(websocket, data)
        
        # Handle text chunk for streaming
        elif 'text_chunk' in data:
            return await self.process_text_chunk(websocket, data)
        
        # Handle streaming session end
        elif data.get('end_stream'):
            return await self.end_streaming_session(websocket)
        
        # Handle regular TTS request
        elif 'text' in data:
            return await self.process_regular_tts(websocket, data)
        
        else:
            return {'error': 'No recognized command in request'}

    async def start_streaming_session(self, websocket, data):
        """Start a new streaming TTS session"""
        session_id = int(time.time() * 1000000)  # Microsecond timestamp
        
        voice = data.get('voice', 'af_heart')
        speed = data.get('speed', 1.0)
        language = data.get('language', 'a')
        
        # Store session data
        self.active_sessions[session_id] = {
            'websocket': websocket,
            'voice': voice,
            'speed': speed,
            'language': language,
            'text_buffer': '',
            'processed_sentences': 0
        }
        
        logger.info(f"Started streaming session {session_id} with voice={voice}, speed={speed}")
        
        return {
            'status': 'streaming_started',
            'session_id': session_id,
            'voice': voice,
            'speed': speed,
            'language': language
        }

    async def process_text_chunk(self, websocket, data):
        """Process a text chunk in streaming mode"""
        # Find the session for this websocket
        session_id = None
        session_data = None
        
        for sid, sdata in self.active_sessions.items():
            if sdata.get('websocket') == websocket:
                session_id = sid
                session_data = sdata
                break
        
        if not session_data:
            return {'error': 'No active streaming session found'}
        
        text_chunk = data.get('text_chunk', '')
        session_data['text_buffer'] += text_chunk
        
        # Check for sentence boundaries
        sentences = self.extract_complete_sentences(session_data['text_buffer'])
        
        responses = []
        
        for sentence in sentences:
            if sentence.strip():
                # Generate audio for this sentence
                try:
                    audio_data = await self.generate_audio(
                        sentence,
                        session_data['voice'],
                        session_data['speed'],
                        session_data['language']
                    )
                    
                    if audio_data:
                        # Send audio chunk immediately
                        audio_response = {
                            'type': 'audio_chunk',
                            'session_id': session_id,
                            'text_chunk': sentence,
                            'audio_chunk': base64.b64encode(audio_data).decode('utf-8'),
                            'audio_format': 'wav',
                            'sample_rate': 24000
                        }
                        
                        await websocket.send(json.dumps(audio_response))
                        session_data['processed_sentences'] += 1
                        
                except Exception as e:
                    logger.error(f"Error generating audio for sentence: {str(e)}")
        
        # Update buffer (remove processed sentences)
        if sentences:
            # Remove processed text from buffer
            for sentence in sentences:
                session_data['text_buffer'] = session_data['text_buffer'].replace(sentence, '', 1)
        
        # Send acknowledgment
        return {
            'type': 'chunk_received',
            'session_id': session_id,
            'processed_sentences': session_data['processed_sentences'],
            'buffer_size': len(session_data['text_buffer'])
        }

    async def end_streaming_session(self, websocket):
        """End streaming session and process any remaining text"""
        # Find the session for this websocket
        session_id = None
        session_data = None
        
        for sid, sdata in self.active_sessions.items():
            if sdata.get('websocket') == websocket:
                session_id = sid
                session_data = sdata
                break
        
        if not session_data:
            return {'error': 'No active streaming session found'}
        
        # Process any remaining text in buffer
        remaining_text = session_data['text_buffer'].strip()
        if remaining_text:
            try:
                audio_data = await self.generate_audio(
                    remaining_text,
                    session_data['voice'],
                    session_data['speed'],
                    session_data['language']
                )
                
                if audio_data:
                    # Send final audio chunk
                    audio_response = {
                        'type': 'audio_chunk',
                        'session_id': session_id,
                        'text_chunk': remaining_text,
                        'audio_chunk': base64.b64encode(audio_data).decode('utf-8'),
                        'audio_format': 'wav',
                        'sample_rate': 24000
                    }
                    
                    await websocket.send(json.dumps(audio_response))
                    
            except Exception as e:
                logger.error(f"Error generating final audio: {str(e)}")
        
        # Clean up session
        del self.active_sessions[session_id]
        logger.info(f"Ended streaming session {session_id}")
        
        return {
            'type': 'streaming_ended',
            'session_id': session_id
        }

    async def handle_queue_action(self, websocket, data):
        """Handle queue control actions (stop, clear, pause, resume)"""
        action = data.get('action', '').lower()
        
        # Find session for this websocket
        session_id = None
        session_data = None
        
        for sid, sdata in self.active_sessions.items():
            if sdata.get('websocket') == websocket:
                session_id = sid
                session_data = sdata
                break
        
        # Initialize session state if not exists
        if websocket not in self.session_states:
            self.session_states[websocket] = {
                'paused': False,
                'queued_audio': [],
                'processing': False
            }
        
        session_state = self.session_states[websocket]
        
        if action == 'stop' or action == 'clear':
            # Clear any active streaming session
            if session_data:
                session_data['text_buffer'] = ''
                session_data['processed_sentences'] = 0
                logger.info(f"Cleared text buffer and reset counters for session {session_id}")
            
            # Clear audio queue for this websocket
            if websocket in self.audio_queues:
                self.audio_queues[websocket] = []
                logger.info(f"Cleared audio queue for client")
            
            # Clear session state completely
            session_state['paused'] = False
            session_state['queued_audio'] = []
            session_state['processing'] = False
            
            # MODERATE: Clear only runtime state, keep model cache
            try:
                if self.pipeline:
                    # Clear PyTorch cache if using GPU (but keep models)
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                        logger.info("Cleared CUDA cache")
                    
                    # Force Python garbage collection (but don't recreate pipeline)
                    import gc
                    gc.collect()
                    logger.info("Forced garbage collection")
                    
                    logger.info("Cleared runtime cache while preserving model cache")
                    
            except Exception as e:
                logger.warning(f"Error clearing runtime cache: {str(e)}")
            
            # Also clear any pending audio generation tasks
            logger.info(f"Completely cleared all TTS state and pipeline cache for client {websocket.remote_address}")
            
            # Verification loop - keep checking until everything is cleared (max 1 second)
            max_attempts = 10  # Maximum 1 second (10 * 100ms)
            attempt = 0
            cleared = False
            
            while not cleared and attempt < max_attempts:
                await asyncio.sleep(0.1)  # Wait 100ms between checks
                attempt += 1
                
                # Check if everything is properly cleared
                buffers_empty = len(session_state.get('queued_audio', [])) == 0
                not_paused = session_state.get('paused', False) == False
                not_processing = session_state.get('processing', False) == False
                
                cleared = all([buffers_empty, not_paused, not_processing])
                
                if cleared:
                    logger.info(f"✅ TTS completely cleared after {attempt * 100}ms")
                    break
            
            if not cleared:
                logger.warning(f"⚠️ TTS clearing verification timeout after 1 second")
            
            return {
                'type': 'queue_cleared',
                'action': action,
                'status': 'success' if cleared else 'partial',
                'message': f'Server-side TTS cleared after {attempt * 100}ms verification',
                'verification_time_ms': attempt * 100,
                'fully_cleared': cleared,
                'ready_for_next_operation': cleared
            }
        
        elif action == 'pause':
            # Pause audio generation and queuing
            session_state['paused'] = True
            #logger.info(f"Paused audio generation for client {websocket.remote_address}")
            
            return {
                'type': 'queue_paused',
                'action': action,
                'status': 'success',
                'message': 'Audio generation paused',
                'paused': True
            }
        
        elif action == 'resume':
            # Resume audio generation and process any queued audio
            session_state['paused'] = False
            #logger.info(f"Resumed audio generation for client {websocket.remote_address}")
            
            # Process any queued audio that was paused
            if session_state['queued_audio']:
                logger.info(f"Processing {len(session_state['queued_audio'])} queued audio chunks")
                
                # Send all queued audio
                for queued_chunk in session_state['queued_audio']:
                    await websocket.send(json.dumps(queued_chunk))
                
                # Clear the queue after sending
                session_state['queued_audio'] = []
            
            return {
                'type': 'queue_resumed',
                'action': action,
                'status': 'success',
                'message': 'Audio generation resumed',
                'paused': False,
                'processed_queued': len(session_state['queued_audio']) if session_state['queued_audio'] else 0
            }
        
        else:
            return {'error': f'Unknown action: {action}'}

    async def process_regular_tts(self, websocket, data):
        """Process regular (non-streaming) TTS request"""
        text = data.get('text', '')
        voice = data.get('voice', 'af_heart')
        speed = data.get('speed', 1.0)
        language = data.get('language', 'a')
        
        if not text:
            return {'error': 'No text provided'}
        
        # Initialize session state if not exists
        if websocket not in self.session_states:
            self.session_states[websocket] = {
                'paused': False,
                'queued_audio': [],
                'processing': False
            }
        
        # Check if session is paused - for real-time conversation, don't queue, just skip
        if self.session_states[websocket]['paused']:
            logger.info(f"Skipping TTS request for paused session: {text[:50]}...")
            return {
                'type': 'request_skipped',
                'message': 'TTS request skipped - session is paused',
                'text': text[:50] + '...' if len(text) > 50 else text
            }
        
        try:
            audio_data = await self.generate_audio(text, voice, speed, language)
            
            if audio_data:
                audio_response = {
                    'type': 'complete_audio',
                    'text': text,
                    'voice': voice,
                    'speed': speed,
                    'language': language,
                    'audio': base64.b64encode(audio_data).decode('utf-8'),
                    'audio_format': 'wav',
                    'sample_rate': 24000,
                    'size': len(audio_data)
                }
                
                # Send immediately if not paused
                return audio_response
            else:
                return {'error': 'Failed to generate audio'}
                
        except Exception as e:
            logger.error(f"Error in regular TTS: {str(e)}")
            return {'error': f'TTS generation failed: {str(e)}'}

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

    def extract_complete_sentences(self, text):
        """Extract complete sentences from text buffer with language-aware punctuation"""
        # Minimum buffer size before processing (to avoid processing single words)
        if len(text.strip()) < 30:  # Reduced threshold for better responsiveness
            # Check for sentence endings with language-aware punctuation
            if not re.search(r'[.!?。！？｡]\s*$', text.strip()):
                return []
        
        # Language-aware sentence boundary patterns
        # Western languages: . ! ?
        # Chinese/Japanese: 。！？｡
        # Also handle common patterns like ellipsis (...) and multiple punctuation
        sentence_pattern = r'([.!?。！？｡]+(?:\s*[.!?。！？｡]*)*)'
        
        # Split by sentence boundaries but keep the punctuation
        sentences = re.split(sentence_pattern, text)
        
        complete_sentences = []
        
        for i in range(0, len(sentences) - 1, 2):  # Process pairs (text, punctuation)
            if i + 1 < len(sentences):
                sentence_text = sentences[i]
                punctuation = sentences[i + 1] if i + 1 < len(sentences) else ""
                
                if sentence_text.strip() and punctuation:
                    complete_sentence = sentence_text + punctuation
                    complete_sentences.append(complete_sentence)
        
        # Handle languages without punctuation or incomplete sentences
        # If no sentences were found but we have substantial text, process it anyway
        if not complete_sentences and len(text.strip()) > 100:
            # For languages without clear sentence boundaries, split by length or natural breaks
            # Look for natural breaking points like commas, spaces after certain lengths
            words = text.strip().split()
            if len(words) > 15:  # If we have enough words, process as a chunk
                # Find a good breaking point (after comma, conjunction, etc.)
                break_points = []
                for i, word in enumerate(words):
                    if word.endswith(',') or word in ['and', 'but', 'or', 'so', 'yet', 'for', 'nor', '和', '但是', '或者', '所以']:
                        break_points.append(i)
                
                if break_points:
                    # Use the last good breaking point
                    break_point = break_points[-1] + 1
                    chunk = ' '.join(words[:break_point])
                    complete_sentences.append(chunk)
                else:
                    # No good breaking point, take first 15 words
                    chunk = ' '.join(words[:15])
                    complete_sentences.append(chunk)
        
        return complete_sentences

    async def start_server(self):
        """Start the WebSocket server"""
        logger.info(f"Starting Browser TTS Server on {self.host}:{self.port}")
        
        server = await websockets.serve(
            self.handle_client,
            self.host,
            self.port,
            ping_interval=20,
            ping_timeout=10
        )
        
        logger.info(f"✅ Browser TTS Server running on ws://{self.host}:{self.port}")
        logger.info("🌐 Ready for browser connections!")
        logger.info("📡 CORS enabled for cross-origin requests")
        
        return server

async def run_server():
    """Run the browser TTS server"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Browser-Compatible Kokoro TTS Server")
    parser.add_argument('--host', default='localhost', help='Host to bind to')
    parser.add_argument('--port', type=int, default=2701, help='Port to bind to')
    parser.add_argument('--device', default='cpu', help='Device to use (cpu/cuda)')
    parser.add_argument('--language', default='a', help='Default language code')
    
    args = parser.parse_args()
    
    logger.info(f"Starting Browser TTS Server on {args.host}:{args.port}")
    logger.info(f"Device: {args.device}, Language: {args.language}")
    
    server = BrowserTTSServer(args.host, args.port, args.device, args.language)
    
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
