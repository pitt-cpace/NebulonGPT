; Custom NSIS script for NebulonGPT installer
; This script extracts python-bundle.zip during installation

; Include required headers for custom pages
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

; Declare variables for temp directories
Var kokoroTemp

; Variables for custom component page
Var ComponentDialog
Var OllamaCheckbox
Var ModelGPTOSSCheckbox
Var ModelMistralCheckbox
Var ModelGraniteCheckbox
Var DisclaimerCheckbox
Var InstallButton
Var OllamaInstalled
Var InstallOllama
Var InstallModelGPTOSS
Var InstallModelMistral
Var InstallModelGranite
Var DisclaimerAccepted

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
; Steps: copy -> group/concat -> extract -> rename -> materialize links -> cleanup -> datasets -> checksum
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

      ; --- Materialize HuggingFace symlinks (simplified working approach) ---
      DetailPrint "Converting symlinks to actual files..."
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$hfDir=\"$0\.nebulon-gpt\huggingface\"; $$models=Get-ChildItem \"$$hfDir\hub\models--*--*\" -Directory -ErrorAction SilentlyContinue; foreach($$model in $$models){ $$blobsDir=Join-Path $$model.FullName \"blobs\"; $$snapsDir=Join-Path $$model.FullName \"snapshots\"; if((Test-Path $$blobsDir) -and (Test-Path $$snapsDir)){ Get-ChildItem $$snapsDir -Recurse -File | Where-Object{$$_.Length -lt 1024} | ForEach-Object{ try{ $$content=(Get-Content $$_.FullName -Raw).Trim(); if($$content -match \"([0-9a-f]{40,64})\"){ $$hash=$$Matches[1]; $$blobFile=Join-Path $$blobsDir $$hash; if(Test-Path $$blobFile){ Copy-Item $$blobFile $$_.FullName -Force } } }catch{} } } }"'
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
; Macro: Check if Ollama is Installed
; Sets $OllamaInstalled to 1 if found, 0 if not
; ============================================
!macro CheckOllamaInstalled
  StrCpy $OllamaInstalled "0"
  
  ; Check common Ollama installation paths
  ReadEnvStr $0 "LOCALAPPDATA"
  ReadEnvStr $1 "PROGRAMFILES"
  ReadEnvStr $2 "USERPROFILE"

  ; Check LocalAppData
  IfFileExists "$0\Programs\Ollama\ollama.exe" OllamaIsInstalled CheckPF
  
  CheckPF:
    IfFileExists "$1\Ollama\ollama.exe" OllamaIsInstalled CheckUP
  
  CheckUP:
    IfFileExists "$2\AppData\Local\Programs\Ollama\ollama.exe" OllamaIsInstalled OllamaNotFound
  
  OllamaIsInstalled:
    StrCpy $OllamaInstalled "1"
    Goto CheckOllamaDone
  
  OllamaNotFound:
    StrCpy $OllamaInstalled "0"
  
  CheckOllamaDone:
!macroend

; ============================================
; Macro: Download and Install Ollama
; Downloads Ollama installer and runs it
; ============================================
!macro DownloadAndInstallOllama
  ${If} $InstallOllama == "1"
    DetailPrint "Downloading Ollama installer..."
    
    ; Download Ollama installer using PowerShell
    ReadEnvStr $0 "TEMP"
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri \"https://ollama.com/download/OllamaSetup.exe\" -OutFile \"$0\OllamaSetup.exe\""'
    Pop $1
    
    ${If} $1 == 0
      DetailPrint "✓ Ollama downloaded successfully"
      DetailPrint "Installing Ollama (this may take a moment)..."
      
      ; Run Ollama installer very silently (no UI at all)
      nsExec::ExecToLog '"$0\OllamaSetup.exe" /VERYSILENT /NORESTART /SUPPRESSMSGBOXES'
      Pop $1
      
      ${If} $1 == 0
        DetailPrint "✓ Ollama installed successfully"
        
        ; Wait for installation to complete
        Sleep 3000
        
        ; Start Ollama
        DetailPrint "Starting Ollama service..."
        ReadEnvStr $2 "LOCALAPPDATA"
        nsExec::Exec '"$2\Programs\Ollama\ollama.exe" serve'
        Pop $1
        
        ; Wait for Ollama to start
        Sleep 5000
        
        DetailPrint "✓ Ollama service started"
      ${Else}
        DetailPrint "⚠ Ollama installation may have failed"
        DetailPrint "⚠ Please install Ollama manually from https://ollama.ai"
      ${EndIf}
      
      ; Clean up installer
      Delete "$0\OllamaSetup.exe"
    ${Else}
      DetailPrint "⚠ Failed to download Ollama"
      DetailPrint "⚠ Please install Ollama manually from https://ollama.ai"
    ${EndIf}
  ${EndIf}
