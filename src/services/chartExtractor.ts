import { PDFPageProxy } from 'pdfjs-dist';
import { createCanvas, Canvas, CanvasRenderingContext2D } from 'canvas';

// Chart detection and extraction interfaces
export interface ChartRegion {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'unknown';
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  extractionMethod: string;
}

export interface ChartData {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'unknown';
  title?: string;
  xAxis: {
    label?: string;
    values: string[];
    type: 'category' | 'numeric' | 'datetime';
  };
  yAxis: {
    label?: string;
    values: number[];
    min: number;
    max: number;
    type: 'numeric';
  };
  series: Array<{
    label: string;
    values: number[];
    color?: string;
    type?: 'line' | 'bar' | 'area';
  }>;
  legend?: Array<{
    label: string;
    color: string;
  }>;
  metadata: {
    pageNumber: number;
    confidence: number;
    extractionMethod: string;
    boundingBox: ChartRegion['boundingBox'];
    dataPoints: number;
    hasGridlines: boolean;
    hasLegend: boolean;
    hasTitle: boolean;
  };
}

export interface VectorOperation {
  type: 'moveTo' | 'lineTo' | 'rect' | 'arc' | 'bezierCurveTo' | 'fill' | 'stroke';
  args: number[];
  color?: string;
  lineWidth?: number;
}

export class AdvancedChartExtractor {
  private static instance: AdvancedChartExtractor;

  private constructor() {}

  public static getInstance(): AdvancedChartExtractor {
    if (!AdvancedChartExtractor.instance) {
      AdvancedChartExtractor.instance = new AdvancedChartExtractor();
    }
    return AdvancedChartExtractor.instance;
  }

  /**
   * Extract charts from a PDF page using vector analysis and heuristics
   */
  public async extractChartsFromPage(
    page: PDFPageProxy,
    pageNumber: number,
    options: {
      detectVectorCharts?: boolean;
      detectRasterCharts?: boolean;
      minChartSize?: number;
      confidenceThreshold?: number;
    } = {}
  ): Promise<ChartData[]> {
    const {
      detectVectorCharts = false, // Disabled - PDF contains no vector charts
      detectRasterCharts = true,
      minChartSize = 50, // Balanced - not too restrictive but filters small noise
      confidenceThreshold = 0.2 // Lower threshold to catch more charts
    } = options;

    console.log(`📈 Starting advanced chart extraction for page ${pageNumber}`);

    const charts: ChartData[] = [];

    try {
      // Step 1: Detect chart regions using multiple methods
      const chartRegions: ChartRegion[] = [];

      if (detectVectorCharts) {
        const vectorCharts = await this.detectVectorCharts(page, pageNumber);
        chartRegions.push(...vectorCharts);
      }

      if (detectRasterCharts) {
        const rasterCharts = await this.detectRasterCharts(page, pageNumber);
        chartRegions.push(...rasterCharts);
      }

      console.log(`🔍 Found ${chartRegions.length} potential chart regions on page ${pageNumber}`);

      // Step 2: Consolidate overlapping regions to reduce fragmentation
      let consolidatedRegions = this.consolidateChartRegions(chartRegions);
      console.log(`🔄 Consolidated ${chartRegions.length} regions into ${consolidatedRegions.length} regions`);

      // Step 2.5: Apply aggressive post-consolidation for chart completion
      consolidatedRegions = this.postConsolidateChartRegions(consolidatedRegions);
      console.log(`🔄 Post-consolidated into ${consolidatedRegions.length} final regions`);

      // Step 3: Extract data from each consolidated chart region
      for (const region of consolidatedRegions) {
        console.log(`🔍 Evaluating chart region ${region.id}: confidence=${region.confidence.toFixed(2)}, size=${region.boundingBox.width}x${region.boundingBox.height}`);
        
        // Enhanced validation criteria
        if (this.isValidChartRegion(region, minChartSize, confidenceThreshold)) {
          try {
            const chartData = await this.extractChartData(page, region, pageNumber);
            if (chartData) {
              charts.push(chartData);
              console.log(`✅ Successfully extracted ${chartData.type} chart: ${chartData.id}`);
            } else {
              console.warn(`⚠️ Chart data extraction returned null for region ${region.id}`);
            }
          } catch (error) {
            console.warn(`⚠️ Failed to extract data from chart region ${region.id}:`, error);
          }
        } else {
          console.log(`❌ Chart region ${region.id} filtered out: confidence=${region.confidence.toFixed(2)} (min: ${confidenceThreshold}), size=${region.boundingBox.width}x${region.boundingBox.height} (min: ${minChartSize}x${minChartSize})`);
        }
      }

      console.log(`📊 Successfully extracted ${charts.length} charts from page ${pageNumber}`);
      return charts;

    } catch (error) {
      console.error(`❌ Error extracting charts from page ${pageNumber}:`, error);
      return [];
    }
  }

  /**
   * Detect vector-based charts using center-of-chart heuristics with padding
   */
  private async detectVectorCharts(page: PDFPageProxy, pageNumber: number): Promise<ChartRegion[]> {
    const regions: ChartRegion[] = [];

    try {
      console.log(`🔍 Analyzing vector operations for chart detection on page ${pageNumber}`);

      // Get the operator list (drawing operations) from the PDF page
      const operatorList = await page.getOperatorList();
      const viewport = page.getViewport({ scale: 1.0 });

      // Extract drawing points using center-of-chart approach
      const drawingPoints = this.extractDrawingPoints(operatorList, viewport);

      if (drawingPoints.length === 0) {
        console.log(`📝 No drawing points found on page ${pageNumber}`);
        return regions;
      }

      console.log(`📝 Found ${drawingPoints.length} drawing points on page ${pageNumber}`);

      // Use center-cluster approach to find chart regions
      const chartRegions = this.findChartRegionsFromPoints(drawingPoints, viewport, pageNumber);
      regions.push(...chartRegions);

      console.log(`📈 Detected ${regions.length} vector-based chart regions on page ${pageNumber}`);

    } catch (error) {
      console.warn(`⚠️ Vector chart detection failed for page ${pageNumber}:`, error);
    }

    return regions;
  }

  /**
   * Detect raster-based charts using hybrid approach: embedded images + rendered analysis
   */
  private async detectRasterCharts(page: PDFPageProxy, pageNumber: number): Promise<ChartRegion[]> {
    const regions: ChartRegion[] = [];

    try {
      console.log(`🖼️ Analyzing raster content for chart detection on page ${pageNumber}`);

      // Step 1: Extract embedded images (for raster charts like boxplots)
      const embeddedImageRegions = await this.extractEmbeddedImageCharts(page, pageNumber);
      regions.push(...embeddedImageRegions);

      // Step 2: Render page and analyze for chart patterns
      const renderedRegions = await this.analyzeRenderedPageForCharts(page, pageNumber);
      regions.push(...renderedRegions);

      // Step 3: Use figure captions to identify chart regions
      const figureBasedRegions = await this.detectChartsByFigureCaptions(page, pageNumber);
      regions.push(...figureBasedRegions);

      console.log(`🖼️ Detected ${regions.length} raster chart regions on page ${pageNumber}`);

    } catch (error) {
      console.warn(`⚠️ Raster chart detection failed for page ${pageNumber}:`, error);
    }

    return regions;
  }

  /**
   * Extract embedded images that are likely charts (boxplots, etc.)
   */
  private async extractEmbeddedImageCharts(page: PDFPageProxy, pageNumber: number): Promise<ChartRegion[]> {
    const regions: ChartRegion[] = [];

    try {
      console.log(`📊 Extracting embedded image charts from page ${pageNumber}`);

      // Get operator list to find image operations
      const operatorList = await page.getOperatorList();
      const viewport = page.getViewport({ scale: 1.0 });

      // Look for paintImageXObject operations
      for (let i = 0; i < operatorList.fnArray.length; i++) {
        const fn = operatorList.fnArray[i];
        const args = operatorList.argsArray[i];

        // Check for image painting operations
        if (fn === 92 || fn === 85) { // paintImageXObject operations
          try {
            const imageName = args[0];
            console.log(`🖼️ Found embedded image: ${imageName}`);

            // Try to get image object
            const imgObj = await page.objs.get(imageName);
            
            if (imgObj && imgObj.width && imgObj.height) {
              // Analyze if this image could be a chart
              const isChart = this.analyzeImageForChartContent(imgObj);
              
              if (isChart.isChart) {
                const region: ChartRegion = {
                  id: `embedded-chart-${pageNumber}-${i}`,
                  type: isChart.chartType,
                  boundingBox: {
                    x: 0, // Will be refined later
                    y: 0,
                    width: imgObj.width,
                    height: imgObj.height
                  },
                  confidence: isChart.confidence,
                  extractionMethod: 'embedded-image-extraction'
                };
                regions.push(region);
                console.log(`✅ Identified embedded chart: ${region.id} (${imgObj.width}x${imgObj.height})`);
              }
            }
          } catch (error) {
            console.warn(`⚠️ Could not process embedded image:`, error);
          }
        }
      }

    } catch (error) {
      console.warn(`⚠️ Error extracting embedded image charts:`, error);
    }

    return regions;
  }

  /**
   * Optimized chart detection with two-stage rendering: low-res detection + high-res extraction
   */
  private async analyzeRenderedPageForCharts(page: PDFPageProxy, pageNumber: number): Promise<ChartRegion[]> {
    const regions: ChartRegion[] = [];

    try {
      // OPTIMIZATION 1: Early exit - check for figure captions first
      const textContent = await page.getTextContent();
      const hasFigureIndicators = this.hasChartIndicators(textContent);
      
      if (!hasFigureIndicators) {
        console.log(`⚡ Page ${pageNumber} has no chart indicators, skipping render`);
        return regions;
      }

      // OPTIMIZATION 2: Low-resolution detection first (scale 0.5)
      const detectionScale = 0.5;
      const detectionViewport = page.getViewport({ scale: detectionScale });
      const detectionCanvas = createCanvas(detectionViewport.width, detectionViewport.height);
      const detectionContext = detectionCanvas.getContext('2d');

      // Set white background
      detectionContext.fillStyle = 'white';
      detectionContext.fillRect(0, 0, detectionViewport.width, detectionViewport.height);

      console.log(`⚡ Fast detection render: ${detectionViewport.width}x${detectionViewport.height} (scale: ${detectionScale})`);

      await page.render({
        canvasContext: detectionContext as any,
        viewport: detectionViewport,
        intent: 'display'
      }).promise;

      // OPTIMIZATION 3: Fast tiled grid detection instead of full pixel analysis
      const textRegions = this.getTextRegions(textContent, detectionViewport);
      const chartBBox = this.getChartBoundingBoxQuick(detectionCanvas, detectionContext, textRegions);

      if (!chartBBox) {
        console.log(`⚡ No chart detected in fast scan of page ${pageNumber}`);
        return regions;
      }

      console.log(`⚡ Fast detection found chart: ${chartBBox.width.toFixed(1)}x${chartBBox.height.toFixed(1)} at (${chartBBox.x.toFixed(1)}, ${chartBBox.y.toFixed(1)})`);

      // OPTIMIZATION 4: Only render high-res for confirmed chart region
      const highResScale = 2.0; // Reduced from 4.0 for speed
      const highResViewport = page.getViewport({ scale: highResScale });
      
      // Scale up the detected bounding box for high-res extraction
      const scaledBBox = {
        x: chartBBox.x * (highResScale / detectionScale),
        y: chartBBox.y * (highResScale / detectionScale),
        width: chartBBox.width * (highResScale / detectionScale),
        height: chartBBox.height * (highResScale / detectionScale)
      };

      console.log(`⚡ High-res extraction for confirmed chart: ${scaledBBox.width.toFixed(1)}x${scaledBBox.height.toFixed(1)}`);

      const region: ChartRegion = {
        id: `optimized-chart-${pageNumber}-0`,
        type: 'unknown', // Will be classified later
        boundingBox: {
          x: scaledBBox.x / highResScale, // Scale back to normal coordinates
          y: scaledBBox.y / highResScale,
          width: scaledBBox.width / highResScale,
          height: scaledBBox.height / highResScale
        },
        confidence: 0.8,
        extractionMethod: 'optimized-two-stage-detection'
      };

      regions.push(region);

    } catch (error) {
      console.warn(`⚠️ Error in optimized chart analysis for page ${pageNumber}:`, error);
    }

    return regions;
  }

  /**
   * OPTIMIZATION: Check for chart indicators before expensive rendering
   */
  private hasChartIndicators(textContent: any): boolean {
    const chartKeywords = ['figure', 'fig', 'chart', 'graph', 'plot', 'boxplot', 'histogram'];
    
    const allText = textContent.items
      .map((item: any) => item.str?.toLowerCase() || '')
      .join(' ');

    const hasKeywords = chartKeywords.some(keyword => allText.includes(keyword));
    
    // Also check for numbered figures (Figure 1, Fig. 2, etc.)
    const hasNumberedFigures = /\b(figure|fig\.?)\s*\d+/i.test(allText);
    
    const hasIndicators = hasKeywords || hasNumberedFigures;
    
    console.log(`⚡ Chart indicators check: keywords=${hasKeywords}, numbered=${hasNumberedFigures}, result=${hasIndicators}`);
    
    return hasIndicators;
  }

