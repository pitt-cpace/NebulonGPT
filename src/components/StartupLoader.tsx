import React, { useState, useEffect } from 'react';
import { Box, Typography, LinearProgress, Fade, IconButton, Collapse } from '@mui/material';
import { ExpandMore, ExpandLess, Close } from '@mui/icons-material';
import { getWebSocketUrls } from '../services/electronApi';
import { drawerWidth } from '../styles/components/Sidebar.styles';

interface StartupProgress {
  step: string;
  status: string;
  timestamp: string;
  completed: boolean;
}

interface StartupLoaderProps {
  onComplete?: () => void;
  sidebarOpen?: boolean;
}

const StartupLoader: React.FC<StartupLoaderProps> = ({ onComplete, sidebarOpen = true }) => {
  const [progress, setProgress] = useState<StartupProgress | null>(null);
  const [show, setShow] = useState(true); // Start with showing the loader
  const [hasChecked, setHasChecked] = useState(false);
  const [isStartupComplete, setIsStartupComplete] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
        const { vosk } = getWebSocketUrls();
        console.log('🎤 Connecting to Vosk at:', vosk);
        
        voskWs = new WebSocket(vosk);
        
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
        const { tts } = getWebSocketUrls();
        console.log('🔊 Connecting to Kokoro at:', tts);
        
        kokoroWs = new WebSocket(tts);
        
        kokoroWs.onopen = () => {
          console.log('🔊 Kokoro WebSocket connected');
          kokoroConnected = true;
          checkAllServicesReady();
        };
        
        kokoroWs.onclose = () => {
          console.log('🔊 Kokoro WebSocket disconnected');
          kokoroConnected = false;
          // Show loader when service disconnects
          //showLoader("Reconnecting to text-to-speech...", "reconnecting");
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
          top: 56, // Below the header bar
          left: sidebarOpen ? drawerWidth : 0, // Adjust based on sidebar state
          right: 0,
          zIndex: 1200, // Below sidebar z-index but above content
          background: 'linear-gradient(135deg, #1a237e 0%, #3949ab 50%, #5c6bc0 100%)',
          boxShadow: '0 2px 12px rgba(0, 0, 0, 0.3)',
          transition: 'left 0.3s ease-in-out', // Smooth transition when sidebar opens/closes
        }}
      >
        {/* Main Tape/Banner Content */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            gap: 2,
          }}
        >
          {/* Left Section - Logo and Status */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
            <Typography 
              variant="body1" 
              sx={{ 
                color: 'white', 
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                whiteSpace: 'nowrap',
              }}
            >
              🚀 NebulonGPT
            </Typography>
            
            {/* Progress Bar */}
            <Box sx={{ flex: 1, maxWidth: 300, minWidth: 100 }}>
              <LinearProgress 
                sx={{ 
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 3,
                    backgroundColor: '#4caf50',
                  }
                }} 
              />
            </Box>
            
            {/* Status Message */}
            <Typography 
              variant="body2" 
              sx={{ 
                color: 'rgba(255, 255, 255, 0.9)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 300,
              }}
            >
              {progress.step}
            </Typography>
          </Box>

          {/* Right Section - Actions */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton 
              size="small" 
              onClick={() => setExpanded(!expanded)}
              sx={{ 
                color: 'white',
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.1)' }
              }}
            >
              {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
            </IconButton>
            <IconButton 
              size="small" 
              onClick={() => setShow(false)}
              sx={{ 
                color: 'white',
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.1)' }
              }}
            >
              <Close fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        {/* Expandable Details Section */}
        <Collapse in={expanded}>
          <Box
            sx={{
              backgroundColor: 'rgba(0, 0, 0, 0.2)',
              padding: '12px 16px',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            {/* Yellow warning message about Ollama and models */}
            <Box
              sx={{
                backgroundColor: 'rgba(255, 193, 7, 0.9)',
                borderRadius: 1,
                padding: 1.5,
                mb: 1.5,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
              }}
            >
              <Box sx={{ color: '#f57c00', fontSize: '1rem', mt: 0.1 }}>⚠️</Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ color: '#e65100', fontWeight: 'bold', mb: 0.5, fontSize: '0.8rem' }}>
                  Important Setup Reminder
                </Typography>
                <Typography variant="body2" sx={{ color: '#333', fontSize: '0.75rem', lineHeight: 1.4 }}>
                  Make sure your <strong>Ollama is running</strong> and you have downloaded a model.
                </Typography>
                <Box sx={{ display: 'flex', gap: 3, mt: 1, flexWrap: 'wrap' }}>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#555', fontSize: '0.7rem' }}>
                      High-performance (16GB+ RAM):
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#333', fontFamily: 'monospace', fontSize: '0.7rem', display: 'block' }}>
                      ollama pull gpt-oss:20b
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#555', fontSize: '0.7rem' }}>
                      Light computers (&lt;16GB RAM):
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#333', fontFamily: 'monospace', fontSize: '0.7rem', display: 'block' }}>
                      ollama pull mistral:7b
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Box>

            {/* Tips */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.7rem' }}>
                💡 Hard refresh after loading: <strong>Ctrl+F5</strong> (Win) / <strong>Cmd+Shift+R</strong> (Mac)
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.65rem', fontStyle: 'italic' }}>
                First time may take 5~10 min for model extraction.
              </Typography>
            </Box>
          </Box>
        </Collapse>
      </Box>
    </Fade>
  );
};

export default StartupLoader;
