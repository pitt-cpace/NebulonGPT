#!/usr/bin/env python3

import json
import os
import sys
import asyncio
import pathlib
import websockets
import concurrent.futures
import logging
import torch
import soundfile as sf
import io
import base64
from kokoro import KPipeline, KModel

def process_tts_request(pipeline, message_data):
    """Process TTS request and return audio data"""
    try:
        text = message_data.get('text', '')
        voice = message_data.get('voice', 'af_heart')  # default female voice
        speed = message_data.get('speed', 1.0)
        language = message_data.get('language', 'a')  # default American English
        
        if not text:
            return {'error': 'No text provided'}, True
            
        # Generate audio
        generator = pipeline(text, voice=voice, speed=speed)
        
        # Collect all audio segments
        audio_segments = []
        for i, (gs, ps, audio) in enumerate(generator):
            audio_segments.append(audio)
        
        if not audio_segments:
            return {'error': 'No audio generated'}, True
            
        # Concatenate audio segments
        full_audio = torch.cat(audio_segments, dim=0) if len(audio_segments) > 1 else audio_segments[0]
        
        # Convert to bytes for transmission
        audio_buffer = io.BytesIO()
        sf.write(audio_buffer, full_audio.numpy(), 24000, format='WAV')
        audio_bytes = audio_buffer.getvalue()
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
        
        return {
            'audio': audio_base64,
            'sample_rate': 24000,
            'format': 'wav',
            'text': text,
            'voice': voice,
            'speed': speed,
            'language': language
        }, False
        
    except Exception as e:
        logging.error(f"TTS processing error: {str(e)}")
        return {'error': f'TTS processing failed: {str(e)}'}, True

def process_streaming_chunk(pipeline, text_chunk, voice, speed, language):
    """Process a single text chunk for streaming TTS"""
    try:
        if not text_chunk.strip():
            return None
            
        # Generate audio for this chunk
        generator = pipeline(text_chunk, voice=voice, speed=speed)
        
        # Collect audio segments for this chunk
        audio_segments = []
        for i, (gs, ps, audio) in enumerate(generator):
            audio_segments.append(audio)
        
        if not audio_segments:
            return None
            
        # Concatenate audio segments
        chunk_audio = torch.cat(audio_segments, dim=0) if len(audio_segments) > 1 else audio_segments[0]
        
        # Convert to bytes for transmission
        audio_buffer = io.BytesIO()
        sf.write(audio_buffer, chunk_audio.numpy(), 24000, format='WAV')
        audio_bytes = audio_buffer.getvalue()
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
        
        return {
            'audio_chunk': audio_base64,
            'sample_rate': 24000,
            'format': 'wav',
            'text_chunk': text_chunk,
            'voice': voice,
            'speed': speed,
            'language': language
        }
        
    except Exception as e:
        logging.error(f"Streaming TTS processing error: {str(e)}")
        return {'error': f'Streaming TTS processing failed: {str(e)}'}

