// AudioWorklet processor for Vosk speech recognition
class VoskAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRecording = false;
    
    // Listen for messages from the main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'start') {
        this.isRecording = true;
      } else if (event.data.type === 'stop') {
        this.isRecording = false;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    if (input && input.length > 0 && this.isRecording) {
      const inputData = input[0]; // Get first channel
      
      if (inputData && inputData.length > 0) {
        // Convert float32 to int16
        const int16Array = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        
        // Send audio data to main thread
        this.port.postMessage({
          type: 'audioData',
          data: int16Array.buffer
        }, [int16Array.buffer]);
      }
    }
    
    // Keep the processor alive
    return true;
  }
}

registerProcessor('vosk-audio-processor', VoskAudioProcessor);
