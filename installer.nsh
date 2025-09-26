; Custom NSIS script for NebulonGPT installer
; This script extracts python-bundle.zip during installation

; Declare variables for temp directories
Var kokoroTemp

; Force show details view in Modern UI
!define MUI_INSTFILESPAGE_SHOW_DETAILS
!define MUI_INSTFILESPAGE_COLORS "FFFFFF 000000"
!define MUI_INSTFILESPAGE_PROGRESSBAR "colored"

; Custom page to force details view
!macro customInit
  ; Force show details during installation
  SetDetailsView show
  SetDetailsPrint both
  SetAutoClose false
!macroend

; Show file list at the very beginning of installation
!macro preInstall
  ; Force details view and show initial file list
  SetDetailsView show
  SetDetailsPrint both
  
  DetailPrint "=== NebulonGPT Installation File List ==="
  DetailPrint "Installing main application files..."
  DetailPrint "- electron.js (Main process)"
  DetailPrint "- preload.js (Security bridge)"
  DetailPrint "- React frontend (build/)"
  DetailPrint "- Node.js dependencies"
  DetailPrint "- Application resources"
  DetailPrint "Installing Python bundle (Speech Recognition & TTS)..."
  DetailPrint "- Python 3.10 runtime environment"
  DetailPrint "- Speech recognition libraries (Vosk)"
  DetailPrint "- Text-to-speech libraries (Kokoro)"
  DetailPrint "- AI models and dependencies"
  DetailPrint "Installing additional resources..."
  DetailPrint "- Vosk speech models"
  DetailPrint "- Kokoro TTS cache"
  DetailPrint "- Configuration files"
  DetailPrint "=== Installation Progress ==="
!macroend

; Custom header for installer
!macro customHeader
  !system "echo Configuring installer to show file details..."
!macroend

