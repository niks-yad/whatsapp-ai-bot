// Direct API test using HTTP requests instead of HF client library
require('dotenv').config();
const axios = require('axios');

async function testDirectAPI() {
  console.log('🚀 Testing HuggingFace API directly...');
  
  // Download test image
  console.log('📥 Downloading test image...');
  const imageUrl = 'https://cdn.decohere.ai/cus_QmeRRs7CrpQL06-stablevideo/outputs/1726264824656/example_image.webp';
  
  try {
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    const imageBuffer = Buffer.from(imageResponse.data);
    console.log(`✅ Downloaded ${imageBuffer.length} bytes`);
    
    // Test models using direct HTTP API
    const models = [
      'haywoodsloan/ai-image-detector-deploy',
      'umm-maybe/AI-image-detector',
      'legekka/AI-Anime-Image-Detector-ViT'
    ];
    
    for (const model of models) {
      console.log(`\n🔍 Testing ${model}...`);
      
      try {
        const response = await axios.post(
          `https://api-inference.huggingface.co/models/${model}`,
          imageBuffer,
          {
            headers: {
              'Authorization': `Bearer ${process.env.HUGGINGFACE_TOKEN}`,
              'Content-Type': 'application/octet-stream'
            },
            timeout: 30000
          }
        );
        
        console.log(`✅ ${model} response:`, JSON.stringify(response.data, null, 2));
        
        // Analyze results
        if (Array.isArray(response.data) && response.data.length > 0) {
          console.log(`📊 Top predictions for ${model}:`);
          response.data.slice(0, 3).forEach((pred, i) => {
            console.log(`  ${i+1}. ${pred.label}: ${(pred.score * 100).toFixed(1)}%`);
          });
        }
        
      } catch (error) {
        console.log(`❌ ${model} failed:`, error.response?.data || error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testDirectAPI();