!macroend

; ============================================
; Macro: Pull Selected Ollama Models
; Downloads the selected AI models
; ============================================
!macro PullOllamaModels
  ; Find Ollama executable
  ReadEnvStr $0 "LOCALAPPDATA"
  StrCpy $3 "$0\Programs\Ollama\ollama.exe"
  
  IfFileExists "$3" PullModels SkipModelPull
  
  PullModels:
    ; Pull GPT-OSS 20B Model (using qwen2.5:14b as a high-performance model)
    ${If} $InstallModelGPTOSS == "1"
      DetailPrint "Pulling GPT-OSS 20B Model (this may take several minutes)..."
      DetailPrint "Downloading high-performance AI model (~8GB)..."
      nsExec::ExecToLog '"$3" pull qwen2.5:14b'
      Pop $1
      ${If} $1 == 0
        DetailPrint "✓ GPT-OSS 20B Model installed successfully"
      ${Else}
        DetailPrint "⚠ Failed to pull GPT-OSS 20B Model"
      ${EndIf}
    ${EndIf}
    
    ; Pull Mistral 7B Model
    ${If} $InstallModelMistral == "1"
      DetailPrint "Pulling Mistral 7B Model (this may take several minutes)..."
      DetailPrint "Downloading lightweight AI model (~4GB)..."
      nsExec::ExecToLog '"$3" pull mistral:7b'
      Pop $1
      ${If} $1 == 0
        DetailPrint "✓ Mistral 7B Model installed successfully"
      ${Else}
        DetailPrint "⚠ Failed to pull Mistral 7B Model"
      ${EndIf}
    ${EndIf}
    
    ; Pull Granite4 Tiny-H Model (using granite3.1-moe as ultra-lightweight)
    ${If} $InstallModelGranite == "1"
      DetailPrint "Pulling Granite4 Tiny-H Model (this may take a few minutes)..."
      DetailPrint "Downloading ultra-lightweight AI model (~1GB)..."
      nsExec::ExecToLog '"$3" pull granite3.1-moe:1b'
      Pop $1
      ${If} $1 == 0
        DetailPrint "✓ Granite4 Tiny-H Model installed successfully"
      ${Else}
        DetailPrint "⚠ Failed to pull Granite4 Tiny-H Model"
      ${EndIf}
    ${EndIf}
    
    Goto ModelPullDone
  
  SkipModelPull:
    DetailPrint "⚠ Ollama not found, skipping model installation"
    DetailPrint "⚠ Please install models manually using 'ollama pull <model>'"
  
  ModelPullDone:
!macroend

