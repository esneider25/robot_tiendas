const Tesseract = require('tesseract.js');
const Jimp = require('jimp');

async function testOCR() {
  try {
    const imagePath = 'C:\\Users\\IK\\.gemini\\antigravity-ide\\brain\\48220010-36c9-4369-8e91-755d0f5cabb7\\.user_uploaded\\media_1788301453376.png'; // Banesco receipt
    
    // Original OCR
    const worker1 = await Tesseract.createWorker('spa');
    const { data: { text: text1 } } = await worker1.recognize(imagePath);
    await worker1.terminate();
    console.log('--- ORIGINAL TEXT ---');
    console.log(text1);

    // Processed OCR (current bot logic)
    const image = await Jimp.read(imagePath);
    image.scale(2).greyscale().contrast(0.2).normalize();
    const processedBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
    
    const worker2 = await Tesseract.createWorker('spa');
    const { data: { text: text2 } } = await worker2.recognize(processedBuffer);
    await worker2.terminate();
    console.log('\n--- PROCESSED TEXT (Current Logic) ---');
    console.log(text2);
    
  } catch(e) {
    console.error(e);
  }
}
testOCR();
