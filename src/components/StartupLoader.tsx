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
        setTimeout(connectToVosk, 2000);
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
          setTimeout(connectToKokoro, 2000);
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
          
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            Please wait while we start all services...
          </Typography>
        </Box>
      </Box>
    </Fade>
  );
};

export default StartupLoader;
