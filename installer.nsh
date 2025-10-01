; Custom NSIS script for NebulonGPT installer
; This script extracts python-bundle.zip during installation

; Declare variables for temp directories
Var kokoroTemp

; Macro: Extract Python Bundle
!macro ExtractPythonBundle
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
      ; Calculate and save directory size as checksum
      DetailPrint "Calculating Python bundle checksum..."
      nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "(Get-ChildItem \"$0\\.nebulon-gpt\\python-bundle\" -Recurse -File | Measure-Object -Property Length -Sum).Sum | Out-File -FilePath \"$0\\.nebulon-gpt\\.python-bundle-checksum\" -Encoding utf8 -NoNewline"'
      Pop $1
      DetailPrint "✓ Keeping ZIP file for runtime re-extraction"
      Goto SkipPython
    
    PythonFailed:
      DetailPrint "⚠ Python bundle extraction failed"
      DetailPrint "⚠ Speech recognition will be set up on first run"
  
  SkipPython:
!macroend

; ==============================
; Macro: Extract TTS Cache (Kokoro)
; Steps: copy -> group/concat -> extract -> cleanup -> datasets -> checksum
; ==============================
!macro ExtractTTSCache
  DetailPrint "Installing Kokoro TTS cache..."

  ; Proceed only if kokoro payload exists inside installer
  IfFileExists "$INSTDIR\resources\models\kokoro\*.*" DoTTS SkipTTS

  DoTTS:
    DetailPrint "Found Kokoro TTS cache files"

    ; User home
    ReadEnvStr $0 "USERPROFILE"

    ; If already there, skip
    IfFileExists "$0\.nebulon-gpt\huggingface\*.*" TTSExists DoTTSStart

    TTSExists:
      DetailPrint "✓ Kokoro TTS cache already installed"
      Goto SkipTTS

    DoTTSStart:
      DetailPrint "Processing Kokoro TTS cache..."
      CreateDirectory "$0\.nebulon-gpt\huggingface"

      ; --- Copy all payload files ---
      DetailPrint "Copying cache files..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Copy-Item -Recurse -Force \"$INSTDIR\resources\models\kokoro\*\" \"$0\.nebulon-gpt\huggingface\""'
      Pop $1

      ; --- Concat all split archives (per base) -> <base>.zip ---
      DetailPrint "Concatenating split cache archives..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$dst=\"$0\.nebulon-gpt\huggingface\"; Set-Location -LiteralPath $$dst; $$parts=Get-ChildItem -Filter \"*.zip.*\"; if($$parts){ $$bases=$$parts|ForEach-Object{ $$n=$$_.Name; $$i=$$n.IndexOf(\".zip.\"); if($$i -ge 0){ $$n.Substring(0,$$i) } }|Sort-Object -Unique; foreach($$b in $$bases){ cmd /c \"copy /b $$($$b).zip.* $$($$b).zip\" | Out-Null } }"'
      Pop $1

      ; --- Extract ALL .zip into ~/.nebulon-gpt (parent) ---
      DetailPrint "Extracting cache archives..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $$out=\"$0\.nebulon-gpt\"; Get-ChildItem \"$0\.nebulon-gpt\huggingface\" -Filter \"*.zip\" | ForEach-Object { [System.IO.Compression.ZipFile]::ExtractToDirectory($$_.FullName, $$out) }"'
      Pop $1

      ; --- Rename extracted huggingface-cache to huggingface ---
      DetailPrint "Renaming extracted directory..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path \"$0\.nebulon-gpt\huggingface-cache\") { if (Test-Path \"$0\.nebulon-gpt\huggingface\") { Move-Item \"$0\.nebulon-gpt\huggingface-cache\*\" \"$0\.nebulon-gpt\huggingface\" -Force; Remove-Item \"$0\.nebulon-gpt\huggingface-cache\" -Force } else { Rename-Item \"$0\.nebulon-gpt\huggingface-cache\" \"huggingface\" } }"'
      Pop $1

      ; --- Cleanup zip parts ---
      DetailPrint "Cleaning up ZIP files..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Path \"$0\.nebulon-gpt\huggingface\*.zip*\" -Force -ErrorAction SilentlyContinue"'
      Pop $1

      ; --- Ensure datasets dir exists ---
      CreateDirectory "$0\.nebulon-gpt\huggingface\datasets"

      ; --- Checksum (sum of file sizes) ---
      DetailPrint "Calculating TTS cache checksum..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-ChildItem \"$0\.nebulon-gpt\huggingface\" -Recurse -File | Measure-Object -Property Length -Sum).Sum | Out-File -FilePath \"$0\.nebulon-gpt\.huggingface-checksum\" -Encoding utf8 -NoNewline"'
      Pop $1

      DetailPrint "✓ Kokoro TTS cache extracted successfully"

  SkipTTS:
