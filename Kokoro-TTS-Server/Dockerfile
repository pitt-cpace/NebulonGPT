FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Set Hugging Face cache directory FIRST (before any downloads)
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers
ENV HF_DATASETS_CACHE=/app/.cache/huggingface/datasets
ENV HF_HUB_OFFLINE=0
RUN mkdir -p /app/.cache/huggingface

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Download spaCy English model explicitly (to avoid runtime download)
RUN python -m spacy download en_core_web_sm || echo "SpaCy model download failed, continuing..."

# Alternative spaCy model download (backup method)
RUN pip install https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl || echo "Alternative spaCy model download failed, continuing..."

# Create and run model pre-download script
COPY <<EOF /tmp/preload_models.py
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
hf_home = os.environ.get("HF_HOME")
print(f"HF_HOME: {hf_home}")

try:
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
    
    # List cache contents for verification
    for root, dirs, files in os.walk(cache_dir):
        level = root.replace(cache_dir, "").count(os.sep)
        indent = " " * 2 * level
        print(f"{indent}{os.path.basename(root)}/")
        subindent = " " * 2 * (level + 1)
        for file in files[:3]:  # Show first 3 files only
            print(f"{subindent}{file}")
        if len(files) > 3:
            print(f"{subindent}... and {len(files)-3} more files")
    
except Exception as e:
    print(f"⚠️ Model pre-download failed: {e}")
    import traceback
    traceback.print_exc()
    print("Models will be downloaded on first use")
EOF

RUN python /tmp/preload_models.py && rm /tmp/preload_models.py

# Copy the application code
COPY . .

# Create directory for models
RUN mkdir -p models

# Expose the port
EXPOSE 2701

# Set environment variables
ENV PYTHONPATH=/app
ENV KOKORO_SERVER_HOST=0.0.0.0
ENV KOKORO_SERVER_PORT=2701
ENV HF_HUB_OFFLINE=0

# Default command to run the browser-compatible TTS server
CMD ["python3", "websocket/browser_tts_server.py", "--host", "0.0.0.0", "--port", "2701"]