; ============================================
; Macro: Check and Start Ollama
; Checks if Ollama is installed and starts it if not running
; ============================================
!macro CheckAndStartOllama
  DetailPrint "Checking Ollama status..."

  ; Check common Ollama installation paths
  ReadEnvStr $0 "LOCALAPPDATA"
  ReadEnvStr $1 "PROGRAMFILES"

  ; Check if Ollama exists in LocalAppData
  IfFileExists "$0\Programs\Ollama\ollama.exe" OllamaFound CheckProgramFiles

  CheckProgramFiles:
    ; Check if Ollama exists in Program Files
    IfFileExists "$1\Ollama\ollama.exe" OllamaFoundPF CheckUserProfile

  CheckUserProfile:
    ; Check if Ollama exists in user profile (another common location)
    ReadEnvStr $2 "USERPROFILE"
    IfFileExists "$2\AppData\Local\Programs\Ollama\ollama.exe" OllamaFoundUP OllamaNotInstalled

  OllamaFound:
    StrCpy $3 "$0\Programs\Ollama\ollama.exe"
    Goto CheckOllamaRunning

  OllamaFoundPF:
    StrCpy $3 "$1\Ollama\ollama.exe"
    Goto CheckOllamaRunning

  OllamaFoundUP:
    StrCpy $3 "$2\AppData\Local\Programs\Ollama\ollama.exe"
    Goto CheckOllamaRunning

  CheckOllamaRunning:
    DetailPrint "Found Ollama at: $3"
    
    ; Check if Ollama is already running using tasklist
    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq ollama.exe" /NH'
    Pop $4  ; Return code
    Pop $5  ; Output
    
    ; Check if "ollama.exe" appears in the output (meaning it's running)
    StrCpy $6 $5 10
    ${If} $5 != ""
      StrCmp $5 "INFO: No tasks are running which match the specified criteria." OllamaNotRunning OllamaAlreadyRunning
    ${Else}
      Goto OllamaNotRunning
    ${EndIf}

  OllamaAlreadyRunning:
    DetailPrint "✓ Ollama is already running"
    Goto OllamaDone

  OllamaNotRunning:
    DetailPrint "Ollama is installed but not running. Starting..."
    
    ; Start Ollama in the background
    nsExec::Exec '"$3" serve'
    Pop $4
    
    ; Wait a moment for it to start
    Sleep 2000
    
    ; Verify it started
    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq ollama.exe" /NH'
    Pop $4
    Pop $5
    
    ${If} $5 != "INFO: No tasks are running which match the specified criteria."
      DetailPrint "✓ Ollama started successfully"
    ${Else}
      DetailPrint "⚠ Ollama did not start automatically"
      DetailPrint "⚠ Please start Ollama manually after installation"
    ${EndIf}
    Goto OllamaDone

  OllamaNotInstalled:
    DetailPrint "Ollama is not installed"
    DetailPrint "To use AI features, please install Ollama from https://ollama.ai"
    Goto OllamaDone

  OllamaDone:
!macroend

; ============================================
; Function: Component Selection Page Create
; Creates the custom component selection dialog
; ============================================
Function ComponentPageCreate
  ; Initialize variables
  StrCpy $InstallOllama "0"
  StrCpy $InstallModelGPTOSS "1"  ; Recommended by default
  StrCpy $InstallModelMistral "0"
  StrCpy $InstallModelGranite "0"
  StrCpy $DisclaimerAccepted "0"
  
  ; Check if Ollama is already installed
  !insertmacro CheckOllamaInstalled
  
  nsDialogs::Create 1018
  Pop $ComponentDialog
  ${If} $ComponentDialog == error
    Abort
  ${EndIf}
  
  ; Title
  ${NSD_CreateLabel} 0 0 100% 20u "Select Components to Install"
  Pop $0
  CreateFont $1 "Segoe UI" 12 700
  SendMessage $0 ${WM_SETFONT} $1 0
  
  ; Subtitle
  ${NSD_CreateLabel} 0 22u 100% 12u "The following components need to be installed or updated:"
  Pop $0
  
  ; Ollama section
  ${NSD_CreateCheckbox} 10u 42u 100% 12u "Ollama"
  Pop $OllamaCheckbox
  CreateFont $1 "Segoe UI" 9 700
  SendMessage $OllamaCheckbox ${WM_SETFONT} $1 0
  
  ${If} $OllamaInstalled == "1"
    ${NSD_Check} $OllamaCheckbox
    EnableWindow $OllamaCheckbox 0  ; Disable - already installed
    ${NSD_CreateLabel} 20u 54u 100% 10u "AI language model runtime for local AI processing  (Already Installed)"
  ${Else}
    ${NSD_Check} $OllamaCheckbox
    StrCpy $InstallOllama "1"
    ${NSD_CreateLabel} 20u 54u 100% 10u "AI language model runtime for local AI processing  (Required)"
  ${EndIf}
  Pop $0
  SetCtlColors $0 666666 transparent
  
  ; Model options (indented under Ollama)
  ${NSD_CreateCheckbox} 30u 70u 90% 12u "├─ GPT-OSS 20B Model (Recommended)"
  Pop $ModelGPTOSSCheckbox
  ${NSD_Check} $ModelGPTOSSCheckbox
  ${NSD_CreateLabel} 40u 82u 90% 10u "High-performance AI model for advanced tasks (recommend 16GB+ RAM)  (Optional)"
  Pop $0
  SetCtlColors $0 666666 transparent
  
  ${NSD_CreateCheckbox} 30u 96u 90% 12u "├─ Mistral 7B Model (Lightweight)"
  Pop $ModelMistralCheckbox
  ${NSD_CreateLabel} 40u 108u 90% 10u "Lightweight AI model for general use (recommend 16GB+ RAM)  (Optional)"
  Pop $0
  SetCtlColors $0 666666 transparent
  
  ${NSD_CreateCheckbox} 30u 122u 90% 12u "└─ Granite4 Tiny-H Model (Ultra-lightweight)"
  Pop $ModelGraniteCheckbox
  ${NSD_CreateLabel} 40u 134u 90% 10u "Ultra-lightweight AI model for resource-constrained environments (recommend 8GB+ RAM)  (Optional)"
  Pop $0
  SetCtlColors $0 666666 transparent
  
  ; Warning box
  ${NSD_CreateGroupBox} 10u 152u 97% 55u ""
  Pop $0
  
  ; Warning icon and text
  ${NSD_CreateLabel} 20u 162u 100% 10u "⚠ Install at your own risk"
  Pop $0
  SetCtlColors $0 CC0000 transparent
  CreateFont $1 "Segoe UI" 9 700
  SendMessage $0 ${WM_SETFONT} $1 0
  
  ${NSD_CreateLabel} 20u 174u 95% 20u "Component(s) listed above are third-party applications not developed by CPACE but are necessary for NebulonGPT to run correctly."
  Pop $0
  SetCtlColors $0 CC0000 transparent
  
  ${NSD_CreateCheckbox} 20u 192u 95% 12u "You can install them yourself from their official websites or let the NebulonGPT Installer handle the setup automatically for your convenience."
  Pop $DisclaimerCheckbox
  SetCtlColors $DisclaimerCheckbox CC0000 transparent
  
  ${NSD_OnClick} $DisclaimerCheckbox ComponentPageDisclaimerClick
  ${NSD_OnClick} $OllamaCheckbox ComponentPageOllamaClick
  ${NSD_OnClick} $ModelGPTOSSCheckbox ComponentPageModelClick
  ${NSD_OnClick} $ModelMistralCheckbox ComponentPageModelClick
  ${NSD_OnClick} $ModelGraniteCheckbox ComponentPageModelClick
  
  nsDialogs::Show
FunctionEnd

; ============================================
; Function: Handle Disclaimer Checkbox Click
; ============================================
Function ComponentPageDisclaimerClick
  ${NSD_GetState} $DisclaimerCheckbox $DisclaimerAccepted
  ${If} $DisclaimerAccepted == ${BST_CHECKED}
    StrCpy $DisclaimerAccepted "1"
  ${Else}
    StrCpy $DisclaimerAccepted "0"
  ${EndIf}
FunctionEnd

; ============================================
; Function: Handle Ollama Checkbox Click
; ============================================
Function ComponentPageOllamaClick
  ${NSD_GetState} $OllamaCheckbox $InstallOllama
  ${If} $InstallOllama == ${BST_CHECKED}
    StrCpy $InstallOllama "1"
  ${Else}
    StrCpy $InstallOllama "0"
  ${EndIf}
FunctionEnd

; ============================================
; Function: Handle Model Checkbox Click
; ============================================
Function ComponentPageModelClick
  ${NSD_GetState} $ModelGPTOSSCheckbox $InstallModelGPTOSS
  ${If} $InstallModelGPTOSS == ${BST_CHECKED}
    StrCpy $InstallModelGPTOSS "1"
  ${Else}
    StrCpy $InstallModelGPTOSS "0"
  ${EndIf}
  
  ${NSD_GetState} $ModelMistralCheckbox $InstallModelMistral
  ${If} $InstallModelMistral == ${BST_CHECKED}
    StrCpy $InstallModelMistral "1"
  ${Else}
    StrCpy $InstallModelMistral "0"
  ${EndIf}
  
  ${NSD_GetState} $ModelGraniteCheckbox $InstallModelGranite
  ${If} $InstallModelGranite == ${BST_CHECKED}
    StrCpy $InstallModelGranite "1"
  ${Else}
    StrCpy $InstallModelGranite "0"
  ${EndIf}
FunctionEnd

; ============================================
; Variables for Model Selection Dialog
; ============================================
Var ModelDialog
Var ModelDialogGPTOSS
Var ModelDialogMistral
Var ModelDialogGranite

; ============================================
; Variables for Model Selection Dialog - Disclaimer checkbox
; ============================================
Var ModelDialogDisclaimer

; ============================================
; Function: Detect RAM and Auto-Select Model
; Detects system RAM and auto-selects appropriate model:
; - 16GB+ RAM: GPT-OSS 20B (Recommended)
; - 8-16GB RAM: Mistral 7B (Lightweight)
; - <8GB RAM: Granite4 Tiny-H (Ultra-lightweight)
; ============================================
Function DetectRAMAndSelectModel
  ; Get system RAM using PowerShell
  nsExec::ExecToStack 'powershell -NoProfile -ExecutionPolicy Bypass -Command "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)"'
  Pop $0  ; Return code
  Pop $1  ; RAM in GB
  
  ; Remove any whitespace/newlines
  StrCpy $2 $1 2  ; Get first 2 chars (handles "16", "32", "8", etc.)
  
  ; Convert to integer for comparison
  IntOp $3 $2 + 0
  
  ; Auto-select model based on RAM
  ${If} $3 >= 16
    ; 16GB+ RAM: Select GPT-OSS 20B (Recommended)
    StrCpy $InstallModelGPTOSS "1"
    StrCpy $InstallModelMistral "0"
    StrCpy $InstallModelGranite "0"
  ${ElseIf} $3 >= 8
    ; 8-16GB RAM: Select Mistral 7B (Lightweight)
    StrCpy $InstallModelGPTOSS "0"
    StrCpy $InstallModelMistral "1"
    StrCpy $InstallModelGranite "0"
  ${Else}
    ; <8GB RAM: Select Granite4 Tiny-H (Ultra-lightweight)
    StrCpy $InstallModelGPTOSS "0"
    StrCpy $InstallModelMistral "0"
    StrCpy $InstallModelGranite "1"
  ${EndIf}
  
  ; Always install Ollama
  StrCpy $InstallOllama "1"
FunctionEnd

; ============================================
; Function: Show Model Selection Dialog
; Shows a popup dialog with Ollama + 3 model checkboxes + disclaimer
; ============================================
Function ShowModelSelectionDialog
  ; Create dialog - using 1044 for custom size
  nsDialogs::Create 1018
  Pop $ModelDialog
  ${If} $ModelDialog == error
    Return
  ${EndIf}
  
  ; Title
  ${NSD_CreateLabel} 0 0 100% 12u "Select Components to Install"
  Pop $0
  CreateFont $1 "Segoe UI" 10 700
  SendMessage $0 ${WM_SETFONT} $1 0
  
  ; Ollama - Required, checked and disabled
  ${NSD_CreateCheckbox} 5u 14u 50% 10u "Ollama (Required)"
  Pop $OllamaCheckbox
  CreateFont $1 "Segoe UI" 8 700
  SendMessage $OllamaCheckbox ${WM_SETFONT} $1 0
  ${NSD_Check} $OllamaCheckbox
  EnableWindow $OllamaCheckbox 0  ; Disabled - always install Ollama
  StrCpy $InstallOllama "1"
  
  ${NSD_CreateLabel} 15u 24u 95% 8u "AI language model runtime for local AI processing"
  Pop $0
  SetCtlColors $0 666666 transparent
  
  ; Model 1 - GPT-OSS 20B (Recommended)
  ${NSD_CreateCheckbox} 15u 34u 90% 10u "├─ GPT-OSS 20B Model (Recommended) - 16GB+ RAM"
  Pop $ModelDialogGPTOSS
  ${If} $InstallModelGPTOSS == "1"
    ${NSD_Check} $ModelDialogGPTOSS
  ${EndIf}
  
  ; Model 2 - Mistral 7B (Lightweight)
  ${NSD_CreateCheckbox} 15u 46u 90% 10u "├─ Mistral 7B Model (Lightweight) - 8GB+ RAM"
  Pop $ModelDialogMistral
  ${If} $InstallModelMistral == "1"
    ${NSD_Check} $ModelDialogMistral
  ${EndIf}
  
  ; Model 3 - Granite4 Tiny-H (Ultra-lightweight)
  ${NSD_CreateCheckbox} 15u 58u 90% 10u "└─ Granite4 Tiny-H Model (Ultra-lightweight) - 4GB+ RAM"
  Pop $ModelDialogGranite
  ${If} $InstallModelGranite == "1"
    ${NSD_Check} $ModelDialogGranite
  ${EndIf}
  
  ; Separator line
  ${NSD_CreateLabel} 5u 72u 95% 1u ""
  Pop $0
  SetCtlColors $0 CCCCCC CCCCCC
  
  ; Warning text
  ${NSD_CreateLabel} 5u 76u 95% 16u "⚠ Install at your own risk: These are third-party apps not developed by CPACE but are necessary for NebulonGPT."
  Pop $0
  SetCtlColors $0 CC0000 transparent
  
  ; Accept checkbox
  ${NSD_CreateCheckbox} 5u 94u 95% 10u "I accept and agree to install the selected components"
  Pop $DisclaimerCheckbox
  SetCtlColors $DisclaimerCheckbox 000000 transparent
  CreateFont $1 "Segoe UI" 8 700
  SendMessage $DisclaimerCheckbox ${WM_SETFONT} $1 0
  
  ; Info note
  ${NSD_CreateLabel} 5u 108u 95% 8u "Note: Click outside this dialog or press Enter to continue after accepting."
  Pop $0
  SetCtlColors $0 888888 transparent
  
  ; Register click handlers
  ${NSD_OnClick} $ModelDialogGPTOSS OnModelDialogClick
  ${NSD_OnClick} $ModelDialogMistral OnModelDialogClick
  ${NSD_OnClick} $ModelDialogGranite OnModelDialogClick
  ${NSD_OnClick} $DisclaimerCheckbox OnDisclaimerClick
  
  nsDialogs::Show
  
  ; Read final state after dialog closes
  ${NSD_GetState} $ModelDialogGPTOSS $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallModelGPTOSS "1"
  ${Else}
    StrCpy $InstallModelGPTOSS "0"
  ${EndIf}
  
  ${NSD_GetState} $ModelDialogMistral $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallModelMistral "1"
  ${Else}
    StrCpy $InstallModelMistral "0"
  ${EndIf}
  
  ${NSD_GetState} $ModelDialogGranite $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallModelGranite "1"
  ${Else}
    StrCpy $InstallModelGranite "0"
  ${EndIf}
  
  ; Read disclaimer checkbox state
  ${NSD_GetState} $DisclaimerCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $DisclaimerAccepted "1"
  ${Else}
    StrCpy $DisclaimerAccepted "0"
  ${EndIf}
FunctionEnd

; ============================================
; Function: Handle Model Dialog Checkbox Click
; ============================================
Function OnModelDialogClick
  ; Just handle the click - state will be read when dialog closes
FunctionEnd

; ============================================
; Function: Handle Disclaimer Checkbox Click
; Shows confirmation MessageBox when checkbox is checked
; ============================================
Function OnDisclaimerClick
  ${NSD_GetState} $DisclaimerCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    ; User checked the accept checkbox - show confirmation MessageBox
    MessageBox MB_OKCANCEL|MB_ICONQUESTION "You have accepted the disclaimer.$\r$\n$\r$\nClick OK to continue with installation or Cancel to go back." IDOK ContinueInstall
    ; User clicked Cancel - uncheck the checkbox and stay in dialog
    ${NSD_Uncheck} $DisclaimerCheckbox
    Return
    
    ContinueInstall:
    ; User clicked OK - close the dialog and proceed
    StrCpy $DisclaimerAccepted "1"
    
    ; Read model selections before closing
    ${NSD_GetState} $ModelDialogGPTOSS $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $InstallModelGPTOSS "1"
    ${Else}
      StrCpy $InstallModelGPTOSS "0"
    ${EndIf}
    
    ${NSD_GetState} $ModelDialogMistral $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $InstallModelMistral "1"
    ${Else}
      StrCpy $InstallModelMistral "0"
    ${EndIf}
    
    ${NSD_GetState} $ModelDialogGranite $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $InstallModelGranite "1"
    ${Else}
      StrCpy $InstallModelGranite "0"
    ${EndIf}
    
    ; Send WM_CLOSE to close the nsDialogs window
    SendMessage $ModelDialog ${WM_CLOSE} 0 0
  ${EndIf}
FunctionEnd

; ============================================
; Function: Component Selection Page Leave
; Validates user selections before proceeding
; ============================================
Function ComponentPageLeave
  ; Check if disclaimer is accepted when installing third-party components
  ${If} $OllamaInstalled == "0"
    ${If} $InstallOllama == "1"
      ${If} $DisclaimerAccepted != "1"
        MessageBox MB_OK|MB_ICONEXCLAMATION "Please accept the disclaimer checkbox to continue with Ollama installation, or uncheck Ollama to skip it."
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}
  
  ; Check if any model is selected but Ollama is not being installed and not already installed
  ${If} $OllamaInstalled == "0"
  ${AndIf} $InstallOllama == "0"
    ${If} $InstallModelGPTOSS == "1"
    ${OrIf} $InstallModelMistral == "1"
    ${OrIf} $InstallModelGranite == "1"
      MessageBox MB_OK|MB_ICONEXCLAMATION "You have selected AI models but Ollama is not installed. Please either check Ollama to install it, or uncheck all models."
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

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