async def handle_tts(websocket, path=None):
    global pipeline
    global args
    global pool
    
    loop = asyncio.get_running_loop()
    current_language = args.default_language
    current_pipeline = pipeline
    
    # Streaming session state
    streaming_session = {
        'active': False,
        'voice': 'af_heart',
        'speed': 1.0,
        'language': current_language,
        'buffer': '',
        'sentence_delimiters': ['.', '!', '?', '\n'],
        'chunk_size': 50  # minimum characters before processing
    }
    
    logging.info('TTS Connection from %s', websocket.remote_address)
    
    while True:
        try:
            message = await websocket.recv()
            
            # Handle configuration messages
            if isinstance(message, str):
                try:
                    message_data = json.loads(message)
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({'error': 'Invalid JSON format'}))
                    continue
                
                # Handle configuration updates
                if 'config' in message_data:
                    config = message_data['config']
                    logging.info("Config update: %s", config)
                    
                    # Update language if specified
                    if 'language' in config:
                        new_language = config['language']
                        if new_language != current_language:
                            current_language = new_language
                            # Reinitialize pipeline with new language
                            current_pipeline = KPipeline(lang_code=current_language, device=args.device)
                            logging.info(f"Switched to language: {current_language}")
                            streaming_session['language'] = current_language
                    
                    await websocket.send(json.dumps({'status': 'config_updated', 'language': current_language}))
                    continue
                
                # Handle streaming session start
                if 'start_stream' in message_data:
                    streaming_session['active'] = True
                    streaming_session['voice'] = message_data.get('voice', 'af_heart')
                    streaming_session['speed'] = message_data.get('speed', 1.0)
                    streaming_session['language'] = message_data.get('language', current_language)
                    streaming_session['buffer'] = ''
                    
                    await websocket.send(json.dumps({
                        'status': 'streaming_started',
                        'session_id': id(streaming_session),
                        'voice': streaming_session['voice'],
                        'speed': streaming_session['speed'],
                        'language': streaming_session['language']
                    }))
                    continue
                
                # Handle streaming text chunk
                if 'text_chunk' in message_data and streaming_session['active']:
                    text_chunk = message_data['text_chunk']
                    streaming_session['buffer'] += text_chunk
                    
                    # Process buffer when we have enough text or hit a sentence delimiter
                    sentences_to_process = []
                    remaining_buffer = streaming_session['buffer']
                    
                    # Split by sentence delimiters
                    for delimiter in streaming_session['sentence_delimiters']:
                        if delimiter in remaining_buffer:
                            parts = remaining_buffer.split(delimiter)
                            # Process all complete sentences
                            for i in range(len(parts) - 1):
                                if parts[i].strip():
                                    sentences_to_process.append(parts[i].strip() + delimiter)
                            # Keep the last part as remaining buffer
                            remaining_buffer = parts[-1]
                    
                    # If no sentence delimiters but buffer is large enough, process it
                    if not sentences_to_process and len(remaining_buffer) >= streaming_session['chunk_size']:
                        # Find a good break point (space, comma, etc.)
                        break_point = -1
                        for i in range(streaming_session['chunk_size'], len(remaining_buffer)):
                            if remaining_buffer[i] in [' ', ',', ';', ':']:
                                break_point = i + 1
                                break
                        
                        if break_point > 0:
                            sentences_to_process.append(remaining_buffer[:break_point])
                            remaining_buffer = remaining_buffer[break_point:]
                    
                    # Update buffer
                    streaming_session['buffer'] = remaining_buffer
                    
                    # Process sentences
                    for sentence in sentences_to_process:
                        if sentence.strip():
                            request_pipeline = current_pipeline
                            if streaming_session['language'] != current_language:
                                request_pipeline = KPipeline(lang_code=streaming_session['language'], device=args.device)
                            
                            chunk_response = await loop.run_in_executor(
                                pool, 
                                process_streaming_chunk, 
                                request_pipeline, 
                                sentence, 
                                streaming_session['voice'], 
                                streaming_session['speed'], 
                                streaming_session['language']
                            )
                            
                            if chunk_response:
                                chunk_response['type'] = 'audio_chunk'
                                chunk_response['session_id'] = id(streaming_session)
                                await websocket.send(json.dumps(chunk_response))
                    
                    # Send acknowledgment
                    await websocket.send(json.dumps({
                        'type': 'chunk_received',
                        'session_id': id(streaming_session),
                        'buffer_size': len(streaming_session['buffer']),
                        'processed_sentences': len(sentences_to_process)
                    }))
                    continue
                
                # Handle streaming session end
                if 'end_stream' in message_data and streaming_session['active']:
                    # Process any remaining buffer
                    if streaming_session['buffer'].strip():
                        request_pipeline = current_pipeline
                        if streaming_session['language'] != current_language:
                            request_pipeline = KPipeline(lang_code=streaming_session['language'], device=args.device)
                        
                        final_response = await loop.run_in_executor(
                            pool, 
                            process_streaming_chunk, 
                            request_pipeline, 
                            streaming_session['buffer'], 
                            streaming_session['voice'], 
                            streaming_session['speed'], 
                            streaming_session['language']
                        )
                        
                        if final_response:
                            final_response['type'] = 'audio_chunk'
                            final_response['session_id'] = id(streaming_session)
                            final_response['final'] = True
                            await websocket.send(json.dumps(final_response))
                    
                    # Reset streaming session
                    streaming_session['active'] = False
                    streaming_session['buffer'] = ''
                    
                    await websocket.send(json.dumps({
                        'type': 'streaming_ended',
                        'session_id': id(streaming_session)
                    }))
                    continue
                
                # Handle regular TTS request (non-streaming)
                if 'text' in message_data:
                    # Set language for this request if specified
                    request_language = message_data.get('language', current_language)
                    request_pipeline = current_pipeline
                    
                    if request_language != current_language:
                        request_pipeline = KPipeline(lang_code=request_language, device=args.device)
                    
                    response, stop = await loop.run_in_executor(pool, process_tts_request, request_pipeline, message_data)
                    response['type'] = 'complete_audio'
                    await websocket.send(json.dumps(response))
                    
                    if stop:
                        break
                else:
                    await websocket.send(json.dumps({'error': 'No recognized command in request'}))
            else:
                await websocket.send(json.dumps({'error': 'Expected JSON string message'}))
                
        except websockets.exceptions.ConnectionClosed:
            logging.info("Client disconnected")
            break
        except Exception as e:
            logging.error(f"Error handling message: {str(e)}")
            await websocket.send(json.dumps({'error': f'Server error: {str(e)}'}))

async def start():
    global pipeline
    global args
    global pool
    
    # Enable logging
    logging.basicConfig(level=logging.INFO)
    
    args = type('', (), {})()
    
    # Server configuration
    args.interface = os.environ.get('KOKORO_SERVER_INTERFACE', '0.0.0.0')
    args.port = int(os.environ.get('KOKORO_SERVER_PORT', 2701))
    args.device = os.environ.get('KOKORO_DEVICE', 'cpu')
    args.default_language = os.environ.get('KOKORO_DEFAULT_LANGUAGE', 'a')  # American English
    
    # Override with command line arguments if provided
    if len(sys.argv) > 1:
        args.default_language = sys.argv[1]
    
    logging.info(f"Starting Kokoro TTS Server on {args.interface}:{args.port}")
    logging.info(f"Default language: {args.default_language}")
    logging.info(f"Device: {args.device}")
    
    try:
        # Initialize pipeline
        pipeline = KPipeline(lang_code=args.default_language, device=args.device)
        logging.info("Kokoro pipeline initialized successfully")
        
        # Create thread pool for TTS processing
        pool = concurrent.futures.ThreadPoolExecutor((os.cpu_count() or 1))
        
        # Start WebSocket server
        async with websockets.serve(handle_tts, args.interface, args.port):
            logging.info(f"Kokoro TTS Server started successfully on ws://{args.interface}:{args.port}")
            await asyncio.Future()  # Run forever
            
    except Exception as e:
        logging.error(f"Failed to start server: {str(e)}")
        sys.exit(1)

if __name__ == '__main__':
    asyncio.run(start())
