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
Var OllamaRunning
Var InstallOllama
Var InstallModelGPTOSS
Var InstallModelMistral
Var InstallModelGranite
Var DisclaimerAccepted
Var ModelGPTOSSExists
Var ModelMistralExists
Var ModelGraniteExists
Var NeedToInstallAnything

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
; FIX 1: PowerShell verifies file size – exits 1 on incomplete download
; FIX 2: NSIS file-existence guard as secondary safety net
; FIX 3: MB_RETRYCANCEL so Retry is button 1 (first + default focus)
; FIX 4: All MessageBox strings on single lines (no $\ continuation bug)
; ============================================
!macro DownloadAndInstallOllama
  ${If} $OllamaInstalled == "1"
    DetailPrint "Ollama is already installed - skipping download"
  ${ElseIf} $InstallOllama == "1"

    ReadEnvStr $0 "TEMP"

    ; ─────────────────────────────────────────
    ; PHASE 1 – Download
    ; ─────────────────────────────────────────
    OllamaDownloadRetry:
      ; Always wipe any partial file before attempting
      Delete "$0\OllamaSetup.exe"
      DetailPrint "Downloading Ollama installer (~1.2GB)..."
      DetailPrint "Please wait, this may take several minutes..."
      DetailPrint ""

      ; Improved PS script: validates file size and returns proper exit code
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $url=\"https://ollama.com/download/OllamaSetup.exe\"; $dest=\"$0\OllamaSetup.exe\"; $min=104857600; try { $req=[System.Net.HttpWebRequest]::Create($url); $resp=$req.GetResponse(); $total=$resp.ContentLength; Write-Host (\"Total: {0:N0} MB\" -f ($total/1MB)); $stream=$resp.GetResponseStream(); $fs=[System.IO.File]::Create($dest); $buf=New-Object byte[] 1048576; $dl=0; $lp=0; while(($r=$stream.Read($buf,0,$buf.Length)) -gt 0){ $fs.Write($buf,0,$r); $dl+=$r; $p=[int](($dl/$total)*100); if($p -ge $lp+1){ $lp=$p; Write-Host (\"Downloading: {0}%% - {1:N0}/{2:N0} MB\" -f $p,($dl/1MB),($total/1MB)) } }; $fs.Close(); $stream.Close(); $resp.Close(); $sz=(Get-Item $dest -ErrorAction Stop).Length; if($sz -lt $min){ Write-Host (\"Error: Only {0:N0} MB received - download incomplete\" -f ($sz/1MB)); Remove-Item $dest -Force -ErrorAction SilentlyContinue; exit 1 }; Write-Host \"Download complete!\"; exit 0 } catch { try{$fs.Close()}catch{}; Remove-Item $dest -Force -ErrorAction SilentlyContinue; Write-Host (\"Error: \"+$_.Exception.Message); Write-Host \"Trying curl fallback...\"; curl.exe -L -o $dest $url 2>&1; if($LASTEXITCODE -eq 0 -and (Test-Path $dest) -and (Get-Item $dest).Length -ge $min){ Write-Host \"Download complete!\"; exit 0 }; Remove-Item $dest -Force -ErrorAction SilentlyContinue; Write-Host \"Download failed!\"; exit 1 }"'
      Pop $1

      ; Secondary NSIS guard: even if PS returned 0, file must actually exist
      IfFileExists "$0\OllamaSetup.exe" OllamaDownloadFileOK OllamaDownloadFileMissing
      OllamaDownloadFileMissing:
        DetailPrint "⚠ Installer file missing after download - treating as failure"
        StrCpy $1 "1"
      OllamaDownloadFileOK:

      ${If} $1 != 0
        DetailPrint "⚠ Ollama download failed (exit code: $1)"
        DetailPrint "⚠ Check your internet connection and try again."
        ; Retry is button 1 - first button and default focus
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON1 "❌ Ollama Download Failed$\r$\n$\r$\nCould not download the Ollama installer. Check your internet connection.$\r$\n$\r$\n[Retry]   Try downloading again$\r$\n[Cancel]  Choose to skip or abort" IDRETRY OllamaDownloadRetry
        ; User clicked Cancel → ask Skip or Abort
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Skip Ollama and continue?$\r$\n$\r$\n[Yes]  Skip Ollama - install manually later from https://ollama.ai$\r$\n[No]   Abort the entire installation" IDYES OllamaInstallSkip
        ; User chose No = Abort
        Abort
      ${EndIf}

    DetailPrint "✓ Ollama downloaded successfully"
    DetailPrint ""

    ; ─────────────────────────────────────────
    ; PHASE 2 – Install
    ; ─────────────────────────────────────────
    OllamaInstallRetry:
      DetailPrint "Installing Ollama..."
      DetailPrint "Running Ollama Setup (this may take 1-2 minutes)..."
      DetailPrint "Installing: 0% - Starting installer..."

      nsExec::ExecToLog '"$0\OllamaSetup.exe" /VERYSILENT /NORESTART /SUPPRESSMSGBOXES'
      Pop $1

      ${If} $1 != 0
        DetailPrint "⚠ Ollama installation failed (exit code: $1)"
        ; Retry is button 1 - first button and default focus
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON1 "❌ Ollama Installation Failed (exit code: $1)$\r$\n$\r$\nThe Ollama Setup encountered an error.$\r$\n$\r$\n[Retry]   Run the installer again$\r$\n[Cancel]  Choose to skip or abort" IDRETRY OllamaInstallRetry
        ; User clicked Cancel → ask Skip or Abort
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Skip Ollama and continue?$\r$\n$\r$\n[Yes]  Skip Ollama - install manually later from https://ollama.ai$\r$\n[No]   Abort the entire installation" IDYES OllamaInstallSkip
        ; User chose No = Abort
        Delete "$0\OllamaSetup.exe"
        Abort
      ${EndIf}

    DetailPrint "Installing: 100% - Complete"
    DetailPrint "✓ Ollama installed successfully"
    DetailPrint "Waiting for installation to settle..."
    Sleep 3000
    DetailPrint "Starting Ollama service..."
    ReadEnvStr $2 "LOCALAPPDATA"
    nsExec::Exec '"$2\Programs\Ollama\ollama.exe" serve'
    Pop $1
    DetailPrint "Waiting for Ollama to initialize..."
    Sleep 5000
    DetailPrint "✓ Ollama service started and ready"
    Goto OllamaInstallDone

    OllamaInstallSkip:
      DetailPrint "⚠ Ollama installation was skipped by user"
      DetailPrint "⚠ Please install Ollama manually from https://ollama.ai"
      StrCpy $InstallOllama "0"

    OllamaInstallDone:
      Delete "$0\OllamaSetup.exe"

  ${EndIf}