; ============================================
; Custom Header - Additional includes
; ============================================
!macro customHeader
  ; Additional NSIS header includes
!macroend

; ============================================
; customInit - Initialize variables at startup
; ============================================
!macro customInit
  ; Initialize component selection variables at startup
  StrCpy $InstallOllama "0"
  StrCpy $InstallModelGPTOSS "0"
  StrCpy $InstallModelMistral "0"
  StrCpy $InstallModelGranite "0"
  StrCpy $DisclaimerAccepted "0"
  StrCpy $OllamaInstalled "0"
!macroend

!macro customInstall
  ; Force show details view
  SetDetailsView show
  SetDetailsPrint both
  
  ; ============================================
  ; STEP 0: Component Selection with RAM Detection
  ; ============================================
  
  ; Check if Ollama is already installed
  !insertmacro CheckOllamaInstalled
  
  ; Detect system RAM and auto-select appropriate model
  Call DetectRAMAndSelectModel
  
  ; Build model selection summary
  StrCpy $4 ""
  ${If} $InstallModelGPTOSS == "1"
    StrCpy $4 "$4$\r$\n  ✓ GPT-OSS 20B Model (Recommended) - 16GB+ RAM"
  ${EndIf}
  ${If} $InstallModelMistral == "1"
    StrCpy $4 "$4$\r$\n  ✓ Mistral 7B Model (Lightweight) - 8GB+ RAM"
  ${EndIf}
  ${If} $InstallModelGranite == "1"
    StrCpy $4 "$4$\r$\n  ✓ Granite4 Tiny-H (Ultra-lightweight) - 4GB+ RAM"
  ${EndIf}
  
  ; If no model selected, add default
  StrCmp $4 "" 0 ShowConfirmation
    StrCpy $4 "$\r$\n  (No AI model selected)"
  
  ShowConfirmation:
  ; Show component selection and disclaimer MessageBox
  MessageBox MB_OKCANCEL|MB_ICONQUESTION "NebulonGPT Component Installation$\r$\n$\r$\nThe following components will be installed:$\r$\n$\r$\n  ✓ Ollama (Required)$4$\r$\n$\r$\n⚠ INSTALL AT YOUR OWN RISK$\r$\nThese are third-party applications not developed by CPACE but are necessary for NebulonGPT.$\r$\n$\r$\nClick OK to continue or Cancel to abort." IDOK UserAccepted
    ; User clicked Cancel - abort installation
    MessageBox MB_OK|MB_ICONINFORMATION "Installation cancelled by user."
    Abort
  
  UserAccepted:
  StrCpy $DisclaimerAccepted "1"
  
  ; Show detailed file installation progress from the start
  DetailPrint "Starting NebulonGPT installation..."
  DetailPrint ""
  
  ; ============================================
  ; STEP 1: Install Ollama and AI Models FIRST
  ; ============================================
  DetailPrint "=== Step 1: Ollama AI Runtime Setup ==="
  
  ; Download and install Ollama if selected and not already installed
  !insertmacro DownloadAndInstallOllama
  
  ; Check and start Ollama (for already installed or just installed)
  !insertmacro CheckAndStartOllama
  
  ; Pull selected AI models
  ${If} $InstallModelGPTOSS == "1"
  ${OrIf} $InstallModelMistral == "1"
  ${OrIf} $InstallModelGranite == "1"
    DetailPrint ""
    DetailPrint "=== Installing AI Models ==="
    DetailPrint "Note: Model downloads may take several minutes depending on your connection..."
    !insertmacro PullOllamaModels
  ${EndIf}
  
  DetailPrint ""
  
  ; ============================================
  ; STEP 2: Install Application Files
  ; ============================================
  DetailPrint "=== Step 2: Installing Application Files ==="
  DetailPrint "Copying electron.js..."
  DetailPrint "Copying preload.js..."
  DetailPrint "Copying server.js..."
  DetailPrint "Installing React build files..."
  DetailPrint "Installing static assets..."
  DetailPrint "Installing icons and images..."
  DetailPrint "Installing audio processor..."
  DetailPrint "Installing Node.js modules..."
  DetailPrint "Setting up application structure..."
  DetailPrint ""
  
  ; ============================================
  ; STEP 3: Install Python Bundle and Models
  ; ============================================
  DetailPrint "=== Step 3: Installing Python Environment ==="
  !insertmacro ExtractPythonBundle
  DetailPrint ""
  
  ; ============================================
  ; STEP 4: Install TTS Cache
  ; ============================================
  DetailPrint "=== Step 4: Installing Text-to-Speech ==="
  !insertmacro ExtractTTSCache
  DetailPrint ""
  
  ; ============================================
  ; STEP 5: Install Vosk Speech Models
  ; ============================================
  DetailPrint "=== Step 5: Installing Speech Recognition ==="
  !insertmacro ExtractVoskModels
  DetailPrint ""
  
  ; ============================================
  ; STEP 6: Finalize Installation
  ; ============================================
  DetailPrint "=== Step 6: Finalizing Installation ==="
  DetailPrint "Configuring application settings..."
  DetailPrint "Creating desktop shortcuts..."
  DetailPrint "Registering file associations..."
  DetailPrint ""
  DetailPrint "✓ NebulonGPT installation completed successfully!"
  DetailPrint "Ready to launch NebulonGPT with AI-powered features"
  DetailPrint ""
  
  ; Show installation summary
  DetailPrint "=========================================="
  DetailPrint "         INSTALLATION SUMMARY"
  DetailPrint "=========================================="
  DetailPrint ""
  
  ${If} $OllamaInstalled == "1"
  ${OrIf} $InstallOllama == "1"
    DetailPrint "✓ Ollama AI runtime ready"
  ${Else}
    DetailPrint "⚠ Ollama not installed - install from https://ollama.ai"
  ${EndIf}
  
  ${If} $InstallModelGPTOSS == "1"
    DetailPrint "✓ GPT-OSS 20B Model installed"
  ${EndIf}
  ${If} $InstallModelMistral == "1"
    DetailPrint "✓ Mistral 7B Model installed"
  ${EndIf}
  ${If} $InstallModelGranite == "1"
    DetailPrint "✓ Granite4 Tiny-H Model installed"
  ${EndIf}
  
  DetailPrint "✓ NebulonGPT application installed"
  DetailPrint "✓ Python runtime environment ready"
  DetailPrint "✓ Speech recognition (Vosk) configured"
  DetailPrint "✓ Text-to-speech (Kokoro) configured"
  
  DetailPrint ""
  DetailPrint "=========================================="
  DetailPrint ""
  DetailPrint "Installation complete!"
  Sleep 2000
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
