// Simple test of the AI detection function
require('dotenv').config();
const axios = require('axios');
const { HfInference } = require('@huggingface/inference');

async function simpleTest() {
  console.log('🧪 Simple AI Detection Test');
  console.log('=' .repeat(40));
  
  // Download test image
  console.log('📥 Downloading test image...');
  const imageUrl = 'https://cdn.decohere.ai/cus_QmeRRs7CrpQL06-stablevideo/outputs/1726264824656/example_image.webp';
  
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    const imageBuffer = Buffer.from(response.data);
    console.log(`✅ Downloaded ${imageBuffer.length} bytes`);
    
    // Initialize HuggingFace
    console.log('🔑 Initializing HuggingFace...');
    const hf = new HfInference(process.env.HUGGINGFACE_TOKEN);
    console.log('✅ HuggingFace client created');
    
    // Test with simple model first
    console.log('🔍 Testing with google/vit-base-patch16-224...');
    const result = await hf.imageClassification({
      data: imageBuffer,
      model: 'google/vit-base-patch16-224'
    });
    
    console.log('✅ Result received:');
    console.log('📊 Results count:', result?.length || 0);
    
    if (result && result.length > 0) {
      console.log('🏆 Top 3 predictions:');
      result.slice(0, 3).forEach((pred, i) => {
        console.log(`  ${i+1}. ${pred.label}: ${(pred.score * 100).toFixed(1)}%`);
      });
    }
    
    console.log('\n✅ HuggingFace integration is working!');
    console.log('💡 The build errors should now be fixed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('🔍 Full error:', error);
  }
}

simpleTest();