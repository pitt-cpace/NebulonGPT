import React, { useState, useEffect } from 'react';
import { Box, Typography, LinearProgress, Fade } from '@mui/material';

interface StartupProgress {
  step: string;
  status: string;
  timestamp: string;
  completed: boolean;
}

interface StartupLoaderProps {
  onComplete?: () => void;
}

const StartupLoader: React.FC<StartupLoaderProps> = ({ onComplete }) => {
  const [progress, setProgress] = useState<StartupProgress | null>(null);
  const [show, setShow] = useState(true); // Start with showing the loader
  const [hasChecked, setHasChecked] = useState(false);
  const [isStartupComplete, setIsStartupComplete] = useState(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let voskWs: WebSocket | null = null;
    let kokoroWs: WebSocket | null = null;
    let voskConnected = false;
    let kokoroConnected = false;

    const showLoader = (message: string, status: string) => {
      console.log('⏳ Showing loader:', message);
      setShow(true);
      setProgress({
        step: message,
        status: status,
        timestamp: new Date().toISOString(),
        completed: false
      });
    };

    const hideLoader = () => {
      console.log('✅ All services connected, hiding loader');
      setProgress({
        step: "All services connected",
        status: "completed",
        timestamp: new Date().toISOString(),
        completed: true
      });
      
      timeoutId = setTimeout(() => {
        setShow(false);
        onComplete?.();
      }, 1000);
    };

    const checkAllServicesReady = () => {
      // Hide loader only when both services are connected
      if (voskConnected && kokoroConnected) {
        hideLoader();
      }
    };

    const connectToVosk = () => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/vosk`;
        
        voskWs = new WebSocket(wsUrl);
        
        voskWs.onopen = () => {
          console.log('🎤 Vosk WebSocket connected');
          voskConnected = true;
          checkAllServicesReady();
        };
        
        voskWs.onclose = () => {
          console.log('🎤 Vosk WebSocket disconnected');
          voskConnected = false;
          // Show loader when service disconnects
          showLoader("Reconnecting to speech recognition...", "reconnecting");
          // Try to reconnect after 2 seconds
          setTimeout(connectToVosk, 2000);
        };
        
        voskWs.onerror = (error) => {
          console.error('🎤 Vosk WebSocket error:', error);
          voskConnected = false;
        };
        
      } catch (error) {
        console.error('🎤 Failed to connect to Vosk:', error);
        voskConnected = false;
        setTimeout(connectToVosk, 1000);
      }
    };

    const connectToKokoro = () => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/tts`;
        
        kokoroWs = new WebSocket(wsUrl);
        
        kokoroWs.onopen = () => {
          console.log('🔊 Kokoro WebSocket connected');
          kokoroConnected = true;
          checkAllServicesReady();
        };
        
        kokoroWs.onclose = () => {
          console.log('🔊 Kokoro WebSocket disconnected');
          kokoroConnected = false;
          // Show loader when service disconnects
          showLoader("Reconnecting to text-to-speech...", "reconnecting");
          // Try to reconnect after 2 seconds
          setTimeout(connectToKokoro, 1000);
        };
        
        kokoroWs.onerror = (error) => {
          console.error('🔊 Kokoro WebSocket error:', error);
          kokoroConnected = false;
        };
        
      } catch (error) {
        console.error('🔊 Failed to connect to Kokoro:', error);
        kokoroConnected = false;
        setTimeout(connectToKokoro, 2000);
      }
    };

    // Set initial loading message
    setProgress({
      step: "Starting NebulonGPT services...",
      status: "initializing",
      timestamp: new Date().toISOString(),
      completed: false
    });
    setShow(true);

    // Start connecting to services
    connectToVosk();
    connectToKokoro();

    return () => {
      if (voskWs) {
        voskWs.close();
      }
      if (kokoroWs) {
        kokoroWs.close();
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [onComplete]);

  if (!show || !progress || progress.completed) {
    return null;
  }

  return (
    <Fade in={show}>
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
        }}
      >
        <Box
          sx={{
            backgroundColor: 'background.paper',
            borderRadius: 2,
            padding: 4,
            minWidth: 400,
            maxWidth: 500,
            textAlign: 'center',
            boxShadow: 24,
          }}
        >
          <Typography variant="h5" gutterBottom sx={{ color: 'primary.main', fontWeight: 'bold' }}>
            🚀 NebulonGPT Loading
          </Typography>
          
          {/* Yellow warning message about Ollama and models */}
          <Box
            sx={{
              backgroundColor: 'rgba(255, 193, 7, 0.35)',
              border: '2px solid rgba(255, 193, 7, 0.8)',
              borderRadius: 2,
              padding: 2,
              mb: 3,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1.5,
            }}
          >
            <Box
              sx={{
                color: 'warning.main',
                fontSize: '1.2rem',
                mt: 0.2,
              }}
            >
              ⚠️
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" sx={{ color: 'warning.dark', fontWeight: 'bold', mb: 1 }}>
                Important Setup Reminder
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.primary', mb: 1.5, lineHeight: 1.4 }}>
                Make sure your <strong>Ollama is running</strong> and you have downloaded a model. 
                If you haven't installed any models yet, try these suggestions:
              </Typography>
              <Box sx={{ ml: 1 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5 }}>
                  • <strong>For high-performance computers (16GB+ RAM):</strong>
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1, fontFamily: 'monospace', fontSize: '0.85rem', ml: 2 }}>
                  ollama pull gpt-oss:20b
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5 }}>
                  • <strong>For light computers (&lt;16GB RAM):</strong>
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: '0.85rem', ml: 2 }}>
                  ollama pull mistral:7b
                </Typography>
              </Box>
            </Box>
          </Box>
          
          <Typography variant="body1" sx={{ mb: 3, color: 'text.secondary' }}>
            {progress.step}
          </Typography>
          
          <LinearProgress 
            sx={{ 
              mb: 2,
              height: 8,
              borderRadius: 4,
              '& .MuiLinearProgress-bar': {
                borderRadius: 4,
              }
            }} 
          />
          
          <Typography variant="caption" sx={{ color: 'text.disabled', mb: 2, display: 'block' }}>
            Please wait while we start all services...
          </Typography>
          
          <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.7rem', lineHeight: 1.4 }}>
            💡 Tip: To see the latest changes after loading completes, use hard refresh:
            <br />
            <strong>Ctrl+F5</strong> (Windows) or <strong>Cmd+Shift+R</strong> (Mac)
          </Typography>
        </Box>
      </Box>
    </Fade>
  );
};

export default StartupLoader;