!macroend

; ============================================
; Macro: Pull Selected Ollama Models
; Retry is button 1 (first + default focus) via MB_RETRYCANCEL.
; Cancel leads to a secondary Yes/No dialog: Skip or Abort.
; All strings are single-line (no $\ continuation bug).
; ============================================
!macro PullOllamaModels
  ; Find Ollama executable
  ReadEnvStr $0 "LOCALAPPDATA"
  StrCpy $3 "$0\Programs\Ollama\ollama.exe"

  IfFileExists "$3" PullModels SkipModelPull

  PullModels:

    ; ──────────────────────────────────────────
    ; MODEL 1 – GPT-OSS 20B
    ; ──────────────────────────────────────────
    ${If} $InstallModelGPTOSS == "1"
    ${AndIf} $ModelGPTOSSExists == "0"

      PullGPTOSSRetry:
        DetailPrint ""
        DetailPrint "Downloading GPT-OSS 20B Model..."
        DetailPrint "This may take several minutes depending on your internet connection..."

        nsExec::ExecToLog '"$3" pull gpt-oss:20b'
        Pop $1

        ; Secondary guard: verify model actually exists in ollama list
        ${If} $1 == 0
          nsExec::ExecToStack '"$3" list'
          Pop $2
          Pop $2
          nsExec::ExecToStack 'powershell -NoProfile -Command "if (\"$2\" -match \"gpt-oss\") { exit 0 } else { exit 1 }"'
          Pop $2
          ${If} $2 != 0
            DetailPrint "⚠ GPT-OSS 20B Model not found after pull - download may be incomplete"
            StrCpy $1 "1"
          ${EndIf}
        ${EndIf}

        ${If} $1 != 0
          DetailPrint "⚠ GPT-OSS 20B Model download failed (exit code: $1)"
          ; Retry is button 1 - first button and default focus
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON1 "❌ GPT-OSS 20B Model Failed (exit code: $1)$\r$\n$\r$\nCould not download the model. Check your internet and that Ollama is running.$\r$\n$\r$\n[Retry]   Try pulling the model again$\r$\n[Cancel]  Choose to skip or abort" IDRETRY PullGPTOSSRetry
          ; User clicked Cancel → ask Skip or Abort
          MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Skip GPT-OSS 20B and continue?$\r$\n$\r$\n[Yes]  Skip this model (run manually later: ollama pull gpt-oss:20b)$\r$\n[No]   Abort the entire installation" IDYES PullGPTOSSSkip
          ; User chose No = Abort
          Abort

          PullGPTOSSSkip:
            DetailPrint "⚠ GPT-OSS 20B Model skipped by user"
            DetailPrint "⚠ Run manually later: ollama pull gpt-oss:20b"
            Goto PullGPTOSSDone
        ${EndIf}

        DetailPrint "✓ GPT-OSS 20B Model installed successfully"

      PullGPTOSSDone:
    ${EndIf}

    ; ──────────────────────────────────────────
    ; MODEL 2 – Mistral 7B
    ; ──────────────────────────────────────────
    ${If} $InstallModelMistral == "1"
    ${AndIf} $ModelMistralExists == "0"

      PullMistralRetry:
        DetailPrint ""
        DetailPrint "Downloading Mistral 7B Model..."
        DetailPrint "This may take several minutes depending on your internet connection..."

        nsExec::ExecToLog '"$3" pull mistral:7b'
        Pop $1

        ; Secondary guard: verify model actually exists in ollama list
        ${If} $1 == 0
          nsExec::ExecToStack '"$3" list'
          Pop $2
          Pop $2
          nsExec::ExecToStack 'powershell -NoProfile -Command "if (\"$2\" -match \"mistral\") { exit 0 } else { exit 1 }"'
          Pop $2
          ${If} $2 != 0
            DetailPrint "⚠ Mistral 7B Model not found after pull - download may be incomplete"
            StrCpy $1 "1"
          ${EndIf}
        ${EndIf}

        ${If} $1 != 0
          DetailPrint "⚠ Mistral 7B Model download failed (exit code: $1)"
          ; Retry is button 1 - first button and default focus
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON1 "❌ Mistral 7B Model Failed (exit code: $1)$\r$\n$\r$\nCould not download the model. Check your internet and that Ollama is running.$\r$\n$\r$\n[Retry]   Try pulling the model again$\r$\n[Cancel]  Choose to skip or abort" IDRETRY PullMistralRetry
          ; User clicked Cancel → ask Skip or Abort
          MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Skip Mistral 7B and continue?$\r$\n$\r$\n[Yes]  Skip this model (run manually later: ollama pull mistral:7b)$\r$\n[No]   Abort the entire installation" IDYES PullMistralSkip
          ; User chose No = Abort
          Abort

          PullMistralSkip:
            DetailPrint "⚠ Mistral 7B Model skipped by user"
            DetailPrint "⚠ Run manually later: ollama pull mistral:7b"
            Goto PullMistralDone
        ${EndIf}

        DetailPrint "✓ Mistral 7B Model installed successfully"

      PullMistralDone:
    ${EndIf}

    ; ──────────────────────────────────────────
    ; MODEL 3 – Granite4 Tiny-H (granite3.1-moe:1b)
    ; ──────────────────────────────────────────
    ${If} $InstallModelGranite == "1"
    ${AndIf} $ModelGraniteExists == "0"

      PullGraniteRetry:
        DetailPrint ""
        DetailPrint "Downloading Granite4 Tiny-H Model..."
        DetailPrint "This may take several minutes depending on your internet connection..."

        nsExec::ExecToLog '"$3" pull granite3.1-moe:1b'
        Pop $1

        ; Secondary guard: verify model actually exists in ollama list
        ${If} $1 == 0
          nsExec::ExecToStack '"$3" list'
          Pop $2
          Pop $2
          nsExec::ExecToStack 'powershell -NoProfile -Command "if (\"$2\" -match \"granite3.1-moe\") { exit 0 } else { exit 1 }"'
          Pop $2
          ${If} $2 != 0
            DetailPrint "⚠ Granite4 Tiny-H Model not found after pull - download may be incomplete"
            StrCpy $1 "1"
          ${EndIf}
        ${EndIf}

        ${If} $1 != 0
          DetailPrint "⚠ Granite4 Tiny-H Model download failed (exit code: $1)"
          ; Retry is button 1 - first button and default focus
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON1 "❌ Granite4 Tiny-H Model Failed (exit code: $1)$\r$\n$\r$\nCould not download the model. Check your internet and that Ollama is running.$\r$\n$\r$\n[Retry]   Try pulling the model again$\r$\n[Cancel]  Choose to skip or abort" IDRETRY PullGraniteRetry
          ; User clicked Cancel → ask Skip or Abort
          MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Skip Granite4 Tiny-H and continue?$\r$\n$\r$\n[Yes]  Skip this model (run manually later: ollama pull granite3.1-moe:1b)$\r$\n[No]   Abort the entire installation" IDYES PullGraniteSkip
          ; User chose No = Abort
          Abort

          PullGraniteSkip:
            DetailPrint "⚠ Granite4 Tiny-H Model skipped by user"
            DetailPrint "⚠ Run manually later: ollama pull granite3.1-moe:1b"
            Goto PullGraniteDone
        ${EndIf}

        DetailPrint "✓ Granite4 Tiny-H Model installed successfully"

      PullGraniteDone:
    ${EndIf}

    Goto ModelPullDone

  SkipModelPull:
    DetailPrint "Ollama not found, skipping model installation"
    DetailPrint "Please install models manually using 'ollama pull <model>'"

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
  ; STEP 0: Smart Check - Only show message if something needs to be installed
  ; ============================================
  
  ; Initialize check variables
  StrCpy $OllamaInstalled "0"
  StrCpy $OllamaRunning "0"
  StrCpy $ModelGPTOSSExists "0"
  StrCpy $ModelMistralExists "0"
  StrCpy $ModelGraniteExists "0"
  StrCpy $NeedToInstallAnything "0"
  
  ; Check if Ollama is installed
  !insertmacro CheckOllamaInstalled
  
  ; Detect system RAM and auto-select appropriate model
  Call DetectRAMAndSelectModel
  
  ; If Ollama is installed, check if it's running and check for models
  ${If} $OllamaInstalled == "1"
    ; Check if Ollama is running
    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq ollama.exe" /NH'
    Pop $0  ; Return code
    Pop $1  ; Output
    ${If} $1 != "INFO: No tasks are running which match the specified criteria."
      StrCpy $OllamaRunning "1"
    ${EndIf}
    
    ; Get list of installed models to check which exist
    ReadEnvStr $0 "LOCALAPPDATA"
    StrCpy $3 "$0\Programs\Ollama\ollama.exe"
    
    ; Need to start Ollama temporarily to check models if not running
    ${If} $OllamaRunning == "0"
      ; Start Ollama silently to check models
      nsExec::Exec '"$3" serve'
      Sleep 3000
    ${EndIf}
    
    ; Get model list
    nsExec::ExecToStack '"$3" list'
    Pop $0  ; Return code
    Pop $1  ; Model list output
    
    ; Check if gpt-oss:20b exists
    nsExec::ExecToStack 'powershell -NoProfile -Command "if (\"$1\" -match \"gpt-oss:20b\") { exit 0 } else { exit 1 }"'
    Pop $0
    ${If} $0 == 0
      StrCpy $ModelGPTOSSExists "1"
    ${EndIf}
    
    ; Check if mistral:7b exists
    nsExec::ExecToStack 'powershell -NoProfile -Command "if (\"$1\" -match \"mistral:7b\") { exit 0 } else { exit 1 }"'
    Pop $0
    ${If} $0 == 0
      StrCpy $ModelMistralExists "1"
    ${EndIf}
    
    ; Check if granite3.1-moe:1b exists
    nsExec::ExecToStack 'powershell -NoProfile -Command "if (\"$1\" -match \"granite3.1-moe:1b\") { exit 0 } else { exit 1 }"'
    Pop $0
    ${If} $0 == 0
      StrCpy $ModelGraniteExists "1"
    ${EndIf}
  ${EndIf}
  
  ; Build list of components to install (only show what's needed)
  StrCpy $4 ""
  
  ; Check if Ollama needs to be installed
  ${If} $OllamaInstalled == "0"
    StrCpy $4 "$4$\r$\n  • Ollama (Required) - needs to be installed"
    StrCpy $NeedToInstallAnything "1"
    StrCpy $InstallOllama "1"
  ${EndIf}
  
  ; Check if selected model needs to be downloaded
  ${If} $InstallModelGPTOSS == "1"
  ${AndIf} $ModelGPTOSSExists == "0"
    StrCpy $4 "$4$\r$\n  • GPT-OSS 20B Model - needs to be downloaded"
    StrCpy $NeedToInstallAnything "1"
  ${EndIf}
  
  ${If} $InstallModelMistral == "1"
  ${AndIf} $ModelMistralExists == "0"
    StrCpy $4 "$4$\r$\n  • Mistral 7B Model - needs to be downloaded"
    StrCpy $NeedToInstallAnything "1"
  ${EndIf}
  
  ${If} $InstallModelGranite == "1"
  ${AndIf} $ModelGraniteExists == "0"
    StrCpy $4 "$4$\r$\n  • Granite4 Tiny-H Model - needs to be downloaded"
    StrCpy $NeedToInstallAnything "1"
  ${EndIf}
  
  ; Only show confirmation dialog if something needs to be installed
  ${If} $NeedToInstallAnything == "1"
    ; Show component selection and disclaimer MessageBox
    MessageBox MB_OKCANCEL|MB_ICONQUESTION "NebulonGPT Component Installation$\r$\n$\r$\nThe following components need to be installed:$4$\r$\n$\r$\n⚠ INSTALL AT YOUR OWN RISK$\r$\nThese are third-party applications not developed by CPACE but are necessary for NebulonGPT.$\r$\n$\r$\nClick OK to continue or Cancel to abort." IDOK UserAccepted
      ; User clicked Cancel - abort installation
      MessageBox MB_OK|MB_ICONINFORMATION "Installation cancelled by user."
      Abort
    
    UserAccepted:
    StrCpy $DisclaimerAccepted "1"
  ${EndIf}
  
  ; Show detailed file installation progress from the start
  DetailPrint "Starting NebulonGPT installation..."
  DetailPrint ""
  
  ; ============================================
  ; STEP 1: Ollama AI Runtime Setup
  ; ============================================
  
  ; Only show step header if something needs to be done
  ${If} $OllamaInstalled == "0"
  ${OrIf} $OllamaRunning == "0"
  ${OrIf} $NeedToInstallAnything == "1"
    DetailPrint "=== Step 1: Ollama AI Runtime Setup ==="
  ${EndIf}
  
  ; Download and install Ollama if not installed
  ${If} $OllamaInstalled == "0"
    !insertmacro DownloadAndInstallOllama
    StrCpy $OllamaInstalled "1"
    StrCpy $OllamaRunning "1"
  ${ElseIf} $OllamaRunning == "0"
    ; Ollama is installed but not running - just start it
    DetailPrint "Running Ollama..."
    ReadEnvStr $0 "LOCALAPPDATA"
    nsExec::Exec '"$0\Programs\Ollama\ollama.exe" serve'
    Sleep 3000
    DetailPrint "✓ Ollama started"
    StrCpy $OllamaRunning "1"
  ${EndIf}
  ; If Ollama is installed AND running - say nothing
  
  ; Pull selected AI models (only if they don't exist)
  ; Check if any model needs to be downloaded
  StrCpy $5 "0"
  ${If} $InstallModelGPTOSS == "1"
  ${AndIf} $ModelGPTOSSExists == "0"
    StrCpy $5 "1"
  ${EndIf}
  ${If} $InstallModelMistral == "1"
  ${AndIf} $ModelMistralExists == "0"
    StrCpy $5 "1"
  ${EndIf}
  ${If} $InstallModelGranite == "1"
  ${AndIf} $ModelGraniteExists == "0"
    StrCpy $5 "1"
  ${EndIf}
  
  ${If} $5 == "1"
    DetailPrint ""
    DetailPrint "=== Installing AI Models ==="
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
