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

# Copy pre-downloaded models from local cache (if available)
# Note: Models should be pre-cached in huggingface-cache/ directory
COPY huggingface-cache/ /app/.cache/huggingface/

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
