import fs from 'fs';
import parseLivescore from './parser';

async function parseFile(htmlFilePath: string) {
  try {
    // Read the HTML file
    const html = fs.readFileSync(htmlFilePath, 'utf-8');
    
    // Parse the HTML
    const stages = parseLivescore(html);
    
    // Create output filename based on input filename
    const outputPath = htmlFilePath.replace('.html', '.json');
    
    // Write the JSON output
    fs.writeFileSync(outputPath, JSON.stringify(stages, null, 2));
    
    // eslint-disable-next-line no-console
    console.log(`Successfully parsed ${htmlFilePath}`);
    // eslint-disable-next-line no-console
    console.log(`Output written to ${outputPath}`);
  } catch (error) {
    console.error('Error parsing file:', error);
    process.exit(1);
  }
}

// Get the HTML file path from command line arguments
const htmlFilePath = process.argv[2];

if (!htmlFilePath) {
  console.error('Please provide an HTML file path as an argument');
  console.error('Usage: npm run parse-file <path-to-html-file>');
  process.exit(1);
}

parseFile(htmlFilePath); 