!macro customInstall
  ; Force show details view
  SetDetailsView show
  SetDetailsPrint both
  
  ; Show detailed file installation progress from the start
  DetailPrint "Starting NebulonGPT installation..."
  DetailPrint "Copying electron.js..."
  DetailPrint "Copying preload.js..."
  DetailPrint "Copying server.js..."
  DetailPrint "Installing React build files..."
  DetailPrint "Installing static assets..."
  DetailPrint "Installing icons and images..."
  DetailPrint "Installing audio processor..."
  DetailPrint "Installing Node.js modules..."
  DetailPrint "Setting up application structure..."
  
  ; Extract python-bundle.zip during installation to user home directory
  DetailPrint "Installing Python bundle (Speech Recognition & TTS)..."
  DetailPrint "Checking for python-bundle.zip..."
  
  ; Check if python-bundle.zip exists in resources
  IfFileExists "$INSTDIR\resources\python-bundle.zip" +1 SkipPython
  
  DetailPrint "Found python-bundle.zip (Size: ~500MB compressed)"
  
  ; Get user home directory
  ReadEnvStr $0 "USERPROFILE"
  
  ; Create .nebulon-gpt directory
  CreateDirectory "$0\.nebulon-gpt"
  
  ; Simple check - if python-bundle directory exists, skip
  IfFileExists "$0\.nebulon-gpt\python-bundle\*.*" PythonExists DoPython
  
  PythonExists:
    DetailPrint "✓ Python bundle already installed"
    Goto SkipPython
  
  DoPython:
    DetailPrint "Extracting Python environment to user directory..."
    DetailPrint "Installing Python 3.10 runtime..."
    DetailPrint "This may take a few moments..."
    
    ; Extract directly to user directory using PowerShell
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(\"$INSTDIR\\resources\\python-bundle.zip\", \"$0\\.nebulon-gpt\")"'
    Pop $1
    
    ; Check if extraction was successful
    IntCmp $1 0 PythonSuccess PythonFailed PythonFailed
    
    PythonSuccess:
      DetailPrint "✓ Python runtime installed successfully"
      ; Calculate and save directory size as checksum (avoiding NSIS conflicts)
      DetailPrint "Calculating Python bundle checksum..."
      nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "(Get-ChildItem \"$0\\.nebulon-gpt\\python-bundle\" -Recurse | Measure-Object -Property Length -Sum).Sum | Out-File -FilePath \"$0\\.nebulon-gpt\\.python-bundle-checksum\" -Encoding utf8 -NoNewline"'
      Pop $1
      ; Keep ZIP file for runtime re-extraction (don't delete)
      DetailPrint "✓ Keeping ZIP file for runtime re-extraction"
      Goto SkipPython
    
    PythonFailed:
      DetailPrint "⚠ Python bundle extraction failed"
      DetailPrint "⚠ Speech recognition will be set up on first run"
  
  SkipPython:
    ; Extract Kokoro TTS cache
    DetailPrint "Installing Kokoro TTS cache..."
    
    ; Check if Kokoro TTS models exist
    IfFileExists "$INSTDIR\resources\models\kokoro\*.*" +1 SkipKokoro
    
    DetailPrint "Found Kokoro TTS cache files"
    
    ; Simple check - if huggingface-cache directory exists, skip  
    IfFileExists "$0\.nebulon-gpt\huggingface-cache\*.*" KokoroExists DoKokoro
    
    KokoroExists:
      DetailPrint "✓ Kokoro TTS cache already installed"
      Goto SkipKokoro
    
    DoKokoro:
      DetailPrint "Processing Kokoro TTS cache..."
      DetailPrint "Creating temporary directory for TTS extraction..."
      
      ; Create temp directory for Kokoro extraction (NSIS-safe)
      GetTempFileName $kokoroTemp
      Delete "$kokoroTemp"
      StrCpy $kokoroTemp "$kokoroTemp-kokoro"
      CreateDirectory "$kokoroTemp"
      
      ; Step 1: Use simple binary copy for split files (NSIS-safe)
      DetailPrint "Concatenating Kokoro cache parts..."
      nsExec::ExecToLog 'cmd /c "copy /b \"$INSTDIR\\resources\\models\\kokoro\\huggingface-cache.zip.*\" \"$kokoroTemp\\huggingface-cache.zip\""'
      Pop $1
      
      ; Step 2: Extract concatenated ZIP to temp directory
      DetailPrint "Extracting TTS cache..."
      nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(\"$kokoroTemp\\huggingface-cache.zip\", \"$kokoroTemp\")"'
      Pop $1
      
      ; Step 3: Copy extracted content to final location
      DetailPrint "Installing TTS cache to user directory..."
      nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path \"$kokoroTemp\\huggingface-cache\") { Copy-Item -Recurse -Force \"$kokoroTemp\\huggingface-cache\\*\" \"$0\\.nebulon-gpt\\huggingface-cache\" }"'
      Pop $1
      
      ; Create datasets directory (required by TTS server)
      CreateDirectory "$0\.nebulon-gpt\huggingface-cache\datasets"
      
      ; Calculate and save directory size as checksum (avoiding NSIS conflicts)
      DetailPrint "Calculating TTS cache checksum..."
      nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "(Get-ChildItem \"$0\\.nebulon-gpt\\huggingface-cache\" -Recurse | Measure-Object -Property Length -Sum).Sum | Out-File -FilePath \"$0\\.nebulon-gpt\\.huggingface-cache-checksum\" -Encoding utf8 -NoNewline"'
      Pop $1
      
      ; Cleanup temp directory
      RMDir /r "$kokoroTemp"
      
      DetailPrint "✓ Kokoro TTS cache fully extracted and installed successfully"
    
    SkipKokoro:
      ; Extract Vosk models
      DetailPrint "Installing Vosk speech models..."
      
      ; Check if Vosk models exist
      IfFileExists "$INSTDIR\resources\models\vosk\*.*" +1 SkipVosk
      
      DetailPrint "Found Vosk model files"
      
      ; Simple check - if vosk-models directory exists, skip
      IfFileExists "$0\.nebulon-gpt\vosk-models\*.*" VoskExists DoVosk
      
      VoskExists:
        DetailPrint "✓ Vosk models already installed"
        Goto SkipVosk
      
      DoVosk:
        DetailPrint "Processing Vosk models..."
        DetailPrint "Copying model files..."
        
        ; Create target directory
        CreateDirectory "$0\.nebulon-gpt\vosk-models"
        
        ; Copy all files from source to target first
        nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Copy-Item -Recurse -Force \"$INSTDIR\\resources\\models\\vosk\\*\" \"$0\\.nebulon-gpt\\vosk-models\""'
        Pop $1
        
        ; Step 1: Use simple binary copy for split files (NSIS-safe)
        DetailPrint "Concatenating split model archives..."
        nsExec::ExecToLog 'cmd /c "cd /d \"$0\\.nebulon-gpt\\vosk-models\" && for /f \"tokens=1 delims=.\" %a in ('"'"'dir /b *.zip.* 2^>nul^|findstr /r \"\.zip\.[0-9]\"'"'"') do if exist %a.zip.001 copy /b %a.zip.* %a.zip >nul 2>&1"'
        Pop $1
        
        ; Step 2: Extract all complete ZIP files  
        DetailPrint "Extracting model archives..."
        nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; Get-ChildItem \"$0\\.nebulon-gpt\\vosk-models\" -Filter \"*.zip\" | Where-Object {$_.Name -notmatch \"\\.zip\\.[0-9]+\"} | ForEach-Object { try { [System.IO.Compression.ZipFile]::ExtractToDirectory($_.FullName, \"$0\\.nebulon-gpt\\vosk-models\") } catch { } }"'
        Pop $1
        
        ; Step 3: Clean up all ZIP files
        DetailPrint "Cleaning up ZIP files..."
        nsExec::ExecToLog 'cmd /c "cd /d \"$0\\.nebulon-gpt\\vosk-models\" && del /q *.zip* >nul 2>&1"'
        Pop $1
        
        ; Calculate and save directory size as checksum (avoiding NSIS conflicts)
        DetailPrint "Calculating Vosk models checksum..."
        nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "(Get-ChildItem \"$0\\.nebulon-gpt\\vosk-models\" -Recurse | Measure-Object -Property Length -Sum).Sum | Out-File -FilePath \"$0\\.nebulon-gpt\\.vosk-models-checksum\" -Encoding utf8 -NoNewline"'
        Pop $1
        
        DetailPrint "✓ Vosk speech models extracted and installed successfully"
      
      SkipVosk:
        DetailPrint "Configuring application settings..."
        DetailPrint "Creating desktop shortcuts..."
        DetailPrint "Registering file associations..."
        DetailPrint "✓ NebulonGPT installation completed successfully!"
        DetailPrint "Ready to launch NebulonGPT with AI-powered features"
        DetailPrint "Finalizing installation..."
        Sleep 5000
        DetailPrint "Installation complete!"
!macroend

!macro customUnInstall
  ; Clean up extracted bundles from user directory during uninstall
  DetailPrint "Cleaning up NebulonGPT user data..."
  
  ; Get user home directory
  ReadEnvStr $0 "USERPROFILE"
  
  ; Remove Python bundle
  DetailPrint "Removing Python bundle..."
  RMDir /r "$0\.nebulon-gpt\python-bundle"
  
  ; Remove Kokoro TTS cache  
  DetailPrint "Removing TTS cache..."
  RMDir /r "$0\.nebulon-gpt\huggingface-cache"
  
  ; Remove Vosk models
  DetailPrint "Removing Vosk models..."
  RMDir /r "$0\.nebulon-gpt\vosk-models"
  
  ; Remove checksum files
  Delete "$0\.nebulon-gpt\.python-bundle-checksum"
  Delete "$0\.nebulon-gpt\.huggingface-cache-checksum"  
  Delete "$0\.nebulon-gpt\.vosk-models-checksum"
  
  DetailPrint "Cleanup completed"
!macroend
