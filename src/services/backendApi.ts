import axios from 'axios';

// Helper function to detect if running in Electron
const isElectronEnvironment = (): boolean => {
  return !!(
    (window as any).isElectron || 
    (window as any).electronAPI || 
    (window as any).require ||
    (window.navigator && window.navigator.userAgent && window.navigator.userAgent.includes('Electron'))
  );
};

// Get backend URL based on how the app is being accessed
const getBackendURL = (): string => {
  const hostname = window.location.hostname;
  const port = window.location.port;
  const protocol = window.location.protocol;
  
  // Scenario 1: Electron mode (production or dev) - always use direct connection to backend
  // In Electron production, the app loads from file:// protocol, so hostname is empty
  if (isElectronEnvironment()) {
    // Use current hostname to support IP address access (127.0.0.1, 10.211.33.32, etc.)
    // Default to 'localhost' if hostname is empty (file:// protocol in Electron production)
    const electronHostname = hostname || 'localhost';
    const electronUrl = `http://${electronHostname}:3001`;
    console.log(`Using Backend URL (Electron mode): ${electronUrl}`);
    return electronUrl;
  }
  
  // Scenario 2: Check if accessing via network (not localhost/127.0.0.1)
  // This takes priority because remote devices can't reach "localhost"
  const isNetworkAccess = hostname !== 'localhost' && hostname !== '127.0.0.1' && !hostname.startsWith('192.168.') === false;
  const isRemoteIP = hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '';
  
  // For network/remote access: use the same host (HTTPS proxy handles routing)
  if (isRemoteIP) {
    const host = window.location.host; // includes hostname:port
    const networkUrl = `${protocol}//${host}`;
    console.log(`Using Backend URL (network access): ${networkUrl}`);
    return networkUrl;
  }
  
  // For localhost access, check if explicitly set via environment variable
  if (process.env.REACT_APP_BACKEND_URL) {
    console.log(`Using Backend URL from env: ${process.env.REACT_APP_BACKEND_URL}`);
    return process.env.REACT_APP_BACKEND_URL;
  }
  
  
  // Check for React development server indicators (webpack dev server)
  const hasWebpackDevServer = (
    (window as any).webpackHotUpdate !== undefined ||
    (window as any).__webpack_dev_server__ !== undefined ||
    document.querySelector('script[src*="webpack"]') !== null ||
    document.querySelector('script[src*="hot-update"]') !== null ||
    document.querySelector('script[src*="sockjs-node"]') !== null
  );
  
  // Check if this is development mode
  const isDevelopmentMode = hasWebpackDevServer || (port === '3000' && hasWebpackDevServer);
  
  // For development: use direct connection to backend on port 3001
  if (isDevelopmentMode) {
    const devUrl = 'http://localhost:3001';
    console.log(`Using Backend URL (dev mode): ${devUrl}`);
    return devUrl;
  }
  
  // For Docker/production on localhost: use current host which is proxied
  const host = window.location.host; // includes hostname:port
  const prodUrl = `${protocol}//${host}`;
  console.log(`Using Backend URL (Docker/production mode): ${prodUrl}`);
  return prodUrl;
};

// Create axios instance for backend API
const backendApi = axios.create({
  baseURL: getBackendURL(),
  headers: {
    'Content-Type': 'application/json',
  },
});

// Chat management endpoints
export const getChats = async () => {
  try {
    const response = await backendApi.get('/api/chats');
    return response.data;
  } catch (error) {
    console.error('Error fetching chats:', error);
    throw error;
  }
};

export const saveChat = async (chatId: string, chatData: any) => {
  try {
    const response = await backendApi.post(`/api/chats/${chatId}`, chatData);
    return response.data;
  } catch (error) {
    console.error('Error saving chat:', error);
    throw error;
  }
};

export const saveAllChats = async (chats: any[]) => {
  try {
    const response = await backendApi.post('/api/chats', chats);
    return response.data;
  } catch (error) {
    console.error('Error saving all chats:', error);
    throw error;
  }
};

// Vosk model management endpoints
export const getAllVoskModels = async () => {
  try {
    const response = await backendApi.get('/api/vosk/models/all');
    return response.data;
  } catch (error) {
    console.error('Error fetching Vosk models:', error);
    throw error;
  }
};

export const uploadVoskModel = async (file: File) => {
  try {
    const formData = new FormData();
    formData.append('model', file);
    
    const response = await backendApi.post('/api/vosk/models/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error uploading Vosk model:', error);
    throw error;
  }
};

export const extractVoskModel = async (modelName: string) => {
  try {
    const response = await backendApi.post(`/api/vosk/models/${modelName}/extract`);
    return response.data;
  } catch (error) {
    console.error('Error extracting Vosk model:', error);
    throw error;
  }
};

