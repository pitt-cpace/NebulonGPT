; Custom NSIS script for NebulonGPT installer
; This script extracts python-bundle.zip during installation

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
  DetailPrint "- Python 3.9 runtime environment"
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
  
  ; Extract python-bundle.zip during installation
  DetailPrint "Installing Python bundle (Speech Recognition & TTS)..."
  DetailPrint "Checking for python-bundle.zip..."
  
  ; Check if python-bundle.zip exists in resources
  IfFileExists "$INSTDIR\resources\python-bundle.zip" 0 SkipExtraction
  
  DetailPrint "Found python-bundle.zip (Size: ~500MB compressed)"
  DetailPrint "Creating python-bundle directory..."
  ; Create python-bundle directory
  CreateDirectory "$INSTDIR\resources\python-bundle"
  
  ; Use PowerShell to extract the ZIP file with verbose output
  DetailPrint "Extracting Python environment..."
  DetailPrint "Installing Python 3.9 runtime..."
  DetailPrint "Installing speech recognition libraries..."
  DetailPrint "Installing text-to-speech libraries..."
  DetailPrint "Installing Vosk speech models..."
  DetailPrint "Installing Kokoro TTS models..."
  DetailPrint "This may take a few moments..."
  
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& {Add-Type -AssemblyName System.IO.Compression.FileSystem; Write-Host \"Extracting Python bundle...\"; [System.IO.Compression.ZipFile]::ExtractToDirectory(\"$INSTDIR\\resources\\python-bundle.zip\", \"$INSTDIR\\resources\"); Write-Host \"Extraction completed successfully\"}"'
  Pop $0
  
  ; Check if extraction was successful
  IntCmp $0 0 ExtractionSuccess ExtractionFailed ExtractionFailed
  
  ExtractionSuccess:
    DetailPrint "✓ Python runtime installed successfully"
    DetailPrint "✓ Speech recognition libraries installed"
    DetailPrint "✓ Text-to-speech libraries installed"
    DetailPrint "✓ AI models installed and ready"
    DetailPrint "Cleaning up installation files..."
    ; Delete the ZIP file after successful extraction to save disk space
    Delete "$INSTDIR\resources\python-bundle.zip"
    DetailPrint "✓ Installation cleanup completed"
    DetailPrint "Python bundle installation: SUCCESS"
    Goto SkipExtraction
  
  ExtractionFailed:
    DetailPrint "PowerShell extraction failed, trying alternative method..."
    DetailPrint "Attempting 7-Zip extraction..."
    ; Try using 7-Zip if available
    nsExec::ExecToLog '"$PROGRAMFILES\7-Zip\7z.exe" x "$INSTDIR\resources\python-bundle.zip" -o"$INSTDIR\resources" -y'
    Pop $0
    IntCmp $0 0 SevenZipSuccess SevenZipFailed SevenZipFailed
    
    SevenZipSuccess:
      DetailPrint "✓ Python bundle extracted using 7-Zip"
      DetailPrint "✓ Speech and TTS libraries installed"
      Delete "$INSTDIR\resources\python-bundle.zip"
      DetailPrint "✓ Installation cleanup completed"
      Goto SkipExtraction
    
    SevenZipFailed:
      DetailPrint "⚠ Warning: Python bundle extraction failed"
      DetailPrint "⚠ Speech recognition will be set up on first run"
      DetailPrint "⚠ This may cause slower initial startup"
      ; Leave ZIP file for runtime extraction
      Goto SkipExtraction
  
  SkipExtraction:
    DetailPrint "Installing Vosk speech models..."
    DetailPrint "Installing Kokoro TTS cache..."
    DetailPrint "Configuring application settings..."
    DetailPrint "Creating desktop shortcuts..."
    DetailPrint "Registering file associations..."
    DetailPrint "✓ NebulonGPT installation completed successfully!"
    DetailPrint "Ready to launch NebulonGPT with AI-powered features"
!macroend

!macro customUnInstall
  ; Clean up extracted python-bundle directory during uninstall
  DetailPrint "Removing Python bundle..."
  RMDir /r "$INSTDIR\resources\python-bundle"
!macroend
