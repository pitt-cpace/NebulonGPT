FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code
COPY . .

# Create directory for models (if needed)
RUN mkdir -p models

# Expose the port
EXPOSE 2701

# Set environment variables
ENV PYTHONPATH=/app
ENV KOKORO_SERVER_HOST=0.0.0.0
ENV KOKORO_SERVER_PORT=2701

# Default command to run the basic TTS server
CMD ["python3", "websocket/tts_server.py"]