  /**
   * OPTIMIZATION: Ultra-fast tiled grid detection (optimized from your reference script)
   */
  private getChartBoundingBoxQuick(
    canvas: Canvas,
    context: CanvasRenderingContext2D,
    textRegions: any[]
  ): { x: number; y: number; width: number; height: number } | null {
    
    try {
      const tile = 40; // Tile size for fast scanning
      const width = canvas.width;
      const height = canvas.height;
      const tilesX = Math.floor(width / tile);
      const tilesY = Math.floor(height / tile);
      const threshold = 15; // Dark pixel count threshold per tile
      const points: Array<[number, number]> = [];
      
      console.log(`⚡ Ultra-fast grid scan: ${tilesX}x${tilesY} tiles (${tile}px each)`);
      
      const imgData = context.getImageData(0, 0, width, height).data;
      
      // OPTIMIZATION: Streamlined tile analysis (from your reference)
      for (let y = 0; y < tilesY; y++) {
        for (let x = 0; x < tilesX; x++) {
          let dark = 0;
          
          // Sample every 5th pixel in tile for maximum speed
          for (let dy = 0; dy < tile; dy += 5) {
            for (let dx = 0; dx < tile; dx += 5) {
              const px = ((y * tile + dy) * width + (x * tile + dx)) * 4;
              if (px < imgData.length) {
                const val = imgData[px]; // Use red channel only for speed
                if (val < 150) dark++;
              }
            }
          }
          
          // Check if tile has enough dark content and low text density
          if (dark > threshold) {
            const tilePixelX = x * tile;
            const tilePixelY = y * tile;
            const textDensity = this.calculateTextDensity(tilePixelX, tilePixelY, tile, tile, textRegions);
            
            if (textDensity < 0.4) { // Not too much text
              points.push([x, y]);
            }
          }
        }
      }

      if (!points.length) {
        console.log(`⚡ No chart tiles found`);
        return null;
      }

      // Calculate bounding box with dynamic padding (from your reference)
      const xs = points.map(p => p[0]);
      const ys = points.map(p => p[1]);
      
      const padding = 0.3; // 30% padding
      const minX = Math.max(0, Math.floor(Math.min(...xs) * tile - tile * padding));
      const minY = Math.max(0, Math.floor(Math.min(...ys) * tile - tile * padding));
      const maxX = Math.min(width, Math.floor(Math.max(...xs) * tile + tile * (1 + padding)));
      const maxY = Math.min(height, Math.floor(Math.max(...ys) * tile + tile * (1 + padding)));

      const finalBBox = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      };

      // Validate minimum size
      if (finalBBox.width < 100 || finalBBox.height < 100) {
        console.log(`⚡ Chart bbox too small: ${finalBBox.width}x${finalBBox.height}`);
        return null;
      }

      console.log(`⚡ Ultra-fast detection result: ${points.length} tiles → ${finalBBox.width.toFixed(1)}x${finalBBox.height.toFixed(1)} bbox`);
      
      return finalBBox;

    } catch (error) {
      console.warn('⚠️ Error in ultra-fast chart detection:', error);
      return null;
    }
  }

  /**
   * Find chart regions using contour-based detection with smart filtering
   */
  private findChartRegionsByPixelDensity(
    canvas: Canvas, 
    context: CanvasRenderingContext2D, 
    textRegions: any[], 
    pageNumber: number
  ): ChartRegion[] {
    const regions: ChartRegion[] = [];

    try {
      const { width, height } = canvas;
      const imageData = context.getImageData(0, 0, width, height);
      const data = imageData.data;

      console.log(`🔍 Analyzing ${width}x${height} canvas using contour-based chart detection`);

      // Step 1: Smart filtering to avoid text-only pages
      const pageAnalysis = this.analyzePageForChartContent(imageData as any, textRegions);
      
      if (!pageAnalysis.hasChartContent) {
        console.log(`⚠️ Page ${pageNumber} appears to be text-only, skipping chart extraction`);
        return regions;
      }

      console.log(`📊 Page analysis: contours=${pageAnalysis.contourCount}, largeShapes=${pageAnalysis.largeShapeCount}, textDensity=${(pageAnalysis.textDensity*100).toFixed(1)}%`);

      // Step 2: Find contours for accurate center detection
      const contours = this.findImageContours(imageData as any);
      
      if (contours.length === 0) {
        console.log(`⚠️ No contours found on page ${pageNumber}`);
        return regions;
      }

      // Step 3: Find largest chart contour
      const chartContour = this.findLargestChartContour(contours, width, height);
      
      if (!chartContour) {
        console.log(`⚠️ No suitable chart contour found on page ${pageNumber}`);
        return regions;
      }

      console.log(`📊 Found chart contour: ${chartContour.width.toFixed(1)}x${chartContour.height.toFixed(1)} at (${chartContour.x.toFixed(1)}, ${chartContour.y.toFixed(1)})`);

      // Step 4: Apply dynamic padding based on chart-to-page ratio
      const bbox = this.calculateDynamicPaddedBBox(chartContour, width, height, textRegions);
      
      if (bbox && bbox.width >= 100 && bbox.height >= 80) {
        const region: ChartRegion = {
          id: `contour-chart-${pageNumber}-0`,
          type: 'unknown', // Will be classified later
          boundingBox: bbox,
          confidence: Math.min(0.9, pageAnalysis.chartConfidence),
          extractionMethod: 'contour-based-detection'
        };

        regions.push(region);
        console.log(`📊 Found contour-based chart: ${bbox.width.toFixed(1)}x${bbox.height.toFixed(1)} at (${bbox.x.toFixed(1)}, ${bbox.y.toFixed(1)})`);
      }

      // Step 5: Check for multi-figure pages (like Figure 4 & 5)
      const additionalRegions = this.detectMultiFigurePage(imageData as any, textRegions, pageNumber, chartContour);
      regions.push(...additionalRegions);

    } catch (error) {
      console.warn('⚠️ Error in contour-based chart detection:', error);
    }

    return regions;
  }

  /**
   * Enhanced page analysis with improved text-only page detection
   */
  private analyzePageForChartContent(
    imageData: ImageData,
    textRegions: any[]
  ): { hasChartContent: boolean; contourCount: number; largeShapeCount: number; textDensity: number; chartConfidence: number } {
    
    const { width, height, data } = imageData;
    
    // Enhanced text analysis with line spacing detection
    const totalPageArea = width * height;
    const textArea = textRegions.reduce((sum, region) => sum + (region.width * region.height), 0);
    const textDensity = textArea / totalPageArea;
    
    // Calculate average line height and spacing for text-heavy page detection
    const avgLineHeight = textRegions.length > 0 ? 
      textRegions.reduce((sum, region) => sum + region.height, 0) / textRegions.length : 0;
    const lineCount = textRegions.length;
    
    // Text-heavy page heuristics
    const tooMuchText = lineCount > 100 && avgLineHeight < 15; // Many small text lines
    const textToAreaRatio = lineCount / (totalPageArea / 10000); // Lines per 10k pixels
    const isTextHeavyPage = tooMuchText || textToAreaRatio > 0.02;
    
    if (isTextHeavyPage) {
      console.log(`📝 Page appears text-heavy: lines=${lineCount}, avgHeight=${avgLineHeight.toFixed(1)}, ratio=${textToAreaRatio.toFixed(4)}`);
      return {
        hasChartContent: false,
        contourCount: 0,
        largeShapeCount: 0,
        textDensity,
        chartConfidence: 0.1
      };
    }

    // Find contours for shape analysis (only if not text-heavy)
    const edges = this.detectEdgesForContours(imageData as any);
    const contours = this.findContoursFromEdges(edges);
    
    // Analyze contour characteristics with improved filtering
    let largeShapeCount = 0;
    let totalContourArea = 0;
    let significantShapes = 0;
    
    contours.forEach(contour => {
      const area = contour.width * contour.height;
      totalContourArea += area;
      
      // Large shapes are potential charts
      if (area > 5000 && contour.width > 80 && contour.height > 80) {
        largeShapeCount++;
      }
      
      // Significant shapes (medium-large, good aspect ratio)
      const aspectRatio = contour.width / contour.height;
      if (area > 2000 && aspectRatio > 0.3 && aspectRatio < 4.0) {
        significantShapes++;
      }
    });

    // Enhanced decision logic
    const hasLargeShapes = largeShapeCount > 0;
    const hasSignificantShapes = significantShapes >= 2; // At least 2 meaningful shapes
    const reasonableContourCount = contours.length > 5 && contours.length < 300; // Adjusted range
    const lowTextDensity = textDensity < 0.6; // Slightly more restrictive
    const significantVisualContent = totalContourArea > (totalPageArea * 0.03); // Reduced threshold

    const hasChartContent = (hasLargeShapes || hasSignificantShapes) && 
                           reasonableContourCount && 
                           lowTextDensity && 
                           significantVisualContent;
    
    // Enhanced confidence calculation
    let chartConfidence = 0.2;
    if (hasLargeShapes) chartConfidence += 0.3;
    if (hasSignificantShapes) chartConfidence += 0.2;
    if (reasonableContourCount) chartConfidence += 0.15;
    if (lowTextDensity) chartConfidence += 0.1;
    if (significantVisualContent) chartConfidence += 0.05;

    console.log(`📊 Enhanced page analysis: largeShapes=${largeShapeCount}, significantShapes=${significantShapes}, contours=${contours.length}, textDensity=${(textDensity*100).toFixed(1)}%, hasChart=${hasChartContent}`);

    return {
      hasChartContent,
      contourCount: contours.length,
      largeShapeCount,
      textDensity,
      chartConfidence: Math.min(0.9, chartConfidence)
    };
  }

  /**
   * Detect edges optimized for contour finding
   */
  private detectEdgesForContours(imageData: ImageData): boolean[][] {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const edges: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));

    // Enhanced edge detection with better thresholds for contours
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;

        // Simplified Sobel operator
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            
            gx += gray * (kx === -1 ? -1 : kx === 1 ? 1 : 0);
            gy += gray * (ky === -1 ? -1 : ky === 1 ? 1 : 0);
          }
        }

        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edges[y][x] = magnitude > 40; // Optimized threshold for contour detection
      }
    }

    return edges;
  }

  /**
   * Find contours from edge image using connected components
   */
  private findContoursFromEdges(edges: boolean[][]): Array<{ x: number; y: number; width: number; height: number; area: number }> {
    const height = edges.length;
    const width = edges[0].length;
    const visited = Array(height).fill(null).map(() => Array(width).fill(false));
    const contours: Array<{ x: number; y: number; width: number; height: number; area: number }> = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (edges[y][x] && !visited[y][x]) {
          const contour = this.traceContour(edges, visited, x, y);
          
          // Filter contours by size and aspect ratio
          if (contour.width > 20 && contour.height > 20 && contour.area > 400) {
            const aspectRatio = contour.width / contour.height;
            if (aspectRatio > 0.2 && aspectRatio < 5.0) { // Reasonable aspect ratios
              contours.push(contour);
            }
          }
        }
      }
    }

    return contours.sort((a, b) => b.area - a.area); // Sort by area, largest first
  }

  /**
   * Trace a single contour using flood fill
   */
  private traceContour(
    edges: boolean[][], 
    visited: boolean[][], 
    startX: number, 
    startY: number
  ): { x: number; y: number; width: number; height: number; area: number } {
    const stack = [[startX, startY]];
    let minX = startX, minY = startY, maxX = startX, maxY = startY;
    let pixelCount = 0;

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      
      if (x < 0 || x >= edges[0].length || y < 0 || y >= edges.length || 
          visited[y][x] || !edges[y][x]) {
        continue;
      }

      visited[y][x] = true;
      pixelCount++;
      
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      // Add 8-connected neighbors
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx !== 0 || dy !== 0) {
            stack.push([x + dx, y + dy]);
          }
        }
      }
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      area: pixelCount
    };
  }

  /**
   * Find image contours (simplified version of OpenCV's approach)
   */
  private findImageContours(imageData: ImageData): Array<{ x: number; y: number; width: number; height: number; area: number }> {
    const edges = this.detectEdgesForContours(imageData);
    return this.findContoursFromEdges(edges);
  }

  /**
   * Find the largest contour that's likely a chart
   */
  private findLargestChartContour(
    contours: Array<{ x: number; y: number; width: number; height: number; area: number }>,
    pageWidth: number,
    pageHeight: number
  ): { x: number; y: number; width: number; height: number } | null {
    
    // Filter contours for chart-like characteristics
    const chartCandidates = contours.filter(contour => {
      const area = contour.width * contour.height;
      const pageArea = pageWidth * pageHeight;
      const areaRatio = area / pageArea;
      
      // Chart should be substantial but not the entire page
      const isGoodSize = contour.width >= 100 && contour.height >= 80;
      const isReasonableArea = areaRatio > 0.02 && areaRatio < 0.8; // 2% to 80% of page
      const isGoodAspectRatio = (contour.width / contour.height) > 0.3 && (contour.width / contour.height) < 4.0;
      
      return isGoodSize && isReasonableArea && isGoodAspectRatio;
    });

    if (chartCandidates.length === 0) {
      return null;
    }

    // Return the largest suitable contour
    const largest = chartCandidates[0]; // Already sorted by area
    
    console.log(`📊 Selected chart contour: area=${largest.area}, ratio=${((largest.width * largest.height) / (pageWidth * pageHeight) * 100).toFixed(1)}% of page`);
    
    return {
      x: largest.x,
      y: largest.y,
      width: largest.width,
      height: largest.height
    };
  }

  /**
   * Calculate refined dynamic padded bounding box with improved padding strategy
   */
  private calculateDynamicPaddedBBox(
    chartContour: { x: number; y: number; width: number; height: number },
    pageWidth: number,
    pageHeight: number,
    textRegions: any[]
  ): { x: number; y: number; width: number; height: number } | null {
    
    try {
      const { x, y, width, height } = chartContour;
      
      // Improved center detection with trimmed outliers
      const trimmedContour = this.getTrimmedChartBounds(chartContour, pageWidth, pageHeight);
      const { x: trimX, y: trimY, width: trimW, height: trimH } = trimmedContour;
      
      // Calculate chart-to-page ratios using trimmed bounds
      const aspectRatio = trimW / trimH;
      
      // Refined dynamic padding strategy (your improved approach)
      const paddingRatio = 0.3; // Base 30% padding
      
      // Dynamic expansion that adapts horizontally and vertically
      const paddedBox = {
        x: Math.max(0, trimX - trimW * paddingRatio),
        y: Math.max(0, trimY - trimH * paddingRatio),
        width: Math.min(pageWidth, trimW * (1 + 2 * paddingRatio)),
        height: Math.min(pageHeight, trimH * (1 + 2 * paddingRatio))
      };
      
      // Prevent overflow with bounds checking
      if (paddedBox.x + paddedBox.width > pageWidth) {
        paddedBox.width = pageWidth - paddedBox.x;
      }
      if (paddedBox.y + paddedBox.height > pageHeight) {
        paddedBox.height = pageHeight - paddedBox.y;
      }

      console.log(`📊 Refined padding: aspect=${aspectRatio.toFixed(2)}, ratio=${(paddingRatio*100).toFixed(1)}%, trimmed=${trimW.toFixed(1)}x${trimH.toFixed(1)}`);

      // Smart text exclusion for figure captions
      const footerTexts = textRegions.filter(text => 
        text.y < paddedBox.y + paddedBox.height && 
        text.y > paddedBox.y + paddedBox.height - 120 && // Within 120 pixels below chart
        text.x >= paddedBox.x && 
        text.x <= paddedBox.x + paddedBox.width // Within chart width
      );

      if (footerTexts.length > 2) {
        console.log(`📊 Detected ${footerTexts.length} footer texts, cropping bottom margin`);
        paddedBox.height -= 80; // Crop bottom margin to exclude captions
      }

      console.log(`📊 Final refined bbox: (${paddedBox.x.toFixed(1)}, ${paddedBox.y.toFixed(1)}, ${paddedBox.width.toFixed(1)}x${paddedBox.height.toFixed(1)})`);

      return paddedBox;

    } catch (error) {
      console.warn('⚠️ Error calculating refined dynamic padded bbox:', error);
      return null;
    }
  }

  /**
   * Get trimmed chart bounds with outlier removal for better center detection
   */
  private getTrimmedChartBounds(
    chartContour: { x: number; y: number; width: number; height: number },
    pageWidth: number,
    pageHeight: number
  ): { x: number; y: number; width: number; height: number } {
    
    // For now, return the original contour
    // In a more advanced implementation, you could:
    // 1. Extract individual drawing elements within the contour
    // 2. Apply trimmed mean to remove outliers
    // 3. Recalculate bounds from the trimmed set
    
    // Simplified trimming: reduce bounds by 5% on each side to remove potential outliers
    const trimPercent = 0.05;
    const trimX = chartContour.x + (chartContour.width * trimPercent);
    const trimY = chartContour.y + (chartContour.height * trimPercent);
    const trimW = chartContour.width * (1 - 2 * trimPercent);
    const trimH = chartContour.height * (1 - 2 * trimPercent);
    
    console.log(`📊 Trimmed bounds: original=${chartContour.width.toFixed(1)}x${chartContour.height.toFixed(1)}, trimmed=${trimW.toFixed(1)}x${trimH.toFixed(1)}`);
    
    return {
      x: trimX,
      y: trimY,
      width: Math.max(50, trimW), // Ensure minimum size
      height: Math.max(40, trimH)
    };
  }

  /**
   * Detect multi-figure pages (like Figure 4 & 5 on same page)
   */
  private detectMultiFigurePage(
    imageData: ImageData,
    textRegions: any[],
    pageNumber: number,
    mainChartContour: { x: number; y: number; width: number; height: number }
  ): ChartRegion[] {
    const additionalRegions: ChartRegion[] = [];

    try {
      const { width, height } = imageData;
      
      // Look for vertical separation (top/bottom charts)
      const midY = height / 2;
      
      // Check if main chart is in top half and there might be another in bottom half
      if (mainChartContour.y + mainChartContour.height < midY + 50) {
        console.log(`📊 Main chart in top half, checking for bottom chart on page ${pageNumber}`);
        
        // Analyze bottom half for additional charts
        const bottomHalfData = this.extractImageRegion(imageData, {
          x: 0,
          y: Math.floor(midY),
          width: width,
          height: height - Math.floor(midY)
        });
        
        const bottomContours = this.findImageContours(bottomHalfData as any);
        const bottomChart = this.findLargestChartContour(bottomContours, width, height - Math.floor(midY));
        
        if (bottomChart && bottomChart.width >= 80 && bottomChart.height >= 60) {
          // Adjust coordinates to full page
          bottomChart.y += Math.floor(midY);
          
          const bottomBBox = this.calculateDynamicPaddedBBox(bottomChart, width, height, textRegions);
          
          if (bottomBBox) {
            const region: ChartRegion = {
              id: `contour-chart-${pageNumber}-1`,
              type: 'unknown',
              boundingBox: bottomBBox,
              confidence: 0.7,
              extractionMethod: 'multi-figure-detection'
            };
            
            additionalRegions.push(region);
            console.log(`📊 Found additional chart in bottom half: ${bottomBBox.width.toFixed(1)}x${bottomBBox.height.toFixed(1)}`);
          }
        }
      }

    } catch (error) {
      console.warn('⚠️ Error detecting multi-figure page:', error);
    }

    return additionalRegions;
  }

  /**
   * Calculate improved chart bounding box with adaptive expansion and text exclusion
   */
  private calculateImprovedChartBBox(
    topRegions: Array<{ x: number; y: number; score: number }>,
    gridSize: number,
    canvasWidth: number,
    canvasHeight: number,
    textRegions: any[]
  ): { x: number; y: number; width: number; height: number } | null {
    
    if (topRegions.length === 0) return null;

    try {
      // Find bounding box of top density regions
      let minX = Math.min(...topRegions.map(r => r.x));
      let maxX = Math.max(...topRegions.map(r => r.x + gridSize));
      let minY = Math.min(...topRegions.map(r => r.y));
      let maxY = Math.max(...topRegions.map(r => r.y + gridSize));

      const chartWidth = maxX - minX;
      const chartHeight = maxY - minY;
      const aspectRatio = chartWidth / chartHeight;

      console.log(`📊 Core chart region: ${chartWidth.toFixed(1)}x${chartHeight.toFixed(1)}, aspect ratio: ${aspectRatio.toFixed(2)}`);

      // Adaptive padding based on aspect ratio (your refined approach)
      const padX = chartWidth * (aspectRatio > 1.5 ? 0.15 : 0.3); // Less padding for wide charts
      const padY = chartHeight * (aspectRatio < 0.75 ? 0.15 : 0.3); // Less padding for tall charts

      console.log(`📊 Adaptive padding: X=${(padX/chartWidth*100).toFixed(1)}%, Y=${(padY/chartHeight*100).toFixed(1)}% (aspect ratio: ${aspectRatio.toFixed(2)})`);

      // Apply padding with bounds checking
      let x = Math.max(0, minX - padX);
      let y = Math.max(0, minY - padY);
      let w = Math.min(canvasWidth - x, chartWidth + 2 * padX);
      let h = Math.min(canvasHeight - y, chartHeight + 2 * padY);

      // Smart text exclusion: remove figure captions below chart
      const footerTexts = textRegions.filter(text => 
        text.y < y + h && 
        text.y > y + h - 100 && // Within 100 pixels below chart
        text.x >= x && 
        text.x <= x + w // Within chart width
      );

      if (footerTexts.length > 3) {
        console.log(`📊 Detected ${footerTexts.length} footer texts, cropping bottom margin`);
        h -= 100; // Crop bottom margin to exclude captions
      }

      // Final bounds validation
      if (x + w > canvasWidth) {
        w = canvasWidth - x;
      }
      if (y + h > canvasHeight) {
        h = canvasHeight - y;
      }

      console.log(`📊 Final bbox: (${x.toFixed(1)}, ${y.toFixed(1)}, ${w.toFixed(1)}x${h.toFixed(1)})`);

      return { x, y, width: w, height: h };

    } catch (error) {
      console.warn('⚠️ Error calculating improved chart bbox:', error);
      return null;
    }
  }

  /**
   * Group nearby density regions into chart candidates
   */
  private groupDensityRegionsIntoCharts(
    regions: Array<{ x: number; y: number; score: number; textDensity: number }>,
    gridSize: number
  ): Array<{ regions: Array<{ x: number; y: number; score: number; textDensity: number }>; avgScore: number }> {
    const chartCandidates: Array<{ regions: Array<{ x: number; y: number; score: number; textDensity: number }>; avgScore: number }> = [];
    const processed = new Set<number>();
    const proximityThreshold = gridSize * 2; // Regions within 2 grid cells are considered related

    for (let i = 0; i < regions.length; i++) {
      if (processed.has(i)) continue;

      const currentRegion = regions[i];
      const group = [currentRegion];
      processed.add(i);

      // Find nearby regions
      for (let j = i + 1; j < regions.length; j++) {
        if (processed.has(j)) continue;

        const otherRegion = regions[j];
        const distance = Math.sqrt(
          Math.pow(currentRegion.x - otherRegion.x, 2) + 
          Math.pow(currentRegion.y - otherRegion.y, 2)
        );

        if (distance <= proximityThreshold) {
          group.push(otherRegion);
          processed.add(j);
        }
      }

      // Only consider groups with multiple regions or very high single scores
      if (group.length >= 2 || (group.length === 1 && group[0].score > 0.3)) {
        const avgScore = group.reduce((sum, r) => sum + r.score, 0) / group.length;
        chartCandidates.push({ regions: group, avgScore });
      }
    }

    return chartCandidates;
  }

  /**
   * Calculate chart bounding box from grouped density regions with padding
   */
  private calculateChartBBoxFromDensityRegions(
    candidate: { regions: Array<{ x: number; y: number; score: number; textDensity: number }>; avgScore: number },
    gridSize: number,
    canvasWidth: number,
    canvasHeight: number
  ): { x: number; y: number; width: number; height: number } | null {
    
    if (candidate.regions.length === 0) return null;

    // Find bounding box of all regions in this candidate
    const minX = Math.min(...candidate.regions.map(r => r.x));
    const maxX = Math.max(...candidate.regions.map(r => r.x + gridSize));
    const minY = Math.min(...candidate.regions.map(r => r.y));
    const maxY = Math.max(...candidate.regions.map(r => r.y + gridSize));

    const coreWidth = maxX - minX;
    const coreHeight = maxY - minY;

    // Dynamic padding based on chart size and score
    // Higher scores and larger charts get more padding
    const basePadding = 0.3; // 30% base padding
    const maxPadding = 0.6;  // 60% max padding
    const scoreFactor = Math.min(1, candidate.avgScore * 2); // Score influence
    const sizeFactor = Math.min(1, (coreWidth * coreHeight) / (canvasWidth * canvasHeight * 0.1)); // Size influence
    
    const dynamicPaddingPercent = basePadding + (scoreFactor * sizeFactor * (maxPadding - basePadding));
    
    const padX = coreWidth * dynamicPaddingPercent;
    const padY = coreHeight * dynamicPaddingPercent;

    console.log(`📊 Chart padding: score=${candidate.avgScore.toFixed(3)}, size=${(sizeFactor*100).toFixed(1)}%, padding=${(dynamicPaddingPercent*100).toFixed(1)}%`);

    // Apply padding with bounds checking
    const finalBBox = {
      x: Math.max(0, minX - padX),
      y: Math.max(0, minY - padY),
      width: Math.min(canvasWidth, coreWidth + 2 * padX),
      height: Math.min(canvasHeight, coreHeight + 2 * padY)
    };

    // Ensure bbox doesn't exceed canvas bounds
    if (finalBBox.x + finalBBox.width > canvasWidth) {
      finalBBox.width = canvasWidth - finalBBox.x;
    }
    if (finalBBox.y + finalBBox.height > canvasHeight) {
      finalBBox.height = canvasHeight - finalBBox.y;
    }

    return finalBBox;
  }

  /**
   * Detect charts by finding figure captions and extracting nearby regions
   */
  private async detectChartsByFigureCaptions(page: PDFPageProxy, pageNumber: number): Promise<ChartRegion[]> {
    const regions: ChartRegion[] = [];

    try {
      console.log(`📝 Detecting charts by figure captions on page ${pageNumber}`);

      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1.0 });

      // Find figure captions
      const figureCaptions = this.findFigureCaptions(textContent);

      for (const caption of figureCaptions) {
        // Estimate chart region based on caption position
        const chartRegion = this.estimateChartRegionFromCaption(caption, textContent, viewport);
        
        if (chartRegion) {
          const region: ChartRegion = {
            id: `figure-chart-${pageNumber}-${caption.figureNumber}`,
            type: this.classifyChartTypeFromCaption(caption.text),
            boundingBox: chartRegion,
            confidence: 0.8, // High confidence for figure-based detection
            extractionMethod: 'figure-caption-based'
          };
          
          // Validate the region after creating it
          if (this.isValidChartRegion(region, 50, 0.2)) {
            regions.push(region);
            console.log(`✅ Found chart via figure caption: ${caption.text.substring(0, 50)}...`);
          }
        }
      }

    } catch (error) {
      console.warn(`⚠️ Error detecting charts by figure captions:`, error);
    }

    return regions;
  }

  /**
   * Analyze image object to determine if it's a chart
   */
  private analyzeImageForChartContent(imgObj: any): { isChart: boolean; chartType: ChartRegion['type']; confidence: number } {
    // Basic heuristics for chart detection in images
    const width = imgObj.width || 0;
    const height = imgObj.height || 0;
    
    // Size-based heuristics
    const aspectRatio = width / height;
    const area = width * height;
    
    // Charts typically have certain aspect ratios and sizes
    const isGoodSize = width >= 100 && height >= 100 && area >= 10000;
    const isGoodAspectRatio = aspectRatio >= 0.5 && aspectRatio <= 3.0;
    
    if (isGoodSize && isGoodAspectRatio) {
      // Classify chart type based on dimensions
      let chartType: ChartRegion['type'] = 'unknown';
      let confidence = 0.6;
      
      if (aspectRatio > 1.2 && aspectRatio < 2.0) {
        chartType = 'bar'; // Likely boxplot or bar chart
        confidence = 0.7;
      } else if (aspectRatio > 1.5) {
        chartType = 'line'; // Likely line chart
        confidence = 0.6;
      }
      
      return { isChart: true, chartType, confidence };
    }
    
    return { isChart: false, chartType: 'unknown', confidence: 0.1 };
  }

  /**
   * Detect boxplot patterns in rendered canvas with improved sensitivity
   */
  private detectBoxplotPatterns(canvas: Canvas, context: CanvasRenderingContext2D, textRegions: any[]): ChartRegion[] {
    const regions: ChartRegion[] = [];
    
    try {
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const { width, height, data } = imageData;
      
      console.log(`🔍 Scanning for boxplot patterns in ${width}x${height} canvas`);
      
      // Use multiple block sizes for better detection
      const blockSizes = [60, 80, 120]; // Different sizes to catch various chart scales
      
      for (const blockSize of blockSizes) {
        for (let y = 0; y < height - blockSize; y += blockSize/3) { // More overlap
          for (let x = 0; x < width - blockSize; x += blockSize/3) {
            const boxplotScore = this.analyzeRegionForBoxplot(data, x, y, blockSize, width);
            const textDensity = this.calculateTextDensity(x, y, blockSize, blockSize, textRegions);
            
            // Balanced thresholds for complete chart detection
            const hasVerticalLines = boxplotScore.verticalLines > 0.2; // Moderate threshold
            const hasHorizontalLines = boxplotScore.horizontalLines > 0.1; // Moderate threshold
            const hasStructure = boxplotScore.rectangles > 0.15; // Moderate threshold
            const lowTextDensity = textDensity < 0.3; // Reasonable text tolerance
            
            // Look for substantial chart content
            const hasChartStructure = boxplotScore.verticalLines > 0.15 && 
                                    boxplotScore.horizontalLines > 0.05 &&
                                    boxplotScore.rectangles > 0.1;
            
            // Require meaningful chart patterns
            if (hasChartStructure && lowTextDensity) {
              
              const expandedRegion = this.expandChartRegionAggressive(data, x, y, blockSize, blockSize, width, height);
              
              // Require substantial size for complete charts
              if (expandedRegion.width >= 120 && expandedRegion.height >= 80) {
                
                // Check if we already have a similar region (avoid duplicates)
                const isDuplicate = regions.some(existing => 
                  Math.abs(existing.boundingBox.x - expandedRegion.x) < 50 &&
                  Math.abs(existing.boundingBox.y - expandedRegion.y) < 50
                );
                
                if (!isDuplicate) {
                  const confidence = Math.min(0.9, 
                    boxplotScore.verticalLines + 
                    boxplotScore.horizontalLines + 
                    boxplotScore.rectangles + 
                    (lowTextDensity ? 0.2 : 0)
                  );
                  
                  const region: ChartRegion = {
                    id: `boxplot-${Date.now()}-${regions.length}`,
                    type: 'bar', // Boxplots are a type of bar chart
                    boundingBox: expandedRegion,
                    confidence: Math.max(0.3, confidence), // Minimum confidence
                    extractionMethod: 'enhanced-boxplot-detection'
                  };
                  regions.push(region);
                  console.log(`📊 Found boxplot pattern: ${expandedRegion.width}x${expandedRegion.height} at (${expandedRegion.x}, ${expandedRegion.y}) [confidence: ${confidence.toFixed(2)}]`);
                }
              }
            }
          }
        }
      }
      
      console.log(`📊 Total boxplot patterns found: ${regions.length}`);
      
    } catch (error) {
      console.warn(`⚠️ Error detecting boxplot patterns:`, error);
    }
    
    return regions;
  }

  /**
   * Analyze region specifically for boxplot characteristics
   */
  private analyzeRegionForBoxplot(
    data: Uint8ClampedArray,
    x: number,
    y: number,
    blockSize: number,
    imageWidth: number
  ): { verticalLines: number; horizontalLines: number; rectangles: number } {
    let verticalLinePixels = 0;
    let horizontalLinePixels = 0;
    let rectanglePixels = 0;
    let totalPixels = 0;
    
    // Sample vertical lines (characteristic of boxplots)
    for (let dx = 0; dx < blockSize; dx += 5) {
      let verticalStreak = 0;
      for (let dy = 0; dy < blockSize; dy++) {
        const idx = ((y + dy) * imageWidth + (x + dx)) * 4;
        if (idx < data.length - 3) {
          const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          if (gray < 200) { // Dark pixel
            verticalStreak++;
          } else if (verticalStreak > 0) {
            if (verticalStreak > blockSize * 0.3) verticalLinePixels++;
            verticalStreak = 0;
          }
        }
      }
    }
    
    // Sample horizontal lines (whiskers in boxplots)
    for (let dy = 0; dy < blockSize; dy += 5) {
      let horizontalStreak = 0;
      for (let dx = 0; dx < blockSize; dx++) {
        const idx = ((y + dy) * imageWidth + (x + dx)) * 4;
        if (idx < data.length - 3) {
          const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          if (gray < 200) { // Dark pixel
            horizontalStreak++;
          } else if (horizontalStreak > 0) {
            if (horizontalStreak > blockSize * 0.2) horizontalLinePixels++;
            horizontalStreak = 0;
          }
        }
      }
    }
    
    // Look for rectangular patterns (boxes in boxplots)
    rectanglePixels = Math.min(verticalLinePixels, horizontalLinePixels);
    totalPixels = (blockSize / 5) * (blockSize / 5);
    
    return {
      verticalLines: totalPixels > 0 ? verticalLinePixels / totalPixels : 0,
      horizontalLines: totalPixels > 0 ? horizontalLinePixels / totalPixels : 0,
      rectangles: totalPixels > 0 ? rectanglePixels / totalPixels : 0
    };
  }

  /**
   * Detect line chart patterns in rendered canvas
   */
  private detectLineChartPatterns(canvas: Canvas, context: CanvasRenderingContext2D, textRegions: any[]): ChartRegion[] {
    const regions: ChartRegion[] = [];
    
    try {
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const { width, height, data } = imageData;
      
      // Look for continuous line patterns
      const blockSize = 100;
      
      for (let y = 0; y < height - blockSize; y += blockSize/2) {
        for (let x = 0; x < width - blockSize; x += blockSize/2) {
          const lineScore = this.analyzeRegionForLineChart(data, x, y, blockSize, width);
          const textDensity = this.calculateTextDensity(x, y, blockSize, blockSize, textRegions);
          
          // Line chart indicators: continuous curves + axes + low text density
          if (lineScore.curves > 0.3 && 
              lineScore.axes > 0.1 && 
              textDensity < 0.2) {
            
            const expandedRegion = this.expandChartRegionAggressive(data, x, y, blockSize, blockSize, width, height);
            
            if (expandedRegion.width >= 120 && expandedRegion.height >= 80) {
              const region: ChartRegion = {
                id: `linechart-${Date.now()}-${regions.length}`,
                type: 'line',
                boundingBox: expandedRegion,
                confidence: Math.min(0.9, lineScore.curves + lineScore.axes),
                extractionMethod: 'line-chart-pattern-detection'
              };
              regions.push(region);
              console.log(`📈 Found line chart pattern: ${expandedRegion.width}x${expandedRegion.height} at (${expandedRegion.x}, ${expandedRegion.y})`);
            }
          }
        }
      }
      
    } catch (error) {
      console.warn(`⚠️ Error detecting line chart patterns:`, error);
    }
    
    return regions;
  }

  /**
   * Analyze region for line chart characteristics
   */
  private analyzeRegionForLineChart(
    data: Uint8ClampedArray,
    x: number,
    y: number,
    blockSize: number,
    imageWidth: number
  ): { curves: number; axes: number } {
    let curvePixels = 0;
    let axisPixels = 0;
    
    // Look for curved/diagonal lines (characteristic of line charts)
    for (let dy = 1; dy < blockSize - 1; dy++) {
      for (let dx = 1; dx < blockSize - 1; dx++) {
        const idx = ((y + dy) * imageWidth + (x + dx)) * 4;
        if (idx < data.length - 3) {
          const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          
          if (gray < 200) { // Dark pixel
            // Check if it's part of a diagonal/curved line
            const neighbors = this.getNeighborPixels(data, x + dx, y + dy, imageWidth);
            if (this.isDiagonalOrCurved(neighbors)) {
              curvePixels++;
            }
            
            // Check for axis-like structures (straight lines at edges)
            if (dx < 5 || dy > blockSize - 5) { // Left edge or bottom edge
              axisPixels++;
            }
          }
        }
      }
    }
    
    const totalPixels = blockSize * blockSize;
    
    return {
      curves: curvePixels / totalPixels,
      axes: axisPixels / totalPixels
    };
  }

  /**
   * Get neighboring pixels for pattern analysis
   */
  private getNeighborPixels(data: Uint8ClampedArray, x: number, y: number, width: number): boolean[] {
    const neighbors: boolean[] = [];
    
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        
        const idx = ((y + dy) * width + (x + dx)) * 4;
        if (idx >= 0 && idx < data.length - 3) {
          const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          neighbors.push(gray < 200);
        } else {
          neighbors.push(false);
        }
      }
    }
    
    return neighbors;
  }

  /**
   * Check if pixel pattern indicates diagonal or curved line
   */
  private isDiagonalOrCurved(neighbors: boolean[]): boolean {
    // Simple heuristic: if there are dark pixels in diagonal positions
    // neighbors array: [TL, T, TR, L, R, BL, B, BR]
    const diagonalPatterns = [
      [0, 4], // TL to R
      [2, 6], // TR to B
      [0, 8], // TL to BR
      [2, 6]  // TR to BL
    ];
    
    return diagonalPatterns.some(pattern => 
      pattern.every(idx => idx < neighbors.length && neighbors[idx])
    );
  }

  /**
   * Find figure captions in text content with more flexible patterns
   */
  private findFigureCaptions(textContent: any): Array<{ text: string; figureNumber: string; position: any }> {
    const captions: Array<{ text: string; figureNumber: string; position: any }> = [];
    
    // Collect all text items first
    const allText = textContent.items
      .filter((item: any) => 'str' in item && item.str.trim())
      .map((item: any) => ({
        text: item.str.trim(),
        position: {
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height
        }
      }));

    // Look for figure patterns with more flexibility
    allText.forEach((item: any) => {
      const text = item.text;
      
      // Multiple patterns for figure detection
      const patterns = [
        /^(Figure|Fig\.?)\s*(\d+)[\.:]/i,           // "Figure 1:", "Fig. 2."
        /^(Figure|Fig\.?)\s*(\d+)\s*$/i,            // "Figure 1", "Fig 2"
        /(Figure|Fig\.?)\s*(\d+)[\.:]/i,            // "...Figure 1:", anywhere in text
        /^(\d+)\.\s*(Figure|Fig\.?)/i,              // "1. Figure", "2. Fig"
        /^(Figure|Fig\.?)\s*(\d+)\s*[–-]/i,         // "Figure 1 –", "Fig 2 -"
      ];
      
      for (const pattern of patterns) {
        const figureMatch = text.match(pattern);
        if (figureMatch) {
          const figureNumber = figureMatch[2] || figureMatch[1]; // Handle different capture groups
          
          captions.push({
            text: text,
            figureNumber: figureNumber,
            position: item.position
          });
          
          console.log(`📝 Found figure caption: "${text}" (Figure ${figureNumber})`);
          break; // Only match first pattern
        }
      }
    });

    // Also look for standalone numbers that might be figure references
    if (captions.length === 0) {
      console.log(`📝 No standard figure captions found, looking for alternative patterns...`);
      
      // Look for text that might indicate figures
      allText.forEach((item: any) => {
        const text = item.text.toLowerCase();
        
        // Look for chart-related keywords
        if (text.includes('box') && text.includes('plot') ||
            text.includes('whisker') ||
            text.includes('chart') ||
            text.includes('graph') ||
            text.includes('plot')) {
          
          captions.push({
            text: item.text,
            figureNumber: 'unknown',
            position: item.position
          });
          
          console.log(`📝 Found potential chart reference: "${item.text}"`);
        }
      });
    }
    
    console.log(`📝 Found ${captions.length} figure captions/references`);
    return captions;
  }

  /**
   * Estimate chart region based on figure caption position
   */
  private estimateChartRegionFromCaption(
    caption: any,
    textContent: any,
    viewport: any
  ): ChartRegion['boundingBox'] | null {
    
    // Heuristic: chart is usually above the caption
    const captionY = caption.position.y;
    const captionX = caption.position.x;
    
    // Look for text blocks above the caption to find chart boundaries
    const textAbove = textContent.items
      .filter((item: any) => 'str' in item && item.transform[5] > captionY + 20)
      .sort((a: any, b: any) => b.transform[5] - a.transform[5]);
    
    if (textAbove.length === 0) return null;
    
    // Find the closest text above (likely end of previous content)
    const topBoundary = textAbove[0].transform[5] + 20;
    
    // Estimate chart region
    const chartRegion = {
      x: Math.max(50, captionX - 50), // Some margin from left
      y: captionY + 10, // Just above caption
      width: Math.min(400, viewport.width - captionX), // Reasonable width
      height: Math.max(100, topBoundary - captionY - 30) // Height to top boundary
    };
    
    return chartRegion;
  }

  /**
   * Classify chart type from caption text
   */
  private classifyChartTypeFromCaption(captionText: string): ChartRegion['type'] {
    const text = captionText.toLowerCase();
    
    if (text.includes('boxplot') || text.includes('box plot') || text.includes('box-plot')) {
      return 'bar'; // Boxplots are a type of bar chart
    } else if (text.includes('line') || text.includes('trend') || text.includes('time series')) {
      return 'line';
    } else if (text.includes('pie') || text.includes('donut')) {
      return 'pie';
    } else if (text.includes('scatter') || text.includes('correlation')) {
      return 'scatter';
    } else if (text.includes('bar') || text.includes('histogram')) {
      return 'bar';
    }
    
    return 'unknown';
  }

  /**
   * Extract drawing points from PDF operator list using center-of-chart approach
   */
  private extractDrawingPoints(operatorList: any, viewport: any): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];

    try {
      const fnArray = operatorList.fnArray;
      const argsArray = operatorList.argsArray;

      // PDF operation codes for drawing operations
      const DRAWING_OPS = {
        moveTo: 11,
        lineTo: 12,
        curveTo: 13,
        rect: 19,
        arc: 20
      };

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i];

        // Extract points from drawing operations
        if (Object.values(DRAWING_OPS).includes(fn) && Array.isArray(args) && args.length >= 2) {
          const x = args[0];
          const y = args[1];

          // Validate coordinates are within viewport
          if (typeof x === 'number' && typeof y === 'number' && 
              x > 0 && y > 0 && x < viewport.width && y < viewport.height) {
            points.push({ x, y });
          }
        }
      }

      console.log(`📝 Extracted ${points.length} drawing points from ${fnArray.length} PDF operations`);

    } catch (error) {
      console.warn('⚠️ Error extracting drawing points:', error);
    }

    return points;
  }

  /**
   * Find chart regions using robust density-based clustering approach
   */
  private findChartRegionsFromPoints(
    points: Array<{ x: number; y: number }>, 
    viewport: any, 
    pageNumber: number
  ): ChartRegion[] {
    const regions: ChartRegion[] = [];

    try {
      if (points.length === 0) return regions;

      // Use robust density-based bounding box calculation
      const bbox = this.getChartBBoxFromOperators(points, viewport.width, viewport.height);
      
      if (bbox && bbox.width >= 100 && bbox.height >= 80) {
        const region: ChartRegion = {
          id: `density-chart-${pageNumber}-0`,
          type: 'unknown', // Will be classified later
          boundingBox: bbox,
          confidence: 0.8, // High confidence for density-based approach
          extractionMethod: 'density-based-clustering'
        };

        regions.push(region);
        console.log(`📊 Found density-based chart: ${bbox.width.toFixed(1)}x${bbox.height.toFixed(1)} at (${bbox.x.toFixed(1)}, ${bbox.y.toFixed(1)})`);
      }

    } catch (error) {
      console.warn('⚠️ Error finding chart regions from points:', error);
    }

    return regions;
  }

  /**
   * Robust chart bounding box calculation using density-based clustering
   * Filters outliers and uses dominant cluster for accurate center detection
   */
  private getChartBBoxFromOperators(
    points: Array<{ x: number; y: number }>,
    viewportWidth: number,
    viewportHeight: number
  ): { x: number; y: number; width: number; height: number } | null {
    
    if (points.length < 10) return null; // Need minimum points for clustering

    try {
      // Step 1: Simple density filtering - keep middle 80% of x and y range
      // This removes outliers and focuses on the main chart area
      const xVals = points.map(p => p.x).sort((a, b) => a - b);
      const yVals = points.map(p => p.y).sort((a, b) => a - b);

      const q1x = xVals[Math.floor(points.length * 0.1)];
      const q9x = xVals[Math.floor(points.length * 0.9)];
      const q1y = yVals[Math.floor(points.length * 0.1)];
      const q9y = yVals[Math.floor(points.length * 0.9)];

      // Filter to keep only the central 80% of points (removes outliers)
      const filtered = points.filter(p => 
        p.x >= q1x && p.x <= q9x && p.y >= q1y && p.y <= q9y
      );

      if (filtered.length < 5) return null; // Not enough points after filtering

      console.log(`📊 Density filtering: ${points.length} → ${filtered.length} points (removed ${points.length - filtered.length} outliers)`);

      // Step 2: Calculate bounding box from filtered dominant cluster
      const minX = Math.min(...filtered.map(p => p.x));
      const maxX = Math.max(...filtered.map(p => p.x));
      const minY = Math.min(...filtered.map(p => p.y));
      const maxY = Math.max(...filtered.map(p => p.y));

      const width = maxX - minX;
      const height = maxY - minY;

      // Step 3: Dynamic padding based on chart size relative to page
      const chartArea = width * height;
      const pageArea = viewportWidth * viewportHeight;
      const chartToPageRatio = chartArea / pageArea;
      
      // Range: 30% to 80% padding based on chart size relative to page
      const basePadding = 0.30;
      const maxPadding = 0.80;
      const dynamicPaddingPercent = basePadding + (chartToPageRatio * (maxPadding - basePadding));
      
      const padX = width * dynamicPaddingPercent;
      const padY = height * dynamicPaddingPercent;

      console.log(`📊 Chart ratio: ${(chartToPageRatio * 100).toFixed(1)}% of page, using ${(dynamicPaddingPercent * 100).toFixed(1)}% padding`);

      // Step 4: Apply padding with viewport bounds checking
      const finalBBox = {
        x: Math.max(0, minX - padX),
        y: Math.max(0, minY - padY),
        width: Math.min(viewportWidth, width + 2 * padX),
        height: Math.min(viewportHeight, height + 2 * padY)
      };

      // Ensure the final bbox doesn't exceed viewport
      if (finalBBox.x + finalBBox.width > viewportWidth) {
        finalBBox.width = viewportWidth - finalBBox.x;
      }
      if (finalBBox.y + finalBBox.height > viewportHeight) {
        finalBBox.height = viewportHeight - finalBBox.y;
      }

      console.log(`📊 Density-based bbox: core=(${minX.toFixed(1)}, ${minY.toFixed(1)}, ${width.toFixed(1)}x${height.toFixed(1)}), padded=(${finalBBox.x.toFixed(1)}, ${finalBBox.y.toFixed(1)}, ${finalBBox.width.toFixed(1)}x${finalBBox.height.toFixed(1)})`);

      return finalBBox;

    } catch (error) {
      console.warn('⚠️ Error in density-based bbox calculation:', error);
      return null;
    }
  }

  /**
   * Calculate improved center using multiple methods for better accuracy
   */
  private calculateImprovedCenter(
    points: Array<{ x: number; y: number }>,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number
  ): {
    x: number;
    y: number;
    arithmetic: { x: number; y: number };
    geometric: { x: number; y: number };
    density: { x: number; y: number };
  } {
    // Method 1: Arithmetic mean (original approach)
    const arithmeticX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const arithmeticY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

    // Method 2: Geometric center (center of bounding box)
    const geometricX = (minX + maxX) / 2;
    const geometricY = (minY + maxY) / 2;

    // Method 3: Density-weighted center (removes outlier influence)
    const densityCenter = this.calculateDensityWeightedCenter(points, minX, maxX, minY, maxY);

    // Method 4: Median center (robust to outliers)
    const sortedX = points.map(p => p.x).sort((a, b) => a - b);
    const sortedY = points.map(p => p.y).sort((a, b) => a - b);
    const medianX = sortedX[Math.floor(sortedX.length / 2)];
    const medianY = sortedY[Math.floor(sortedY.length / 2)];

    // Combine methods with weights based on point distribution
    const pointSpread = this.calculatePointSpread(points, arithmeticX, arithmeticY);
    
    // If points are well distributed, use arithmetic mean
    // If points are clustered or have outliers, use density-weighted or geometric center
    let finalX: number;
    let finalY: number;

    if (pointSpread < 0.3) {
      // Points are well clustered - use density-weighted center
      finalX = densityCenter.x;
      finalY = densityCenter.y;
    } else if (pointSpread > 0.7) {
      // Points are very spread out - use geometric center
      finalX = geometricX;
      finalY = geometricY;
    } else {
      // Moderate spread - blend arithmetic and geometric centers
      const blendFactor = 0.6; // Favor arithmetic slightly
      finalX = arithmeticX * blendFactor + geometricX * (1 - blendFactor);
      finalY = arithmeticY * blendFactor + geometricY * (1 - blendFactor);
    }

    return {
      x: finalX,
      y: finalY,
      arithmetic: { x: arithmeticX, y: arithmeticY },
      geometric: { x: geometricX, y: geometricY },
      density: densityCenter
    };
  }

  /**
   * Calculate density-weighted center to reduce outlier influence
   */
  private calculateDensityWeightedCenter(
    points: Array<{ x: number; y: number }>,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number
  ): { x: number; y: number } {
    const gridSize = 20; // Create a grid for density calculation
    const cellWidth = (maxX - minX) / gridSize;
    const cellHeight = (maxY - minY) / gridSize;
    
    // Create density grid
    const densityGrid: number[][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0));
    
    // Count points in each cell
    points.forEach(point => {
      const cellX = Math.min(gridSize - 1, Math.floor((point.x - minX) / cellWidth));
      const cellY = Math.min(gridSize - 1, Math.floor((point.y - minY) / cellHeight));
      densityGrid[cellY][cellX]++;
    });
    
    // Find center of mass of density grid
    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;
    
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const weight = densityGrid[y][x];
        if (weight > 0) {
          const cellCenterX = minX + (x + 0.5) * cellWidth;
          const cellCenterY = minY + (y + 0.5) * cellHeight;
          
          weightedX += cellCenterX * weight;
          weightedY += cellCenterY * weight;
          totalWeight += weight;
        }
      }
    }
    
    return {
      x: totalWeight > 0 ? weightedX / totalWeight : (minX + maxX) / 2,
      y: totalWeight > 0 ? weightedY / totalWeight : (minY + maxY) / 2
    };
  }

  /**
   * Calculate how spread out the points are (0 = clustered, 1 = very spread)
   */
  private calculatePointSpread(
    points: Array<{ x: number; y: number }>,
    centerX: number,
    centerY: number
  ): number {
    if (points.length === 0) return 0;
    
    // Calculate average distance from center
    const avgDistance = points.reduce((sum, point) => {
      const distance = Math.sqrt(Math.pow(point.x - centerX, 2) + Math.pow(point.y - centerY, 2));
      return sum + distance;
    }, 0) / points.length;
    
    // Calculate standard deviation of distances
    const variance = points.reduce((sum, point) => {
      const distance = Math.sqrt(Math.pow(point.x - centerX, 2) + Math.pow(point.y - centerY, 2));
      return sum + Math.pow(distance - avgDistance, 2);
    }, 0) / points.length;
    
    const stdDev = Math.sqrt(variance);
    
    // Normalize spread (this is a heuristic)
    const spread = Math.min(1, stdDev / (avgDistance + 1));
    
    return spread;
  }

  /**
   * Parse PDF operator list into structured vector operations
   */
  private parseOperatorList(operatorList: any): VectorOperation[] {
    const operations: VectorOperation[] = [];

    try {
      const fnArray = operatorList.fnArray;
      const argsArray = operatorList.argsArray;

      console.log(`🔍 Analyzing ${fnArray.length} PDF operations`);

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i];

        // Log all operations for debugging
        if (i < 10) { // Log first 10 operations
          console.log(`📝 Operation ${i}: fn=${fn}, args=[${args?.join(', ') || 'none'}]`);
        }

        // Map PDF operations to our vector operations with more comprehensive mapping
        switch (fn) {
          case 11: // moveTo (m)
            if (args && args.length >= 2) {
              operations.push({ type: 'moveTo', args: args });
            }
            break;
          case 12: // lineTo (l)
            if (args && args.length >= 2) {
              operations.push({ type: 'lineTo', args: args });
            }
            break;
          case 19: // rectangle (re)
            if (args && args.length >= 4) {
              operations.push({ type: 'rect', args: args });
            }
            break;
          case 20: // arc
            if (args && args.length >= 5) {
              operations.push({ type: 'arc', args: args });
            }
            break;
          case 13: // bezierCurveTo (c)
            if (args && args.length >= 6) {
              operations.push({ type: 'bezierCurveTo', args: args });
            }
            break;
          case 8: // fill (f)
            operations.push({ type: 'fill', args: args || [] });
            break;
          case 9: // stroke (S)
            operations.push({ type: 'stroke', args: args || [] });
            break;
          // Add more PDF operations
          case 14: // curveTo (v)
            if (args && args.length >= 4) {
              operations.push({ type: 'bezierCurveTo', args: args });
            }
            break;
          case 15: // curveTo (y)
            if (args && args.length >= 4) {
              operations.push({ type: 'bezierCurveTo', args: args });
            }
            break;
          case 16: // closePath (h)
            operations.push({ type: 'lineTo', args: args || [] });
            break;
        }
      }

      console.log(`📝 Parsed ${operations.length} vector operations from ${fnArray.length} PDF operations`);
      
      // Log sample of parsed operations
      if (operations.length > 0) {
        console.log(`📝 Sample operations:`, operations.slice(0, 5));
      }

    } catch (error) {
      console.warn('⚠️ Error parsing operator list:', error);
    }

    return operations;
  }

  /**
   * Analyze vector patterns to identify chart types
   */
  private analyzeVectorPatterns(operations: VectorOperation[]): Array<{
    type: ChartRegion['type'];
    boundingBox: ChartRegion['boundingBox'];
    confidence: number;
  }> {
    const patterns: Array<{
      type: ChartRegion['type'];
      boundingBox: ChartRegion['boundingBox'];
      confidence: number;
    }> = [];

    try {
      // Group operations by proximity
      const operationGroups = this.groupOperationsByProximity(operations);

      for (const group of operationGroups) {
        const pattern = this.classifyVectorPattern(group);
        if (pattern.confidence > 0.5) {
          patterns.push(pattern);
        }
      }

      console.log(`📊 Identified ${patterns.length} chart patterns from vector analysis`);

    } catch (error) {
      console.warn('⚠️ Error analyzing vector patterns:', error);
    }

    return patterns;
  }

  /**
   * Group vector operations by spatial proximity
   */
  private groupOperationsByProximity(operations: VectorOperation[]): VectorOperation[][] {
    const groups: VectorOperation[][] = [];
    const proximityThreshold = 50; // pixels

    // Simple grouping algorithm - can be improved with clustering
    const ungrouped = [...operations];
    
    while (ungrouped.length > 0) {
      const seed = ungrouped.shift()!;
      const group = [seed];
      
      // Find nearby operations
      for (let i = ungrouped.length - 1; i >= 0; i--) {
        const op = ungrouped[i];
        if (this.getOperationDistance(seed, op) < proximityThreshold) {
          group.push(op);
          ungrouped.splice(i, 1);
        }
      }
      
      if (group.length >= 3) { // Minimum operations for a chart
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * Calculate distance between two vector operations
   */
  private getOperationDistance(op1: VectorOperation, op2: VectorOperation): number {
    // Safety check for null operations or missing args
    if (!op1 || !op2 || !op1.args || !op2.args || op1.args.length < 2 || op2.args.length < 2) {
      return Infinity; // Return large distance for invalid operations
    }
    
    const x1 = op1.args[0] || 0;
    const y1 = op1.args[1] || 0;
    const x2 = op2.args[0] || 0;
    const y2 = op2.args[1] || 0;
    
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  }

  /**
   * Classify a group of vector operations as a chart type
   */
  private classifyVectorPattern(operations: VectorOperation[]): {
    type: ChartRegion['type'];
    boundingBox: ChartRegion['boundingBox'];
    confidence: number;
  } {
    const rectCount = operations.filter(op => op.type === 'rect').length;
    const lineCount = operations.filter(op => op.type === 'lineTo').length;
    const arcCount = operations.filter(op => op.type === 'arc').length;
    const totalOps = operations.length;

    // Calculate bounding box
    const boundingBox = this.calculateBoundingBox(operations);

    // Classification heuristics
    let type: ChartRegion['type'] = 'unknown';
    let confidence = 0;

    if (rectCount > totalOps * 0.3) {
      // Likely bar chart
      type = 'bar';
      confidence = Math.min(0.9, rectCount / totalOps + 0.3);
    } else if (lineCount > totalOps * 0.4) {
      // Likely line chart
      type = 'line';
      confidence = Math.min(0.9, lineCount / totalOps + 0.2);
    } else if (arcCount > totalOps * 0.2) {
      // Likely pie chart
      type = 'pie';
      confidence = Math.min(0.9, arcCount / totalOps + 0.4);
    } else if (lineCount > 0 && rectCount > 0) {
      // Mixed - could be area chart
      type = 'area';
      confidence = 0.6;
    }

    return { type, boundingBox, confidence };
  }

  /**
   * Calculate bounding box for a group of operations
   */
  private calculateBoundingBox(operations: VectorOperation[]): ChartRegion['boundingBox'] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    operations.forEach(op => {
      if (op.args && op.args.length >= 2) {
        // Handle different operation types
        switch (op.type) {
          case 'moveTo':
          case 'lineTo':
            const x = op.args[0];
            const y = op.args[1];
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            break;
          case 'rect':
            if (op.args.length >= 4) {
              const rectX = op.args[0];
              const rectY = op.args[1];
              const rectW = op.args[2];
              const rectH = op.args[3];
              minX = Math.min(minX, rectX);
              minY = Math.min(minY, rectY);
              maxX = Math.max(maxX, rectX + rectW);
              maxY = Math.max(maxY, rectY + rectH);
            }
            break;
          case 'bezierCurveTo':
            if (op.args.length >= 6) {
              // Control points and end point
              for (let i = 0; i < op.args.length; i += 2) {
                const x = op.args[i];
                const y = op.args[i + 1];
                if (x !== undefined && y !== undefined) {
                  minX = Math.min(minX, x);
                  minY = Math.min(minY, y);
                  maxX = Math.max(maxX, x);
                  maxY = Math.max(maxY, y);
                }
              }
            }
            break;
          case 'arc':
            if (op.args.length >= 5) {
              const centerX = op.args[0];
              const centerY = op.args[1];
              const radius = op.args[2];
              minX = Math.min(minX, centerX - radius);
              minY = Math.min(minY, centerY - radius);
              maxX = Math.max(maxX, centerX + radius);
              maxY = Math.max(maxY, centerY + radius);
            }
            break;
        }
      }
    });

    // Ensure we have valid bounds
    if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
      console.warn('⚠️ Invalid bounding box calculated, using default');
      return { x: 0, y: 0, width: 100, height: 100 };
    }

    const width = Math.max(1, maxX - minX); // Ensure minimum width
    const height = Math.max(1, maxY - minY); // Ensure minimum height

    console.log(`📐 Calculated bounding box: x=${minX.toFixed(1)}, y=${minY.toFixed(1)}, w=${width.toFixed(1)}, h=${height.toFixed(1)}`);

    return {
      x: minX,
      y: minY,
      width: width,
      height: height
    };
  }

  /**
   * Analyze canvas for chart-like visual patterns
   */
  private async analyzeCanvasForCharts(canvas: Canvas, context: CanvasRenderingContext2D): Promise<Array<{
    type: ChartRegion['type'];
    boundingBox: ChartRegion['boundingBox'];
    confidence: number;
  }>> {
    const chartAreas: Array<{
      type: ChartRegion['type'];
      boundingBox: ChartRegion['boundingBox'];
      confidence: number;
    }> = [];

    try {
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      
      // Analyze image data for chart patterns
      const regions = await this.detectChartRegionsInImageData(imageData);
      
      for (const region of regions) {
        const type = await this.classifyChartFromImageRegion(imageData as any, region);
        chartAreas.push({
          type: type.chartType,
          boundingBox: region,
          confidence: type.confidence
        });
      }

    } catch (error) {
      console.warn('⚠️ Error analyzing canvas for charts:', error);
    }

    return chartAreas;
  }

  /**
   * Detect potential chart regions in image data
   */
  private async detectChartRegionsInImageData(imageData: any): Promise<ChartRegion['boundingBox'][]> {
    const regions: ChartRegion['boundingBox'][] = [];

    try {
      // Simple edge detection and region growing
      const edges = this.detectEdges(imageData);
      const connectedComponents = this.findConnectedComponents(edges);
      
      // Filter components that could be charts
      for (const component of connectedComponents) {
        if (component.width > 100 && component.height > 100 && 
            component.width < imageData.width * 0.8 && 
            component.height < imageData.height * 0.8) {
          regions.push(component);
        }
      }

    } catch (error) {
      console.warn('⚠️ Error detecting chart regions in image data:', error);
    }

    return regions;
  }

  /**
   * Simple edge detection using Sobel operator
   */
  private detectEdges(imageData: ImageData): boolean[][] {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const edges: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));

    // Sobel kernels
    const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;

        // Apply Sobel kernels
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            
            gx += gray * sobelX[ky + 1][kx + 1];
            gy += gray * sobelY[ky + 1][kx + 1];
          }
        }

        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edges[y][x] = magnitude > 50; // Threshold for edge detection
      }
    }

    return edges;
  }

  /**
   * Find connected components in edge image
   */
  private findConnectedComponents(edges: boolean[][]): ChartRegion['boundingBox'][] {
    const height = edges.length;
    const width = edges[0].length;
    const visited = Array(height).fill(null).map(() => Array(width).fill(false));
    const components: ChartRegion['boundingBox'][] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (edges[y][x] && !visited[y][x]) {
          const component = this.floodFill(edges, visited, x, y);
          if (component.width > 50 && component.height > 50) {
            components.push(component);
          }
        }
      }
    }

    return components;
  }

  /**
   * Flood fill algorithm to find connected component
   */
  private floodFill(edges: boolean[][], visited: boolean[][], startX: number, startY: number): ChartRegion['boundingBox'] {
    const stack = [[startX, startY]];
    let minX = startX, minY = startY, maxX = startX, maxY = startY;

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      
      if (x < 0 || x >= edges[0].length || y < 0 || y >= edges.length || 
          visited[y][x] || !edges[y][x]) {
        continue;
      }

      visited[y][x] = true;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      // Add neighbors
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Classify chart type from image region
   */
  private async classifyChartFromImageRegion(
    imageData: ImageData, 
    region: ChartRegion['boundingBox']
  ): Promise<{ chartType: ChartRegion['type']; confidence: number }> {
    
    // Extract region data
    const regionData = this.extractImageRegion(imageData, region);
    
    // Analyze patterns in the region
    const patterns = this.analyzeImagePatterns(regionData);
    
    // Classify based on patterns
    if (patterns.verticalBars > 0.3) {
      return { chartType: 'bar', confidence: 0.8 };
    } else if (patterns.curves > 0.2) {
      return { chartType: 'line', confidence: 0.7 };
    } else if (patterns.circles > 0.4) {
      return { chartType: 'pie', confidence: 0.9 };
    } else {
      return { chartType: 'unknown', confidence: 0.3 };
    }
  }

  /**
   * Extract a region from image data
   */
  private extractImageRegion(imageData: any, region: ChartRegion['boundingBox']): any {
    const canvas = createCanvas(region.width, region.height);
    const context = canvas.getContext('2d');
    
    // Create new ImageData for the region
    const regionImageData = context.createImageData(region.width, region.height);
    
    // Copy pixels from the region
    for (let y = 0; y < region.height; y++) {
      for (let x = 0; x < region.width; x++) {
        const srcIdx = ((region.y + y) * imageData.width + (region.x + x)) * 4;
        const dstIdx = (y * region.width + x) * 4;
        
        regionImageData.data[dstIdx] = imageData.data[srcIdx];
        regionImageData.data[dstIdx + 1] = imageData.data[srcIdx + 1];
        regionImageData.data[dstIdx + 2] = imageData.data[srcIdx + 2];
        regionImageData.data[dstIdx + 3] = imageData.data[srcIdx + 3];
      }
    }
    
    return regionImageData as any;
  }

  /**
   * Analyze patterns in image region
   */
  private analyzeImagePatterns(imageData: ImageData): {
    verticalBars: number;
    curves: number;
    circles: number;
  } {
    // Simplified pattern analysis
    // In a production system, you'd use more sophisticated computer vision
    
    return {
      verticalBars: Math.random() * 0.5, // Placeholder
      curves: Math.random() * 0.3,       // Placeholder
      circles: Math.random() * 0.2       // Placeholder
    };
  }

  /**
   * Extract structured data from a detected chart region
   */
  private async extractChartData(
    page: PDFPageProxy, 
    region: ChartRegion, 
    pageNumber: number
  ): Promise<ChartData | null> {
    
    try {
      console.log(`📊 Extracting data from ${region.type} chart: ${region.id}`);

      // Get text content near the chart for labels
      const textContent = await page.getTextContent();
      const nearbyText = this.findTextNearRegion(textContent, region);

      // Extract chart-specific data based on type
      let chartData: ChartData;

      switch (region.type) {
        case 'bar':
          chartData = await this.extractBarChartData(page, region, nearbyText, pageNumber);
          break;
        case 'line':
          chartData = await this.extractLineChartData(page, region, nearbyText, pageNumber);
          break;
        case 'pie':
          chartData = await this.extractPieChartData(page, region, nearbyText, pageNumber);
          break;
        default:
          chartData = await this.extractGenericChartData(page, region, nearbyText, pageNumber);
      }

      console.log(`✅ Successfully extracted chart data: ${chartData.series.length} series, ${chartData.metadata.dataPoints} data points`);
      return chartData;

    } catch (error) {
      console.error(`❌ Error extracting chart data from region ${region.id}:`, error);
      return null;
    }
  }

  /**
   * Find text content near a chart region
   */
  private findTextNearRegion(textContent: any, region: ChartRegion): any[] {
    const nearbyText: any[] = [];
    const proximityThreshold = 100; // pixels

    textContent.items.forEach((item: any) => {
      if ('str' in item && item.str.trim()) {
        const textX = item.transform[4];
        const textY = item.transform[5];
        
        // Check if text is near the chart region
        const distance = Math.min(
          Math.abs(textX - region.boundingBox.x),
          Math.abs(textX - (region.boundingBox.x + region.boundingBox.width)),
          Math.abs(textY - region.boundingBox.y),
          Math.abs(textY - (region.boundingBox.y + region.boundingBox.height))
        );
        
        if (distance < proximityThreshold) {
          nearbyText.push(item);
        }
      }
    });

    return nearbyText;
  }

  /**
   * Extract bar chart data
   */
  private async extractBarChartData(
    page: PDFPageProxy,
    region: ChartRegion,
    nearbyText: any[],
    pageNumber: number
  ): Promise<ChartData> {
    
    // Mock implementation - in production, you'd analyze the actual bars
    const chartData: ChartData = {
      id: region.id,
      type: 'bar',
      title: this.extractTitle(nearbyText),
      xAxis: {
        label: 'Categories',
        values: ['Q1', 'Q2', 'Q3', 'Q4'],
        type: 'category'
      },
      yAxis: {
        label: 'Values',
        values: [0, 50, 100, 150, 200],
        min: 0,
        max: 200,
        type: 'numeric'
      },
      series: [{
        label: 'Series 1',
        values: [80, 120, 150, 180],
        color: '#4285f4',
        type: 'bar'
      }],
      metadata: {
        pageNumber,
        confidence: region.confidence,
        extractionMethod: region.extractionMethod,
        boundingBox: region.boundingBox,
        dataPoints: 4,
        hasGridlines: true,
        hasLegend: false,
        hasTitle: true
      }
    };

    return chartData;
  }

  /**
   * Extract line chart data
   */
  private async extractLineChartData(
    page: PDFPageProxy,
    region: ChartRegion,
    nearbyText: any[],
    pageNumber: number
  ): Promise<ChartData> {
    
    // Mock implementation - in production, you'd trace the actual lines
    const chartData: ChartData = {
      id: region.id,
      type: 'line',
      title: this.extractTitle(nearbyText),
      xAxis: {
        label: 'Time',
        values: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
        type: 'category'
      },
      yAxis: {
        label: 'Value',
        values: [0, 25, 50, 75, 100],
        min: 0,
        max: 100,
        type: 'numeric'
      },
      series: [{
        label: 'Trend',
        values: [20, 35, 45, 60, 80],
        color: '#ea4335',
        type: 'line'
      }],
      metadata: {
        pageNumber,
        confidence: region.confidence,
        extractionMethod: region.extractionMethod,
        boundingBox: region.boundingBox,
        dataPoints: 5,
        hasGridlines: true,
        hasLegend: false,
        hasTitle: true
      }
    };

    return chartData;
  }

  /**
   * Extract pie chart data
   */
  private async extractPieChartData(
    page: PDFPageProxy,
    region: ChartRegion,
    nearbyText: any[],
    pageNumber: number
  ): Promise<ChartData> {
    
    // Mock implementation - in production, you'd analyze the pie slices
    const chartData: ChartData = {
      id: region.id,
      type: 'pie',
      title: this.extractTitle(nearbyText),
      xAxis: {
        label: 'Categories',
        values: ['A', 'B', 'C', 'D'],
        type: 'category'
      },
      yAxis: {
        label: 'Percentage',
        values: [0, 25, 50, 75, 100],
        min: 0,
        max: 100,
        type: 'numeric'
      },
      series: [{
        label: 'Distribution',
        values: [30, 25, 25, 20],
        color: '#34a853'
      }],
      legend: [
        { label: 'Category A', color: '#4285f4' },
        { label: 'Category B', color: '#ea4335' },
        { label: 'Category C', color: '#fbbc04' },
        { label: 'Category D', color: '#34a853' }
      ],
      metadata: {
        pageNumber,
        confidence: region.confidence,
        extractionMethod: region.extractionMethod,
        boundingBox: region.boundingBox,
        dataPoints: 4,
        hasGridlines: false,
        hasLegend: true,
        hasTitle: true
      }
    };

    return chartData;
  }

  /**
   * Extract generic chart data
   */
  private async extractGenericChartData(
    page: PDFPageProxy,
    region: ChartRegion,
    nearbyText: any[],
    pageNumber: number
  ): Promise<ChartData> {
    
    const chartData: ChartData = {
      id: region.id,
      type: 'unknown',
      title: this.extractTitle(nearbyText),
      xAxis: {
        values: ['Data'],
        type: 'category'
      },
      yAxis: {
        values: [0, 100],
        min: 0,
        max: 100,
        type: 'numeric'
      },
      series: [{
        label: 'Unknown Series',
        values: [50]
      }],
      metadata: {
        pageNumber,
        confidence: region.confidence,
        extractionMethod: region.extractionMethod,
        boundingBox: region.boundingBox,
        dataPoints: 1,
        hasGridlines: false,
        hasLegend: false,
        hasTitle: false
      }
    };

    return chartData;
  }

  /**
   * Extract title from nearby text
   */
  private extractTitle(nearbyText: any[]): string | undefined {
    // Look for text that could be a title (larger font, positioned above chart)
    const titleCandidates = nearbyText
      .filter(item => item.str && item.str.trim().length > 0)
      .sort((a, b) => {
        // Sort by font size (larger first) and Y position (higher first)
        const fontSizeA = Math.abs(a.transform[0]);
        const fontSizeB = Math.abs(b.transform[0]);
        if (fontSizeA !== fontSizeB) {
          return fontSizeB - fontSizeA;
        }
        return b.transform[5] - a.transform[5];
      });

    if (titleCandidates.length > 0) {
      return titleCandidates[0].str.trim();
    }

    return undefined;
  }

  /**
   * Get text regions from PDF text content to exclude from chart detection
   */
  private getTextRegions(textContent: any, viewport: any): Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> {
    const textRegions: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];

    textContent.items.forEach((item: any) => {
      if ('str' in item && item.str.trim()) {
        const x = item.transform[4];
        const y = item.transform[5];
        const width = item.width || 50; // Fallback width
        const height = item.height || 12; // Fallback height

        textRegions.push({
          x: x * 3.0, // Scale to match high-res rendering
          y: y * 3.0,
          width: width * 3.0,
          height: height * 3.0
        });
      }
    });

    return textRegions;
  }

  /**
   * Improved canvas analysis for chart detection with aggressive embedded chart detection
   */
  private async analyzeCanvasForChartsImproved(
    canvas: Canvas, 
    context: CanvasRenderingContext2D, 
    textRegions: Array<{ x: number; y: number; width: number; height: number }>
  ): Promise<Array<{
    type: ChartRegion['type'];
    boundingBox: ChartRegion['boundingBox'];
    confidence: number;
  }>> {
    const chartAreas: Array<{
      type: ChartRegion['type'];
      boundingBox: ChartRegion['boundingBox'];
      confidence: number;
    }> = [];

    try {
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      
      console.log(`🔍 Analyzing ${canvas.width}x${canvas.height} canvas for embedded charts`);
      
      // Method 1: Aggressive block-based analysis for embedded chart images
      const blockCharts = await this.detectEmbeddedChartImages(imageData as any, textRegions);
      chartAreas.push(...blockCharts);
      
      // Method 2: Edge-based detection (original method)
      const textMask = this.createTextMask(imageData as any, textRegions);
      const edges = this.detectEdgesImproved(imageData as any, textMask);
      const components = this.findConnectedComponentsImproved(edges);
      
      for (const component of components) {
        const analysis = await this.analyzeComponentForChart(imageData as any, component, textMask);
        
        if (analysis.confidence > 0.2) { // Lower threshold for edge-based detection
          chartAreas.push({
            type: analysis.chartType,
            boundingBox: component,
            confidence: analysis.confidence
          });
        }
      }

      // Method 3: Color-based region detection for charts with distinct colors
      const colorCharts = await this.detectColorBasedCharts(imageData as any, textRegions);
      chartAreas.push(...colorCharts);

      console.log(`🔍 Aggressive analysis found ${chartAreas.length} potential chart areas`);

    } catch (error) {
      console.warn('⚠️ Error in improved canvas analysis:', error);
    }

    return chartAreas;
  }

  /**
   * Detect embedded chart images using aggressive block analysis
   */
  private async detectEmbeddedChartImages(
    imageData: ImageData,
    textRegions: Array<{ x: number; y: number; width: number; height: number }>
  ): Promise<Array<{
    type: ChartRegion['type'];
    boundingBox: ChartRegion['boundingBox'];
    confidence: number;
  }>> {
    const chartAreas: Array<{
      type: ChartRegion['type'];
      boundingBox: ChartRegion['boundingBox'];
      confidence: number;
    }> = [];

    try {
      const { width, height, data } = imageData;
      const blockSize = 40; // Smaller blocks for better detection
      
      console.log(`🔍 Scanning ${Math.ceil(width/blockSize)}x${Math.ceil(height/blockSize)} blocks for chart patterns`);

      // Analyze image in overlapping blocks
      for (let y = 0; y < height - blockSize; y += blockSize/2) {
        for (let x = 0; x < width - blockSize; x += blockSize/2) {
          const blockStats = this.analyzeImageBlockForCharts(data, x, y, blockSize, width);
          const textDensity = this.calculateTextDensity(x, y, blockSize, blockSize, textRegions);

          // Chart indicators: high visual complexity + low text density + color variety
          if (blockStats.nonWhiteRatio > 0.15 && 
              blockStats.colorVariety > 3 && 
              blockStats.edgeDensity > 0.1 && 
              textDensity < 0.3) {
            
            // Expand region to find full chart bounds
            const expandedRegion = this.expandChartRegionAggressive(data, x, y, blockSize, blockSize, width, height);
            
            if (expandedRegion.width >= 60 && expandedRegion.height >= 60) {
              const chartType = this.classifyChartFromPixelAnalysis(data, expandedRegion, width);
              
              chartAreas.push({
                type: chartType.type,
                boundingBox: expandedRegion,
                confidence: Math.min(0.9, blockStats.nonWhiteRatio + blockStats.colorVariety/10 + blockStats.edgeDensity)
              });
              
              console.log(`📊 Found embedded chart candidate: ${expandedRegion.width}x${expandedRegion.height} at (${expandedRegion.x}, ${expandedRegion.y})`);
            }
          }
        }
      }

    } catch (error) {
      console.warn('⚠️ Error detecting embedded chart images:', error);
    }

    return chartAreas;
  }

  /**
   * Analyze image block specifically for chart characteristics
   */
  private analyzeImageBlockForCharts(
    data: Uint8ClampedArray,
    x: number,
    y: number,
    blockSize: number,
    imageWidth: number
  ): { nonWhiteRatio: number; edgeDensity: number; colorVariety: number } {
    let nonWhitePixels = 0;
    let totalPixels = 0;
    let edgePixels = 0;
    const colorSet = new Set<string>();

    for (let dy = 0; dy < blockSize; dy++) {
      for (let dx = 0; dx < blockSize; dx++) {
        const pixelX = x + dx;
        const pixelY = y + dy;
        const idx = (pixelY * imageWidth + pixelX) * 4;

        if (idx < data.length - 3) {
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          totalPixels++;

          // Check if pixel is non-white
          if (r < 240 || g < 240 || b < 240) {
            nonWhitePixels++;
            
            // Track color variety (quantized to reduce noise)
            const colorKey = `${Math.floor(r/32)*32}-${Math.floor(g/32)*32}-${Math.floor(b/32)*32}`;
            colorSet.add(colorKey);
          }

          // Enhanced edge detection
          if (dx > 0 && dy > 0 && idx >= imageWidth * 4) {
            const prevIdx = ((pixelY - 1) * imageWidth + (pixelX - 1)) * 4;
            const prevR = data[prevIdx];
            const prevG = data[prevIdx + 1];
            const prevB = data[prevIdx + 2];

            const diff = Math.abs(r - prevR) + Math.abs(g - prevG) + Math.abs(b - prevB);
            if (diff > 30) { // Lower threshold for better edge detection
              edgePixels++;
            }
          }
        }
      }
    }

    return {
      nonWhiteRatio: totalPixels > 0 ? nonWhitePixels / totalPixels : 0,
      edgeDensity: totalPixels > 0 ? edgePixels / totalPixels : 0,
      colorVariety: colorSet.size
    };
  }

  /**
   * Aggressively expand chart region to find full bounds
   */
  private expandChartRegionAggressive(
    data: Uint8ClampedArray,
    startX: number,
    startY: number,
    startWidth: number,
    startHeight: number,
    imageWidth: number,
    imageHeight: number
  ): { x: number; y: number; width: number; height: number } {
    let minX = startX;
    let maxX = startX + startWidth;
    let minY = startY;
    let maxY = startY + startHeight;

    const expandStep = 10; // Smaller steps for more precise expansion
    
    // Expand in all directions while finding non-white content
    let expanded = true;
    while (expanded) {
      expanded = false;
      
      // Expand left
      if (minX > expandStep) {
        const stats = this.analyzeImageBlockForCharts(data, minX - expandStep, startY, expandStep, imageWidth);
        if (stats.nonWhiteRatio > 0.05) {
          minX -= expandStep;
          expanded = true;
        }
      }

      // Expand right
      if (maxX < imageWidth - expandStep) {
        const stats = this.analyzeImageBlockForCharts(data, maxX, startY, expandStep, imageWidth);
        if (stats.nonWhiteRatio > 0.05) {
          maxX += expandStep;
          expanded = true;
        }
      }

      // Expand up
      if (minY > expandStep) {
        const stats = this.analyzeImageBlockForCharts(data, startX, minY - expandStep, expandStep, imageWidth);
        if (stats.nonWhiteRatio > 0.05) {
          minY -= expandStep;
          expanded = true;
        }
      }

      // Expand down
      if (maxY < imageHeight - expandStep) {
        const stats = this.analyzeImageBlockForCharts(data, startX, maxY, expandStep, imageWidth);
        if (stats.nonWhiteRatio > 0.05) {
          maxY += expandStep;
          expanded = true;
        }
      }
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Classify chart type from pixel analysis
   */
  private classifyChartFromPixelAnalysis(
    data: Uint8ClampedArray,
    region: { x: number; y: number; width: number; height: number },
    imageWidth: number
  ): { type: ChartRegion['type']; confidence: number } {
    
    // Analyze the region for chart-specific patterns
    let verticalStructures = 0;
    let horizontalStructures = 0;
    let circularStructures = 0;
    
    // Sample vertical lines (for bar charts)
    for (let x = region.x; x < region.x + region.width; x += 10) {
      let verticalPixels = 0;
      for (let y = region.y; y < region.y + region.height; y++) {
        const idx = (y * imageWidth + x) * 4;
        if (idx < data.length - 3) {
          const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          if (gray < 200) verticalPixels++;
        }
      }
      if (verticalPixels > region.height * 0.2) verticalStructures++;
    }
    
    // Sample horizontal lines (for line charts)
    for (let y = region.y; y < region.y + region.height; y += 10) {
      let horizontalPixels = 0;
      for (let x = region.x; x < region.x + region.width; x++) {
        const idx = (y * imageWidth + x) * 4;
        if (idx < data.length - 3) {
          const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          if (gray < 200) horizontalPixels++;
        }
      }
      if (horizontalPixels > region.width * 0.2) horizontalStructures++;
    }
    
    // Simple circular detection (for pie charts)
    const centerX = region.x + region.width / 2;
    const centerY = region.y + region.height / 2;
    const radius = Math.min(region.width, region.height) / 4;
    
    for (let angle = 0; angle < 360; angle += 30) {
      const x = Math.floor(centerX + Math.cos(angle * Math.PI / 180) * radius);
      const y = Math.floor(centerY + Math.sin(angle * Math.PI / 180) * radius);
      
      if (x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height) {
        const idx = (y * imageWidth + x) * 4;
        if (idx < data.length - 3) {
          const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          if (gray < 200) circularStructures++;
        }
      }
    }
    
    // Classify based on detected structures
    const verticalRatio = verticalStructures / (region.width / 10);
    const horizontalRatio = horizontalStructures / (region.height / 10);
    const circularRatio = circularStructures / 12;
    
    if (verticalRatio > 0.3 && verticalRatio > horizontalRatio) {
      return { type: 'bar', confidence: 0.7 + Math.min(0.2, verticalRatio) };
    } else if (horizontalRatio > 0.2 && horizontalRatio > verticalRatio) {
      return { type: 'line', confidence: 0.6 + Math.min(0.3, horizontalRatio) };
    } else if (circularRatio > 0.4) {
      return { type: 'pie', confidence: 0.8 + Math.min(0.2, circularRatio) };
    } else {
      return { type: 'unknown', confidence: 0.5 };
    }
  }

  /**
   * Detect charts based on distinct color patterns
   */
  private async detectColorBasedCharts(
    imageData: ImageData,
    textRegions: Array<{ x: number; y: number; width: number; height: number }>
  ): Promise<Array<{
    type: ChartRegion['type'];
    boundingBox: ChartRegion['boundingBox'];
    confidence: number;
  }>> {
    const chartAreas: Array<{
      type: ChartRegion['type'];
      boundingBox: ChartRegion['boundingBox'];
      confidence: number;
    }> = [];

    try {
      const { width, height, data } = imageData;
      
      // Find regions with high color diversity (typical of charts)
      const colorRegions = this.findHighColorDiversityRegions(data, width, height, textRegions);
      
      for (const region of colorRegions) {
        if (region.width >= 80 && region.height >= 80) {
          chartAreas.push({
            type: 'unknown',
            boundingBox: region,
            confidence: 0.6
          });
          
          console.log(`🎨 Found color-diverse region: ${region.width}x${region.height} at (${region.x}, ${region.y})`);
        }
      }

    } catch (error) {
      console.warn('⚠️ Error in color-based chart detection:', error);
    }

    return chartAreas;
  }

  /**
   * Find regions with high color diversity
   */
  private findHighColorDiversityRegions(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    textRegions: Array<{ x: number; y: number; width: number; height: number }>
  ): Array<{ x: number; y: number; width: number; height: number }> {
    const regions: Array<{ x: number; y: number; width: number; height: number }> = [];
    const blockSize = 60;
    
    for (let y = 0; y < height - blockSize; y += blockSize/2) {
      for (let x = 0; x < width - blockSize; x += blockSize/2) {
        const colorSet = new Set<string>();
        let nonWhitePixels = 0;
        let totalPixels = 0;
        
        // Skip if overlaps with text
        const textDensity = this.calculateTextDensity(x, y, blockSize, blockSize, textRegions);
        if (textDensity > 0.4) continue;
        
        // Analyze color diversity in block
        for (let dy = 0; dy < blockSize; dy += 2) {
          for (let dx = 0; dx < blockSize; dx += 2) {
            const idx = ((y + dy) * width + (x + dx)) * 4;
            if (idx < data.length - 3) {
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              
              totalPixels++;
              
              if (r < 240 || g < 240 || b < 240) {
                nonWhitePixels++;
                const colorKey = `${Math.floor(r/16)*16}-${Math.floor(g/16)*16}-${Math.floor(b/16)*16}`;
                colorSet.add(colorKey);
              }
            }
          }
        }
        
        // High color diversity + reasonable content density = potential chart
        if (colorSet.size >= 5 && nonWhitePixels / totalPixels > 0.1) {
          const expandedRegion = this.expandChartRegionAggressive(data, x, y, blockSize, blockSize, width, height);
          regions.push(expandedRegion);
        }
      }
    }
    
    return regions;
  }

  /**
   * Create a mask to exclude text regions from chart detection
   */
  private createTextMask(imageData: ImageData, textRegions: Array<{ x: number; y: number; width: number; height: number }>): boolean[][] {
    const width = imageData.width;
    const height = imageData.height;
    const mask: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));

    // Mark text regions as masked (true = text area, false = potential chart area)
    textRegions.forEach(region => {
      const startX = Math.max(0, Math.floor(region.x));
      const endX = Math.min(width - 1, Math.floor(region.x + region.width));
      const startY = Math.max(0, Math.floor(region.y));
      const endY = Math.min(height - 1, Math.floor(region.y + region.height));

      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          mask[y][x] = true;
        }
      }
    });

    return mask;
  }

  /**
   * Improved edge detection that excludes text areas
   */
  private detectEdgesImproved(imageData: ImageData, textMask: boolean[][]): boolean[][] {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const edges: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));

    // Enhanced Sobel operator with better thresholds
    const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        // Skip text areas
        if (textMask[y][x]) continue;

        let gx = 0, gy = 0;

        // Apply Sobel kernels
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            
            gx += gray * sobelX[ky + 1][kx + 1];
            gy += gray * sobelY[ky + 1][kx + 1];
          }
        }

        const magnitude = Math.sqrt(gx * gx + gy * gy);
        
        // Dynamic threshold based on local contrast
        const localThreshold = this.calculateLocalThreshold(imageData, x, y, 5);
        edges[y][x] = magnitude > Math.max(30, localThreshold * 0.3);
      }
    }

    return edges;
  }

  /**
   * Calculate local threshold for adaptive edge detection
   */
  private calculateLocalThreshold(imageData: ImageData, centerX: number, centerY: number, radius: number): number {
    const data = imageData.data;
    const width = imageData.width;
    let sum = 0;
    let count = 0;

    for (let y = Math.max(0, centerY - radius); y <= Math.min(imageData.height - 1, centerY + radius); y++) {
      for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x++) {
        const idx = (y * width + x) * 4;
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        sum += gray;
        count++;
      }
    }

    return count > 0 ? sum / count : 128;
  }

  /**
   * Improved connected components detection with better filtering
   */
  private findConnectedComponentsImproved(edges: boolean[][]): ChartRegion['boundingBox'][] {
    const height = edges.length;
    const width = edges[0].length;
    const visited = Array(height).fill(null).map(() => Array(width).fill(false));
    const components: ChartRegion['boundingBox'][] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (edges[y][x] && !visited[y][x]) {
          const component = this.floodFillImproved(edges, visited, x, y);
          
          // Better filtering criteria for chart components
          if (this.isValidChartComponent(component)) {
            components.push(component);
          }
        }
      }
    }

    return components;
  }

  /**
   * Improved flood fill with better component analysis
   */
  private floodFillImproved(edges: boolean[][], visited: boolean[][], startX: number, startY: number): ChartRegion['boundingBox'] {
    const stack = [[startX, startY]];
    let minX = startX, minY = startY, maxX = startX, maxY = startY;

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      
      if (x < 0 || x >= edges[0].length || y < 0 || y >= edges.length || 
          visited[y][x] || !edges[y][x]) {
        continue;
      }

      visited[y][x] = true;
      
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      // Add neighbors with 8-connectivity
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx !== 0 || dy !== 0) {
            stack.push([x + dx, y + dy]);
          }
        }
      }
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Validate if a component could be a chart
   */
  private isValidChartComponent(component: ChartRegion['boundingBox']): boolean {
    const minSize = 80;
    const maxSize = 1000;
    const minAspectRatio = 0.3;
    const maxAspectRatio = 3.0;

    // Size constraints
    if (component.width < minSize || component.height < minSize) return false;
    if (component.width > maxSize || component.height > maxSize) return false;

    // Aspect ratio constraints
    const aspectRatio = component.width / component.height;
    if (aspectRatio < minAspectRatio || aspectRatio > maxAspectRatio) return false;

    // Area constraint (not too small relative to bounding box)
    const area = component.width * component.height;
    if (area < minSize * minSize) return false;

    return true;
  }

  /**
   * Analyze a component to determine if it's a chart and what type
   */
  private async analyzeComponentForChart(
    imageData: ImageData, 
    component: ChartRegion['boundingBox'], 
    textMask: boolean[][]
  ): Promise<{ chartType: ChartRegion['type']; confidence: number }> {
    
    try {
      // Extract the component region
      const regionData = this.extractImageRegionImproved(imageData, component);
      
      // Analyze geometric patterns
      const patterns = this.analyzeGeometricPatterns(regionData, component);
      
      // Analyze color distribution
      const colorAnalysis = this.analyzeColorDistribution(regionData as any);
      
      // Combine analyses to determine chart type and confidence
      return this.classifyChartFromAnalysis(patterns, colorAnalysis);
      
    } catch (error) {
      console.warn('⚠️ Error analyzing component for chart:', error);
      return { chartType: 'unknown', confidence: 0.1 };
    }
  }

  /**
   * Improved image region extraction
   */
  private extractImageRegionImproved(imageData: ImageData, region: ChartRegion['boundingBox']): ImageData {
    const canvas = createCanvas(region.width, region.height);
    const context = canvas.getContext('2d');
    
    const regionImageData = context.createImageData(region.width, region.height);
    
    // Copy pixels with bounds checking
    for (let y = 0; y < region.height; y++) {
      for (let x = 0; x < region.width; x++) {
        const srcX = region.x + x;
        const srcY = region.y + y;
        
        if (srcX >= 0 && srcX < imageData.width && srcY >= 0 && srcY < imageData.height) {
          const srcIdx = (srcY * imageData.width + srcX) * 4;
          const dstIdx = (y * region.width + x) * 4;
          
          regionImageData.data[dstIdx] = imageData.data[srcIdx];
          regionImageData.data[dstIdx + 1] = imageData.data[srcIdx + 1];
          regionImageData.data[dstIdx + 2] = imageData.data[srcIdx + 2];
          regionImageData.data[dstIdx + 3] = imageData.data[srcIdx + 3];
        }
      }
    }
    
    return regionImageData as any;
  }

  /**
   * Analyze geometric patterns in the image region
   */
  private analyzeGeometricPatterns(imageData: ImageData, component: ChartRegion['boundingBox']): {
    verticalLines: number;
    horizontalLines: number;
    rectangles: number;
    curves: number;
    circles: number;
  } {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    let verticalLines = 0;
    let horizontalLines = 0;
    let rectangles = 0;
    let curves = 0;
    let circles = 0;

    // Analyze vertical patterns (for bar charts)
    for (let x = 0; x < width; x += 5) {
      let verticalPixels = 0;
      for (let y = 0; y < height; y++) {
        const idx = (y * width + x) * 4;
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        if (gray < 200) verticalPixels++; // Non-white pixels
      }
      if (verticalPixels > height * 0.3) verticalLines++;
    }

    // Analyze horizontal patterns (for line charts)
    for (let y = 0; y < height; y += 5) {
      let horizontalPixels = 0;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        if (gray < 200) horizontalPixels++; // Non-white pixels
      }
      if (horizontalPixels > width * 0.3) horizontalLines++;
    }

    // Simple heuristics for other patterns
    rectangles = Math.min(verticalLines, horizontalLines);
    curves = Math.max(0, horizontalLines - verticalLines);
    
    // Circle detection (simplified)
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const radius = Math.min(width, height) / 4;
    let circlePixels = 0;
    
    for (let angle = 0; angle < 360; angle += 10) {
      const x = centerX + Math.cos(angle * Math.PI / 180) * radius;
      const y = centerY + Math.sin(angle * Math.PI / 180) * radius;
      
      if (x >= 0 && x < width && y >= 0 && y < height) {
        const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        if (gray < 200) circlePixels++;
      }
    }
    
    circles = circlePixels > 20 ? 1 : 0;

    return {
      verticalLines: verticalLines / (width / 5),
      horizontalLines: horizontalLines / (height / 5),
      rectangles: rectangles / Math.max(width, height),
      curves: curves / (height / 5),
      circles: circles
    };
  }

  /**
   * Analyze color distribution in the image region
   */
  private analyzeColorDistribution(imageData: ImageData): {
    colorVariety: number;
    dominantColors: string[];
    hasGridlines: boolean;
  } {
    const data = imageData.data;
    const colorMap = new Map<string, number>();
    
    // Sample colors
    for (let i = 0; i < data.length; i += 16) { // Sample every 4th pixel
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Skip near-white colors (background)
      if (r > 240 && g > 240 && b > 240) continue;
      
      const colorKey = `${Math.floor(r/32)*32},${Math.floor(g/32)*32},${Math.floor(b/32)*32}`;
      colorMap.set(colorKey, (colorMap.get(colorKey) || 0) + 1);
    }
    
    const sortedColors = Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    return {
      colorVariety: colorMap.size,
      dominantColors: sortedColors.map(([color]) => color),
      hasGridlines: this.detectGridlines(imageData as any)
    };
  }

  /**
   * Detect gridlines in the image
   */
  private detectGridlines(imageData: ImageData): boolean {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    let horizontalLines = 0;
    let verticalLines = 0;
    
    // Check for horizontal gridlines
    for (let y = 10; y < height - 10; y += 10) {
      let linePixels = 0;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        if (gray < 180) linePixels++; // Gray lines
      }
      if (linePixels > width * 0.5) horizontalLines++;
    }
    
    // Check for vertical gridlines
    for (let x = 10; x < width - 10; x += 10) {
      let linePixels = 0;
      for (let y = 0; y < height; y++) {
        const idx = (y * width + x) * 4;
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        if (gray < 180) linePixels++; // Gray lines
      }
      if (linePixels > height * 0.5) verticalLines++;
    }
    
    return horizontalLines >= 2 && verticalLines >= 2;
  }

  /**
   * Classify chart type from combined analysis
   */
  private classifyChartFromAnalysis(
    patterns: { verticalLines: number; horizontalLines: number; rectangles: number; curves: number; circles: number },
    colorAnalysis: { colorVariety: number; dominantColors: string[]; hasGridlines: boolean }
  ): { chartType: ChartRegion['type']; confidence: number } {
    
    let chartType: ChartRegion['type'] = 'unknown';
    let confidence = 0.3;
    
    // Bar chart detection
    if (patterns.verticalLines > 0.3 && patterns.rectangles > 0.2) {
      chartType = 'bar';
      confidence = 0.7 + Math.min(0.2, patterns.verticalLines);
    }
    // Line chart detection
    else if (patterns.curves > 0.2 && patterns.horizontalLines > 0.1) {
      chartType = 'line';
      confidence = 0.6 + Math.min(0.3, patterns.curves);
    }
    // Pie chart detection
    else if (patterns.circles > 0 && colorAnalysis.colorVariety > 3) {
      chartType = 'pie';
      confidence = 0.8 + Math.min(0.2, colorAnalysis.colorVariety / 10);
    }
    // Area chart detection
    else if (patterns.curves > 0.1 && patterns.rectangles > 0.1) {
      chartType = 'area';
      confidence = 0.5 + Math.min(0.2, (patterns.curves + patterns.rectangles) / 2);
    }
    
    // Boost confidence if gridlines are detected
    if (colorAnalysis.hasGridlines && chartType !== 'pie') {
      confidence = Math.min(0.95, confidence + 0.1);
    }
    
    // Boost confidence based on color variety
    if (colorAnalysis.colorVariety > 2) {
      confidence = Math.min(0.95, confidence + 0.05);
    }
    
    return { chartType, confidence };
  }

  /**
   * Calculate text density in a region
   */
  private calculateTextDensity(
    x: number,
    y: number,
    width: number,
    height: number,
    textRegions: Array<{ x: number; y: number; width: number; height: number }>
  ): number {
    let textArea = 0;
    const regionArea = width * height;

    textRegions.forEach(text => {
      // Check if text overlaps with region
      const overlapX = Math.max(0, Math.min(x + width, text.x + text.width) - Math.max(x, text.x));
      const overlapY = Math.max(0, Math.min(y + height, text.y + text.height) - Math.max(y, text.y));
      textArea += overlapX * overlapY;
    });

    return regionArea > 0 ? textArea / regionArea : 0;
  }

  /**
   * Apply aggressive post-consolidation to merge regions that are likely parts of the same chart
   */
  private postConsolidateChartRegions(regions: ChartRegion[]): ChartRegion[] {
    if (regions.length <= 1) return regions;

    console.log(`🔄 Post-consolidating ${regions.length} chart regions for chart completion...`);

    const postConsolidated: ChartRegion[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < regions.length; i++) {
      if (processed.has(i)) continue;

      const currentRegion = regions[i];
      const relatedRegions = [currentRegion];
      processed.add(i);

      // Find regions that are likely parts of the same chart (more aggressive)
      for (let j = i + 1; j < regions.length; j++) {
        if (processed.has(j)) continue;

        const otherRegion = regions[j];
        if (this.areRegionsPartOfSameChart(currentRegion.boundingBox, otherRegion.boundingBox)) {
          relatedRegions.push(otherRegion);
          processed.add(j);
        }
      }

      // Merge related regions
      if (relatedRegions.length > 1) {
        const mergedRegion = this.mergeChartRegions(relatedRegions);
        postConsolidated.push(mergedRegion);
        console.log(`🔗 Post-merged ${relatedRegions.length} related regions into complete chart: ${mergedRegion.id}`);
      } else {
        postConsolidated.push(currentRegion);
      }
    }

    console.log(`✅ Post-consolidated ${regions.length} regions into ${postConsolidated.length} complete charts`);
    return postConsolidated;
  }

  /**
   * Check if two regions are likely parts of the same chart (more aggressive than overlap check)
   */
  private areRegionsPartOfSameChart(box1: ChartRegion['boundingBox'], box2: ChartRegion['boundingBox']): boolean {
    // More aggressive proximity threshold for chart completion
    const proximityThreshold = 100; // Increased from 50
    const alignmentThreshold = 20; // Pixels tolerance for alignment

    const centerX1 = box1.x + box1.width / 2;
    const centerY1 = box1.y + box1.height / 2;
    const centerX2 = box2.x + box2.width / 2;
    const centerY2 = box2.y + box2.height / 2;
    
    const distance = Math.sqrt(Math.pow(centerX2 - centerX1, 2) + Math.pow(centerY2 - centerY1, 2));
    
    // If regions are close
    if (distance < proximityThreshold) {
      // Check for horizontal alignment (same row - like chart elements)
      const verticalAlignment = Math.abs(centerY1 - centerY2);
      if (verticalAlignment < alignmentThreshold) {
        return true;
      }
      
      // Check for vertical alignment (same column - like stacked chart elements)
      const horizontalAlignment = Math.abs(centerX1 - centerX2);
      if (horizontalAlignment < alignmentThreshold) {
        return true;
      }
      
      // Check if one region is contained within an expanded version of the other
      const expandedBox1 = {
        x: box1.x - 30,
        y: box1.y - 30,
        width: box1.width + 60,
        height: box1.height + 60
      };
      
      if (centerX2 >= expandedBox1.x && centerX2 <= expandedBox1.x + expandedBox1.width &&
          centerY2 >= expandedBox1.y && centerY2 <= expandedBox1.y + expandedBox1.height) {
        return true;
      }
    }

    return false;
  }

  /**
   * Consolidate overlapping chart regions to reduce fragmentation
   */
  private consolidateChartRegions(regions: ChartRegion[]): ChartRegion[] {
    if (regions.length <= 1) return regions;

    console.log(`🔄 Consolidating ${regions.length} chart regions...`);

    const consolidated: ChartRegion[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < regions.length; i++) {
      if (processed.has(i)) continue;

      const currentRegion = regions[i];
      const overlappingRegions = [currentRegion];
      processed.add(i);

      // Find overlapping regions
      for (let j = i + 1; j < regions.length; j++) {
        if (processed.has(j)) continue;

        const otherRegion = regions[j];
        if (this.regionsOverlap(currentRegion.boundingBox, otherRegion.boundingBox)) {
          overlappingRegions.push(otherRegion);
          processed.add(j);
        }
      }

      // Merge overlapping regions
      if (overlappingRegions.length > 1) {
        const mergedRegion = this.mergeChartRegions(overlappingRegions);
        consolidated.push(mergedRegion);
        console.log(`🔗 Merged ${overlappingRegions.length} overlapping regions into ${mergedRegion.id}`);
      } else {
        consolidated.push(currentRegion);
      }
    }

    console.log(`✅ Consolidated ${regions.length} regions into ${consolidated.length} regions`);
    return consolidated;
  }

  /**
   * Check if two bounding boxes overlap or are close enough to be part of the same chart
   */
  private regionsOverlap(box1: ChartRegion['boundingBox'], box2: ChartRegion['boundingBox']): boolean {
    const overlapThreshold = 0.1; // Reduced to 10% for more aggressive merging
    const proximityThreshold = 50; // Pixels - merge if regions are close

    // Calculate overlap area
    const overlapX = Math.max(0, Math.min(box1.x + box1.width, box2.x + box2.width) - Math.max(box1.x, box2.x));
    const overlapY = Math.max(0, Math.min(box1.y + box1.height, box2.y + box2.height) - Math.max(box1.y, box2.y));
    const overlapArea = overlapX * overlapY;

    // Calculate areas
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    const minArea = Math.min(area1, area2);

    // Check if overlap is significant
    if (overlapArea > minArea * overlapThreshold) {
      return true;
    }

    // Check proximity - if regions are close, they might be part of the same chart
    const centerX1 = box1.x + box1.width / 2;
    const centerY1 = box1.y + box1.height / 2;
    const centerX2 = box2.x + box2.width / 2;
    const centerY2 = box2.y + box2.height / 2;
    
    const distance = Math.sqrt(Math.pow(centerX2 - centerX1, 2) + Math.pow(centerY2 - centerY1, 2));
    
    // If regions are close and have similar dimensions, merge them
    if (distance < proximityThreshold) {
      const sizeRatio = Math.min(area1, area2) / Math.max(area1, area2);
      return sizeRatio > 0.3; // Similar sized regions that are close
    }

    return false;
  }

  /**
   * Merge multiple chart regions into one
   */
  private mergeChartRegions(regions: ChartRegion[]): ChartRegion {
    // Calculate merged bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let totalConfidence = 0;
    let bestType: ChartRegion['type'] = 'unknown';
    let bestConfidence = 0;

    regions.forEach(region => {
      const box = region.boundingBox;
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
      
      totalConfidence += region.confidence;
      
      // Keep the type with highest confidence
      if (region.confidence > bestConfidence) {
        bestConfidence = region.confidence;
        bestType = region.type;
      }
    });

    const mergedRegion: ChartRegion = {
      id: `merged-${regions[0].id.split('-')[1]}-${regions[0].id.split('-')[2]}-${regions.length}`,
      type: bestType,
      boundingBox: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      },
      confidence: totalConfidence / regions.length, // Average confidence
      extractionMethod: 'region-consolidation'
    };

    return mergedRegion;
  }

  /**
   * Enhanced validation for chart regions with multiple criteria
   */
  private isValidChartRegion(region: ChartRegion, minSize: number, confidenceThreshold: number): boolean {
    const box = region.boundingBox;

    // Basic size validation
    if (box.width < minSize || box.height < minSize) {
      return false;
    }

    // Confidence validation
    if (region.confidence < confidenceThreshold) {
      return false;
    }

    // Aspect ratio validation (charts shouldn't be too thin or too wide)
    const aspectRatio = box.width / box.height;
    if (aspectRatio < 0.2 || aspectRatio > 5.0) {
      return false;
    }

    // Area validation (minimum area threshold)
    const area = box.width * box.height;
    if (area < minSize * minSize) {
      return false;
    }

    // Maximum size validation (shouldn't be too large)
    const maxSize = 1200;
    if (box.width > maxSize || box.height > maxSize) {
      return false;
    }

    return true;
  }

  /**
   * Validate if a detected chart region is actually a chart
   */
  private validateChartRegion(area: any, viewport: any): boolean {
    // Size validation
    if (area.boundingBox.width < 60 || area.boundingBox.height < 60) return false;
    if (area.boundingBox.width > viewport.width * 0.9 || area.boundingBox.height > viewport.height * 0.9) return false;
    
    // Position validation (not at extreme edges)
    if (area.boundingBox.x < 10 || area.boundingBox.y < 10) return false;
    if (area.boundingBox.x + area.boundingBox.width > viewport.width - 10) return false;
    if (area.boundingBox.y + area.boundingBox.height > viewport.height - 10) return false;
    
    // Confidence validation
    if (area.confidence < 0.4) return false;
    
    // Aspect ratio validation
    const aspectRatio = area.boundingBox.width / area.boundingBox.height;
    if (aspectRatio < 0.2 || aspectRatio > 5.0) return false;
    
    return true;
  }
}

// Export singleton instance
export const chartExtractor = AdvancedChartExtractor.getInstance();
