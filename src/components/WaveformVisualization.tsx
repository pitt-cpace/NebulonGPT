import React, { useRef, useEffect } from 'react';
import { Box } from '@mui/material';
import { VoskRecognitionService } from '../services/vosk';

interface WaveformVisualizationProps {
  voskRecognition: VoskRecognitionService | null | undefined;
  isListening: boolean;
}

// Persistent waveform data that survives component re-renders
let persistentWaveformData = new Array(180).fill(0.1);
let persistentAnimationId: number | null = null;
let persistentRealAudioLevel = 0.1;
let persistentSmoothedLevel = 0.1;
let persistentAudioLevelCallback: ((level: number) => void) | null = null;

const WaveformVisualization: React.FC<WaveformVisualizationProps> = ({
  voskRecognition,
  isListening
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !voskRecognition || !isListening) {
      // Clean up when not listening
      if (persistentAnimationId) {
        cancelAnimationFrame(persistentAnimationId);
        persistentAnimationId = null;
      }
      if (persistentAudioLevelCallback && voskRecognition) {
        voskRecognition.offAudioLevel(persistentAudioLevelCallback);
        persistentAudioLevelCallback = null;
      }
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 180;
    canvas.height = 40;

    // Only register callback if we don't have one already
    if (!persistentAudioLevelCallback) {
      persistentAudioLevelCallback = (level: number) => {
        // Scale and clamp the real audio level
        persistentRealAudioLevel = Math.max(0.05, Math.min(1.0, level * 20));
      };
      
      // Register the callback with Vosk service
      voskRecognition.onAudioLevel(persistentAudioLevelCallback);
    }

    const drawWaveform = () => {
      if (!ctx || !canvas) return;

      // Use real audio level from microphone
      const currentLevel = persistentRealAudioLevel;
      
      // Smooth the audio level for continuity (no sudden breaks)
      const smoothingFactor = 0.8;
      persistentSmoothedLevel = persistentSmoothedLevel * smoothingFactor + currentLevel * (1 - smoothingFactor);
      
      // CONTINUOUS SCROLLING: Always shift left and add new data
      // This ensures the timeline never breaks or resets
      persistentWaveformData.shift(); // Remove leftmost (oldest) data point
      persistentWaveformData.push(persistentSmoothedLevel); // Add new data point on the right
      
      // Clear canvas for redrawing (this doesn't affect data continuity)
      ctx.clearRect(0, 0, 180, 40);
      
      // Draw continuous waveform line
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.5;
      
      // Draw the waveform as a continuous line - NEVER break the line
      persistentWaveformData.forEach((level, index) => {
        const x = index;
        const centerY = 20; // Center of canvas
        const amplitude = level * 15; // Scale amplitude
        const y = centerY + Math.sin(index * 0.1) * amplitude;
        
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      ctx.stroke();
      
      // Draw filled bars for better visibility - CONTINUOUS
      persistentWaveformData.forEach((level, index) => {
        const x = index;
        const height = level * 35;
        const y = (40 - height) / 2;
        
        // Create fade effect from left to right (older to newer)
        const opacity = Math.max(0.2, (index / 180) * 0.8);
        ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
        
        ctx.fillRect(x, y, 1, height);
      });
      
      // Continue animation continuously - NEVER stop or reset
      persistentAnimationId = requestAnimationFrame(drawWaveform);
    };

    // Only start animation if not already running
    if (!persistentAnimationId) {
      drawWaveform();
    }

    // Cleanup function - only called when component unmounts or listening stops
    return () => {
      if (persistentAnimationId) {
        cancelAnimationFrame(persistentAnimationId);
        persistentAnimationId = null;
      }
      if (persistentAudioLevelCallback && voskRecognition) {
        voskRecognition.offAudioLevel(persistentAudioLevelCallback);
        persistentAudioLevelCallback = null;
      }
    };
  }, [voskRecognition, isListening]);

  return (
    <Box sx={{ 
      width: '180px', 
      height: '40px', 
      mt: 1,
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      borderRadius: '4px',
      border: '1px solid rgba(255, 255, 255, 0.2)'
    }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block'
        }}
      />
    </Box>
  );
};

export default WaveformVisualization;
