#!/usr/bin/env python3
import os
import sys

# Ensure cache directories exist
cache_dir = "/app/.cache/huggingface"
os.makedirs(cache_dir, exist_ok=True)
os.makedirs(f"{cache_dir}/transformers", exist_ok=True)
os.makedirs(f"{cache_dir}/hub", exist_ok=True)

# Set environment variables
os.environ["HF_HOME"] = cache_dir
os.environ["TRANSFORMERS_CACHE"] = f"{cache_dir}/transformers"
os.environ["HF_DATASETS_CACHE"] = f"{cache_dir}/datasets"
os.environ["HF_HUB_OFFLINE"] = "0"

print(f"Cache directory: {cache_dir}")

try:
    sys.path.append("/app/kokoro-tts")
    from kokoro import KPipeline
    print("Pre-downloading Kokoro TTS models...")
    
    # Initialize pipeline (this downloads the main model)
    pipeline = KPipeline(lang_code="a", device="cpu")
    print("✅ Main Kokoro model downloaded and cached")
    
    # Test with multiple voices to cache voice models
    test_voices = ["af_heart", "am_adam", "bf_emma", "bm_george"]
    for voice in test_voices:
        try:
            print(f"Testing voice: {voice}")
            gen = pipeline("Hello world", voice=voice, speed=1.0)
            audio_data = next(gen)  # Generate one sample to cache voice models
            print(f"✅ Voice {voice} cached successfully")
        except Exception as ve:
            print(f"⚠️ Voice {voice} failed: {ve}")
            continue
    
    print("✅ All Kokoro models cached successfully")
    
except Exception as e:
    print(f"⚠️ Model pre-download failed: {e}")
    import traceback
    traceback.print_exc()
    print("Models will be downloaded on first use")
