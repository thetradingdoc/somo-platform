#!/usr/bin/env node
/**
 * Test PDF processing with Spanish medical report
 * Usage: node scripts/test-spanish-pdf.js <path-to-pdf>
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const pdfPath = process.argv[2] || '/Users/ojrichard/Library/Application Support/Cursor/User/workspaceStorage/9d5da9572f0e3601d4aae1ebdf67e8db/pdfs/86fb8bda-5515-4997-8ef3-31d6e8de39d8/Report_MR_RodriguezMedinaMoisesMaximiliano.pdf';

process.chdir(path.join(__dirname, '..'));

async function main() {
  if (!fs.existsSync(pdfPath)) {
    console.error('❌ PDF not found:', pdfPath);
    process.exit(1);
  }

  console.log('📄 Testing PDF:', pdfPath);
  console.log('   Size:', fs.statSync(pdfPath).size, 'bytes');
  console.log('');

  const PDFCodingService = require('../services/pdf-coding-service');
  const buffer = fs.readFileSync(pdfPath);

  try {
    const result = await PDFCodingService.processPDF(buffer, {
      appointmentType: 'Unknown',
      durationMinutes: 60,
      patientContext: {},
      payerId: null,
      dateOfService: null
    });

    console.log('✅ Processing succeeded');
    console.log('');
    console.log('--- EXTRACTED TEXT (first 800 chars) ---');
    console.log((result.extractedText || '').slice(0, 800));
    console.log('--- END ---');
    console.log('');
    console.log('--- CODING RESULT ---');
    console.log('ICD-10:', JSON.stringify(result.coding?.icd10 || [], null, 2));
    console.log('CPT:', JSON.stringify(result.coding?.cpt || [], null, 2));
    console.log('Band:', result.coding?.band);
    console.log('Rationale:', result.coding?.rationale || '(none)');
    console.log('');
    console.log('--- CAN CREATE CLAIM? ---');
    const hasCodes = (result.coding?.icd10?.length > 0) || (result.coding?.cpt?.length > 0);
    console.log(hasCodes ? 'YES - codes extracted' : 'NO - no codes extracted');
  } catch (err) {
    console.error('❌ Processing failed:', err.message);
    console.error(err.stack);
    console.log('');
    console.log('--- CAN CREATE CLAIM? ---');
    console.log('NO - processing error');
    process.exit(1);
  }
}

main();