export const deleteVoskModel = async (modelName: string) => {
  try {
    const response = await backendApi.delete(`/api/vosk/models/${modelName}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting Vosk model:', error);
    throw error;
  }
};

// =============================================================================
// PDF EXTRACTION
// =============================================================================
// Calls the unified Python backend (/api/pdf/extract) which uses PyMuPDF +
// pdfplumber + Pillow to pull text, images, tables, charts, links, TOC and
// metadata from a PDF. The returned structure is designed to be dropped into
// a FileAttachment (type='pdf') and forwarded straight to the LLM.

/**
 * Per-page metadata returned by /api/pdf/extract.
 *
 * The image / figure / table arrays carry RICH per-element metadata so that
 * even text-only LLMs can reason about the document's visual structure.
 * Visuals are never capped in count — every embedded raster image, every
 * detected vector-figure region (when render_pages=true), and every
 * pdfplumber-found table is reported.
 */
export interface PdfPageData {
  page: number;
  text: string;
  tables: string[][][];
  tables_meta?: Array<{
    page?: number;
    rows: number;
    cols: number;
    bbox: [number, number, number, number] | null;
    caption: string | null;
  }>;
  images: Array<{
    index: number;
    /**
     * "embedded_image" = bitmap embedded in the PDF (photo, scanned figure).
     * "vector_figure"  = tight crop of a region containing vector drawings
     *                    (matplotlib output, schematic, etc.) — only present
     *                    when the request was made with render_pages=true.
     */
    kind?: 'embedded_image' | 'vector_figure';
    page?: number;
    bbox?: [number, number, number, number] | null;
    caption?: string | null;
    format: string;       // 'png' | 'jpeg'
    width: number;
    height: number;
    data: string;         // base64 (no data: prefix). May be "" when
                          // include_images=false (metadata-only mode).
  }>;
  charts_detected: number;
  links: string[];
}

export interface PdfExtractionResult {
  filename: string;
  metadata: Record<string, any>;
  page_count: number;
  pages: PdfPageData[];
  toc: Array<{ level: number; title: string; page: number }>;
  combined_text: string;
  llm_summary_prompt: string;
  stats: {
    total_images: number;            // count of embedded raster images
    total_vector_figures: number;    // count of rendered vector-figure crops
    total_tables: number;
    total_chars: number;
    total_charts_detected: number;
  };
}

/**
 * Extract structured content from a PDF via the backend.
 *
 * @param file           The PDF File (from <input type="file"> or drag-drop)
 * @param includeImages  When true, return base64 image payloads. When false,
 *                       still returns full per-image metadata (count, caption,
 *                       bbox, dimensions) but with empty `data` strings — so
 *                       the UI can still warn about visual content without
 *                       paying the bandwidth cost. Default true.
 * @param renderPages    When true, the backend also renders tight CROPS of
 *                       detected vector figures/charts (NOT whole pages) so
 *                       vision LLMs can analyze them. Text-only pages are
 *                       never rendered. Default false.
 */
export const extractPdf = async (
  file: File,
  includeImages: boolean = true,
  renderPages: boolean = false,
): Promise<PdfExtractionResult> => {
  try {
    const formData = new FormData();
    formData.append('file', file);

    // NOTE: there is intentionally NO max_images parameter — the backend
    // returns every visual element present in the document so the LLM has
    // a complete picture (literally) of what's in the PDF.
    const params = new URLSearchParams({
      include_images: String(includeImages),
      render_pages: String(renderPages),
    });


    const response = await backendApi.post(
      `/api/pdf/extract?${params.toString()}`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        // Allow large PDFs (text + base64 images can balloon the response)
        maxContentLength: 200 * 1024 * 1024,
        maxBodyLength: 200 * 1024 * 1024,
        timeout: 120000, // 2 minutes for very large PDFs
      },
    );
    return response.data as PdfExtractionResult;
  } catch (error) {
    console.error('Error extracting PDF:', error);
    throw error;
  }
};

// Network info endpoint
export const getNetworkInfo = async () => {

  try {
    const response = await backendApi.get('/api/network-info');
    return response.data;
  } catch (error) {
    console.error('Error fetching network info:', error);
    throw error;
  }
};

// Health check endpoint
export const checkHealth = async () => {
  try {
    const response = await backendApi.get('/health');
    return response.data;
  } catch (error) {
    console.error('Error checking backend health:', error);
    throw error;
  }
};

// TTS models check endpoint
export const checkTtsModels = async (): Promise<{ exists: boolean; path: string; dataDirectory: string; platform: string }> => {
  try {
    const response = await backendApi.get('/api/tts/models-check');
    return response.data;
  } catch (error) {
    console.error('Error checking TTS models:', error);
    // Return default values if check fails (assume exists to not block user)
    return { exists: true, path: '', dataDirectory: '', platform: '' };
  }
};

// WebSocket URL helpers
export const getVoskWebSocketURL = (): string => {
  return process.env.REACT_APP_VOSK_WS_URL || 'ws://localhost:3001/vosk';
};

export const getTTSWebSocketURL = (): string => {
  return process.env.REACT_APP_TTS_WS_URL || 'ws://localhost:3001/tts';
};

export default backendApi;
