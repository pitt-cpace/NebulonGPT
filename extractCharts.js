/**
 * Chart Extraction Demo - Node.js Only
 * 
 * This script demonstrates the focused chart extraction system that:
 * 1. Detects chart regions in PDF pages
 * 2. Crops and saves chart images as PNG files
 * 3. Extracts metadata and saves as JSON files
 * 
 * Usage: node extractCharts.js <pdf-file-path>
 */

const fs = require('fs');
const path = require('path');
const { getDocument } = require('pdfjs-dist');

// Import our chart extraction services
const { chartImageExtractor } = require('./src/services/chartImageExtractor');

async function extractChartsFromPDF(pdfPath, outputDir = './charts') {
  console.log(`🚀 Starting chart extraction from: ${pdfPath}`);
  console.log(`📁 Output directory: ${outputDir}`);
  
  try {
    // Read PDF file
    const pdfBuffer = fs.readFileSync(pdfPath);
    console.log(`📄 Loaded PDF: ${Math.round(pdfBuffer.length / 1024)}KB`);
    
    // Load PDF document
    const pdf = await getDocument({
      data: pdfBuffer,
      verbosity: 0,
      isEvalSupported: false,
    }).promise;
    
    console.log(`📚 PDF has ${pdf.numPages} pages`);
    
    // Initialize chart extractor with custom output directory
    const extractor = chartImageExtractor.constructor.getInstance(outputDir);
    
    const allCharts = [];
    
    // Process each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      console.log(`\n🔄 Processing page ${pageNum}/${pdf.numPages}`);
      
      const page = await pdf.getPage(pageNum);
      
      // Extract charts from this page
      const pageCharts = await extractor.extractChartsFromPage(page, pageNum, {
        minChartSize: 150,
        confidenceThreshold: 0.6,
        highResolution: true
      });
      
      allCharts.push(...pageCharts);
      
      console.log(`📊 Page ${pageNum}: Found ${pageCharts.length} charts`);
      
      // Log chart details
      pageCharts.forEach((chart, index) => {
        console.log(`  Chart ${index + 1}: ${chart.chart_type} (${(chart.confidence * 100).toFixed(1)}% confidence)`);
        console.log(`    Title: ${chart.title || 'No title'}`);
        console.log(`    X-axis: [${chart.x_axis.join(', ')}]`);
        console.log(`    Y-axis: [${chart.y_axis.join(', ')}]`);
        console.log(`    Image: ${chart.image_path}`);
        console.log(`    Bounding box: ${chart.bounding_box.width}x${chart.bounding_box.height} at (${chart.bounding_box.x}, ${chart.bounding_box.y})`);
      });
    }
    
    // Generate summary report
    const summaryReport = {
      pdf_file: path.basename(pdfPath),
      total_pages: pdf.numPages,
      total_charts: allCharts.length,
      charts_by_type: {},
      charts_by_page: {},
      extraction_summary: allCharts.map(chart => ({
        id: `page${chart.page}_chart${allCharts.filter(c => c.page === chart.page).indexOf(chart) + 1}`,
        page: chart.page,
        type: chart.chart_type,
        title: chart.title,
        confidence: chart.confidence,
        image_path: chart.image_path,
        data_points: chart.x_axis.length
      }))
    };
    
    // Count charts by type
    allCharts.forEach(chart => {
      summaryReport.charts_by_type[chart.chart_type] = (summaryReport.charts_by_type[chart.chart_type] || 0) + 1;
    });
    
    // Count charts by page
    allCharts.forEach(chart => {
      summaryReport.charts_by_page[`page_${chart.page}`] = (summaryReport.charts_by_page[`page_${chart.page}`] || 0) + 1;
    });
    
    // Save summary report
    const summaryPath = path.join(outputDir, 'extraction_summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2));
    
    console.log(`\n✅ Chart extraction completed!`);
    console.log(`📊 Summary:`);
    console.log(`   Total charts found: ${allCharts.length}`);
    console.log(`   Chart types: ${Object.entries(summaryReport.charts_by_type).map(([type, count]) => `${type}(${count})`).join(', ')}`);
    console.log(`   Output directory: ${outputDir}`);
    console.log(`   Summary report: ${summaryPath}`);
    
    // List generated files
    console.log(`\n📁 Generated files:`);
    console.log(`   Images: ${outputDir}/images/`);
    console.log(`   Metadata: ${outputDir}/metadata/`);
    
    const imagesDir = path.join(outputDir, 'images');
    const metadataDir = path.join(outputDir, 'metadata');
    
    if (fs.existsSync(imagesDir)) {
      const imageFiles = fs.readdirSync(imagesDir).filter(f => f.endsWith('.png'));
      imageFiles.forEach(file => {
        const filePath = path.join(imagesDir, file);
        const stats = fs.statSync(filePath);
        console.log(`     📸 ${file} (${Math.round(stats.size / 1024)}KB)`);
      });
    }
    
    if (fs.existsSync(metadataDir)) {
      const jsonFiles = fs.readdirSync(metadataDir).filter(f => f.endsWith('.json'));
      jsonFiles.forEach(file => {
        console.log(`     📄 ${file}`);
      });
    }
    
    return summaryReport;
    
  } catch (error) {
    console.error(`❌ Error extracting charts:`, error);
    throw error;
  }
}

// Example usage function
async function demonstrateChartExtraction() {
  console.log(`🧪 Chart Extraction Demo`);
  console.log(`========================`);
  
  // Check if PDF file path is provided
  const pdfPath = process.argv[2];
  
  if (!pdfPath) {
    console.log(`Usage: node extractCharts.js <pdf-file-path> [output-directory]`);
    console.log(`\nExample:`);
    console.log(`  node extractCharts.js ./sample.pdf`);
    console.log(`  node extractCharts.js ./documents/report.pdf ./output/charts`);
    return;
  }
  
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF file not found: ${pdfPath}`);
    return;
  }
  
  const outputDir = process.argv[3] || './charts';
  
  try {
    const summary = await extractChartsFromPDF(pdfPath, outputDir);
    
    console.log(`\n🎉 Extraction completed successfully!`);
    console.log(`\n📋 Quick Start Guide:`);
    console.log(`1. Check the images in: ${outputDir}/images/`);
    console.log(`2. Review the JSON metadata in: ${outputDir}/metadata/`);
    console.log(`3. See the summary report: ${outputDir}/extraction_summary.json`);
    
    // Show example of how to use the extracted data
    if (summary.total_charts > 0) {
      console.log(`\n💡 Example JSON output:`);
      const exampleChart = summary.extraction_summary[0];
      console.log(JSON.stringify({
        chart_type: "bar",
        title: "Monthly Sales",
        x_axis: ["Jan", "Feb", "Mar"],
        y_axis: [0, 50, 100, 150],
        series: [
          {
            label: "Revenue",
            values: [120, 180, 260]
          }
        ],
        image_path: "images/page1_chart1.png",
        page: 1,
        confidence: 0.85,
        bounding_box: { x: 100, y: 150, width: 400, height: 300 }
      }, null, 2));
    }
    
  } catch (error) {
    console.error(`❌ Demo failed:`, error.message);
    process.exit(1);
  }
}

// Run the demo if this script is executed directly
if (require.main === module) {
  demonstrateChartExtraction();
}

module.exports = {
  extractChartsFromPDF,
  demonstrateChartExtraction
};