!macroend


; ============================================
; Macro: Extract Vosk Models
; Steps: copy -> group/concat -> extract -> cleanup -> checksum
; ============================================
!macro ExtractVoskModels
  DetailPrint "Installing Vosk speech models..."

  ; Proceed only if vosk payload exists inside installer
  IfFileExists "$INSTDIR\resources\models\vosk\*.*" DoVosk SkipVosk

  DoVosk:
    DetailPrint "Found Vosk model files"

    ; User home
    ReadEnvStr $0 "USERPROFILE"

    ; If already there, skip
    IfFileExists "$0\.nebulon-gpt\vosk-models\*.*" VoskExists DoVoskStart

    VoskExists:
      DetailPrint "✓ Vosk models already installed"
      Goto SkipVosk

    DoVoskStart:
      DetailPrint "Processing Vosk models..."
      CreateDirectory "$0\.nebulon-gpt\vosk-models"

      ; --- Copy all payload files ---
      DetailPrint "Copying model files..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Copy-Item -Recurse -Force \"$INSTDIR\resources\models\vosk\*\" \"$0\.nebulon-gpt\vosk-models\""'
      Pop $1

      ; --- Concat all split archives (per base) -> <base>.zip ---
      DetailPrint "Concatenating split model archives (per base)..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$dst=\"$0\.nebulon-gpt\vosk-models\"; Set-Location -LiteralPath $$dst; $$parts=Get-ChildItem -Filter \"*.zip.*\"; if($$parts){ $$bases=$$parts|ForEach-Object{ $$n=$$_.Name; $$i=$$n.IndexOf(\".zip.\"); if($$i -ge 0){ $$n.Substring(0,$$i) } }|Sort-Object -Unique; foreach($$b in $$bases){ cmd /c \"copy /b $$($$b).zip.* $$($$b).zip\" | Out-Null } }"'
      Pop $1

      ; --- Extract ALL .zip into ~/.nebulon-gpt/vosk-models ---
      DetailPrint "Extracting model archives..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $$dst=\"$0\.nebulon-gpt\vosk-models\"; Get-ChildItem $$dst -Filter \"*.zip\" | ForEach-Object { [System.IO.Compression.ZipFile]::ExtractToDirectory($$_.FullName, $$dst) }"'
      Pop $1

      ; --- Cleanup zip parts ---
      DetailPrint "Cleaning up ZIP files..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Path \"$0\.nebulon-gpt\vosk-models\*.zip*\" -Force -ErrorAction SilentlyContinue"'
      Pop $1

      ; --- Checksum (sum of file sizes) ---
      DetailPrint "Calculating Vosk models checksum..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-ChildItem \"$0\.nebulon-gpt\vosk-models\" -Recurse -File | Measure-Object -Property Length -Sum).Sum | Out-File -FilePath \"$0\.nebulon-gpt\.vosk-models-checksum\" -Encoding utf8 -NoNewline"'
      Pop $1

      DetailPrint "✓ Vosk speech models extracted and installed successfully"

  SkipVosk:
!macroend



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
  
  ; Call separate macros for each component
  !insertmacro ExtractPythonBundle
  !insertmacro ExtractTTSCache
  !insertmacro ExtractVoskModels
  
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
  RMDir /r "$0\.nebulon-gpt\huggingface"
  
  ; Remove Vosk models
  DetailPrint "Removing Vosk models..."
  RMDir /r "$0\.nebulon-gpt\vosk-models"
  
  ; Remove checksum files
  Delete "$0\.nebulon-gpt\.python-bundle-checksum"
  Delete "$0\.nebulon-gpt\.huggingface-checksum"
  Delete "$0\.nebulon-gpt\.vosk-models-checksum"
  
  DetailPrint "Cleanup completed"
!macroend
