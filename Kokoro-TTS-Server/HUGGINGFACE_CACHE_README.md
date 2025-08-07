# Hugging Face Cache Archive

This directory contains the pre-downloaded Kokoro TTS models split into multiple parts to comply with GitHub's 100MB file size limit.

## Files:
- `huggingface-cache.tar.gz.partaa` (90MB)
- `huggingface-cache.tar.gz.partab` (90MB)
- `huggingface-cache.tar.gz.partac` (90MB)
- `huggingface-cache.tar.gz.partad` (21MB)

## How to reassemble and extract:

### Step 1: Reassemble the archive
```bash
cd Kokoro-TTS-Server
cat huggingface-cache.tar.gz.part* > huggingface-cache.tar.gz
```

### Step 2: Extract the archive
```bash
tar -xzf huggingface-cache.tar.gz
```

### Step 3: Clean up (optional)
```bash
rm huggingface-cache.tar.gz huggingface-cache.tar.gz.part*
```

## What's included:
- Pre-downloaded Kokoro-82M model files
- Hugging Face transformers cache
- Voice model files (af_heart, am_adam, bf_emma, bm_george)

## Purpose:
These cached files allow Docker builds to work offline and significantly speed up container startup by avoiding model downloads at runtime.

## Note:
The `huggingface-cache/` directory is included in `.gitignore` to prevent accidentally committing large binary files to the repository.
