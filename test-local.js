// Local testing script for AI detection
require('dotenv').config();
const axios = require('axios');

// Test images
const AI_IMAGE_URL = 'https://cdn.decohere.ai/cus_QmeRRs7CrpQL06-stablevideo/outputs/1726264824656/example_image.webp';
const REAL_IMAGE_URL = 'https://encrypted-tbn2.gstatic.com/images?q=tbn:ANd9GcQGcJrJCAoX_OsMuTOY8qb0H1SCephmGJRINBptCA7NJE8fTqQpN-NLe-FSZxNNddgGw_-p5QtmAxZ4_1Xk02PsXQ';

const SERVER_URL = 'http://localhost:3000';

// Function to download image and convert to buffer
async function downloadImage(url) {
  try {
    console.log(`📥 Downloading image from: ${url}`);
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    console.log(`✅ Downloaded ${response.data.byteLength} bytes`);
    return Buffer.from(response.data);
  } catch (error) {
    console.error(`❌ Failed to download image:`, error.message);
    throw error;
  }
}

// Function to test AI detection directly
async function testAIDetection(imageBuffer, imageType) {
  try {
    console.log(`\n🧪 Testing ${imageType} image detection...`);
    console.log(`📏 Image buffer size: ${imageBuffer.length} bytes`);
    
    // Import the detection function from server
    const { HfInference } = require('@huggingface/inference');
    
    console.log('🔑 HuggingFace token available:', process.env.HUGGINGFACE_TOKEN ? 'YES' : 'NO');
    console.log('🔑 Token length:', process.env.HUGGINGFACE_TOKEN?.length || 0);
    
    const hf = new HfInference(process.env.HUGGINGFACE_TOKEN);
    
    // Test HuggingFace connection first
    console.log('🔌 Testing HuggingFace connection...');
    
    // Try a basic test first
    try {
      console.log('🧪 Testing basic HF connection with a known working model...');
      const testResult = await hf.imageClassification({
        data: imageBuffer,
        model: 'google/vit-base-patch16-224'
      });
      console.log('✅ Basic HF connection working, got', testResult?.length || 0, 'results');
    } catch (testError) {
      console.log('❌ Basic HF test failed:', testError.message);
    }
    
    const workingModels = [
      'haywoodsloan/ai-image-detector-deploy',
      'umm-maybe/AI-image-detector',
      'legekka/AI-Anime-Image-Detector-ViT'
    ];
    
    let bestResult = null;
    
    // Try each model
    for (const modelName of workingModels) {
      try {
        console.log(`🔍 Trying ${modelName}...`);
        
        const result = await hf.imageClassification({
          data: imageBuffer,
          model: modelName
        });
        
        console.log(`✅ ${modelName} result:`, JSON.stringify(result, null, 2));
        
        if (!result || !Array.isArray(result) || result.length === 0) {
          console.log(`⚠️ ${modelName} returned invalid result`);
          continue;
        }
        
        let aiScore = 0;
        let realScore = 0;
        let hasValidResult = false;
        
        // Process results
        result.forEach(prediction => {
          if (!prediction || !prediction.label) return;
          
          const label = String(prediction.label).toLowerCase();
          const score = prediction.score || 0;
          
          console.log(`📊 ${modelName}: "${label}" = ${score}`);
          
          // Analyze labels for AI vs Real
          if (label.includes('ai') || label.includes('artificial') || 
              label.includes('generated') || label.includes('synthetic')) {
            aiScore = Math.max(aiScore, score);
            hasValidResult = true;
          } else if (label.includes('human') || label.includes('real') || 
                    label.includes('authentic') || label.includes('natural')) {
            realScore = Math.max(realScore, score);
            hasValidResult = true;
          }
        });
        
        if (hasValidResult) {
          bestResult = {
            aiScore,
            realScore,
            model: modelName,
            confidence: Math.max(aiScore, realScore)
          };
          break;
        }
        
      } catch (error) {
        console.log(`❌ ${modelName} failed:`, error.message);
      }
    }
    
    // Report results
    if (bestResult) {
      const { aiScore, realScore, model } = bestResult;
      const isAI = aiScore > realScore;
      const confidence = Math.round((isAI ? aiScore : realScore) * 100);
      
      console.log(`\n🎯 FINAL RESULT for ${imageType}:`);
      console.log(`   Status: ${isAI ? 'AI-Generated' : 'Real/Authentic'}`);
      console.log(`   Confidence: ${confidence}%`);
      console.log(`   AI Score: ${Math.round(aiScore * 100)}%`);
      console.log(`   Real Score: ${Math.round(realScore * 100)}%`);
      console.log(`   Model: ${model}`);
      
      return {
        imageType,
        isAI,
        confidence,
        aiScore: Math.round(aiScore * 100),
        realScore: Math.round(realScore * 100),
        model
      };
    } else {
      console.log(`❌ No valid results from any model for ${imageType}`);
      return null;
    }
    
  } catch (error) {
    console.error(`❌ Error testing ${imageType}:`, error.message);
    return null;
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Starting AI Detection Tests...\n');
  
  try {
    // Test 1: AI-generated image
    console.log('=' .repeat(50));
    console.log('TEST 1: AI-GENERATED IMAGE');
    console.log('=' .repeat(50));
    
    const aiImageBuffer = await downloadImage(AI_IMAGE_URL);
    const aiResult = await testAIDetection(aiImageBuffer, 'AI-Generated');
    
    // Test 2: Real image
    console.log('\n' + '=' .repeat(50));
    console.log('TEST 2: REAL/AUTHENTIC IMAGE');
    console.log('=' .repeat(50));
    
    const realImageBuffer = await downloadImage(REAL_IMAGE_URL);
    const realResult = await testAIDetection(realImageBuffer, 'Real');
    
    // Summary
    console.log('\n' + '=' .repeat(50));
    console.log('TEST SUMMARY');
    console.log('=' .repeat(50));
    
    if (aiResult) {
      console.log(`AI Image Test: ${aiResult.isAI ? '✅ CORRECT' : '❌ INCORRECT'} - Detected as ${aiResult.isAI ? 'AI' : 'Real'} (${aiResult.confidence}%)`);
    }
    
    if (realResult) {
      console.log(`Real Image Test: ${!realResult.isAI ? '✅ CORRECT' : '❌ INCORRECT'} - Detected as ${realResult.isAI ? 'AI' : 'Real'} (${realResult.confidence}%)`);
    }
    
    // Accuracy calculation
    let correct = 0;
    let total = 0;
    
    if (aiResult) {
      if (aiResult.isAI) correct++;
      total++;
    }
    
    if (realResult) {
      if (!realResult.isAI) correct++;
      total++;
    }
    
    if (total > 0) {
      const accuracy = Math.round((correct / total) * 100);
      console.log(`\n🎯 Overall Accuracy: ${correct}/${total} (${accuracy}%)`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run tests if called directly
if (require.main === module) {
  runTests().then(() => {
    console.log('\n✅ Tests completed!');
    process.exit(0);
  }).catch(error => {
    console.error('\n❌ Tests failed:', error);
    process.exit(1);
  });
}

module.exports = { runTests, testAIDetection };