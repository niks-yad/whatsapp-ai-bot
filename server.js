// WhatsApp AI Detection Bot
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const twilio = require('twilio');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const extractFrames = require('ffmpeg-extract-frames');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const HUGGINGFACE_TOKEN = process.env.HUGGINGFACE_TOKEN;

// Twilio Configuration
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

let twilioClient = null;
try {
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && 
      TWILIO_ACCOUNT_SID !== 'your_twilio_account_sid' && 
      TWILIO_AUTH_TOKEN !== 'your_twilio_auth_token') {
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    console.log('✅ Twilio client initialized');
  } else {
    console.log('⚠️ Twilio not configured - SMS/WhatsApp via Twilio disabled');
  }
} catch (error) {
  console.log('❌ Twilio initialization failed:', error.message);
  twilioClient = null;
}

// AI Detection Models
const AI_MODELS = [
  'haywoodsloan/ai-image-detector-deploy',
  'umm-maybe/AI-image-detector',
  'legekka/AI-Anime-Image-Detector-ViT'
];

// User analytics (in-memory)
const userStats = new Map();

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Verification failed');
  }
});

// Webhook to receive messages
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.field === 'messages' && change.value.messages) {
            for (const message of change.value.messages) {
              await handleMessage(message, change.value);
            }
          }
        }
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).send('Error');
  }
});

// Twilio SMS/WhatsApp webhook
app.post('/twilio-webhook', async (req, res) => {
  try {
    console.log('🔄 Twilio webhook received:', req.body);
    
    const { From, To, Body, MediaUrl0, MessageSid } = req.body;
    
    // Validate required fields
    if (!From) {
      console.log('❌ Missing From parameter');
      return res.status(400).send('Missing From parameter');
    }
    
    console.log(`📱 Processing message from ${From}, Body: ${Body}, Media: ${MediaUrl0}`);
    
    // Create a simulated message object similar to WhatsApp format
    const simulatedMessage = {
      from: From.replace(/^whatsapp:/, '').replace(/^\+/, ''),
      type: MediaUrl0 ? 'image' : 'text',
      timestamp: Math.floor(Date.now() / 1000).toString()
    };

    if (MediaUrl0) {
      simulatedMessage.image = { 
        id: MessageSid,
        url: MediaUrl0
      };
      console.log('🖼️ Image message detected, URL:', MediaUrl0);
      console.log('🔑 Will authenticate with Twilio credentials for download');
    } else if (Body) {
      simulatedMessage.text = { body: Body };
      console.log('💬 Text message detected');
    }

    console.log('🚀 Calling handleTwilioMessage...');
    
    // Process the message using existing logic (keep original From format)  
    // Also pass the To field so we know which number to reply from
    await handleTwilioMessage(simulatedMessage, From, To);
    
    console.log('✅ Message processed successfully');
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Twilio webhook error:', error);
    res.status(500).send('Error');
  }
});

// Handle incoming messages
async function handleMessage(message, value) {
  const fromNumber = message.from;
  updateUserStats(fromNumber);
  
  try {
    switch (message.type) {
      case 'image':
        await handleImage(message, fromNumber);
        break;
      case 'video':
        await handleVideo(message, fromNumber);
        break;
      case 'text':
        await handleText(message, fromNumber);
        break;
      default:
        await sendWelcome(fromNumber);
    }
  } catch (error) {
    console.error('❌ Error handling message:', error);
    await sendText(fromNumber, "🚫 Something went wrong. Please try again.");
  }
}

// Handle Twilio messages
async function handleTwilioMessage(message, fromNumber) {
  updateUserStats(fromNumber);
  
  try {
    switch (message.type) {
      case 'image':
        await handleTwilioImage(message, fromNumber);
        break;
      case 'video':
        await handleTwilioVideo(message, fromNumber);
        break;
      case 'text':
        await handleTwilioText(message, fromNumber);
        break;
      default:
        await sendTwilioMessage(fromNumber, 
          "🤖 *Welcome to AI Detection Bot!*\n\n" +
          "📸 Send me images and videos and I'll detect if they're AI-generated!\n\n" +
          "💡 Commands:\n" +
          "• 'help' - More info\n" +
          "• 'stats' - Your usage\n\n" +
          "🚀 Just send your media to get started!");
    }
  } catch (error) {
    console.error('❌ Error handling Twilio message:', error);
    await sendTwilioMessage(fromNumber, "🚫 Something went wrong. Please try again.");
  }
}

// Handle image messages
async function handleImage(message, fromNumber) {
  try {
    const mediaUrl = await getMediaUrl(message.image.id);
    const imageBuffer = await downloadMedia(mediaUrl);
    const detection = await detectAI(imageBuffer);
    
    if (detection.error) {
      await sendText(fromNumber, 
        "🚫 *AI Detection Temporarily Unavailable*\n\n" +
        "⚠️ Our AI models are currently down.\n" +
        "🔧 We're working to fix this ASAP.\n\n" +
        "⏰ Please try again in a few minutes."
      );
      return;
    }
    
    await sendResult(fromNumber, detection);
    updateAnalytics(fromNumber, 'image', detection);
    
  } catch (error) {
    console.error('❌ Image error:', error);
    await sendText(fromNumber, "🖼️ Couldn't analyze this image. Try a different format.");
  }
}

// Handle video messages
async function handleVideo(message, fromNumber) {
  try {
    console.log('🎥 Processing video...');
    
    await sendText(fromNumber, 
      "🎥 *Video Analysis Starting...*\n\n" +
      "⏳ Extracting frames and analyzing each for AI detection...\n" +
      "📊 This may take 15-30 seconds depending on video length!"
    );
    
    const mediaUrl = await getMediaUrl(message.video.id);
    const videoBuffer = await downloadMedia(mediaUrl);
    
    const detection = await analyzeVideoForAI(videoBuffer);
    
    if (detection.error) {
      await sendText(fromNumber, 
        "🚫 *Video Analysis Failed*\n\n" +
        `⚠️ ${detection.message}\n\n` +
        "💡 Try:\n" +
        "• Shorter video (max 60 seconds)\n" +
        "• Smaller file size (max 16MB)\n" +
        "• MP4 format\n" +
        "• Better quality video"
      );
      return;
    }
    
    await sendResult(fromNumber, detection);
    updateAnalytics(fromNumber, 'video', detection);
    
  } catch (error) {
    console.error('❌ Video processing error:', error);
    await sendText(fromNumber, 
      "🎥 Couldn't analyze this video. Please try:\n" +
      "• Shorter video (max 60 seconds)\n" +
      "• Smaller file size (max 16MB)\n" +
      "• MP4 format\n" +
      "• Better quality video"
    );
  }
}

// Handle Twilio video messages
async function handleTwilioVideo(message, fromNumber) {
  try {
    console.log('🎥 Processing Twilio video...');
    
    await sendTwilioMessage(fromNumber, 
      "🎥 *Video Analysis Starting...*\n\n" +
      "⏳ Extracting frames and analyzing each for AI detection...\n" +
      "📊 This may take 15-30 seconds depending on video length!"
    );
    
    let videoBuffer;
    
    if (message.video && message.video.url) {
      const response = await axios.get(message.video.url, {
        responseType: 'arraybuffer',
        auth: {
          username: TWILIO_ACCOUNT_SID,
          password: TWILIO_AUTH_TOKEN
        }
      });
      videoBuffer = Buffer.from(response.data);
    } else if (message.video && message.video.id) {
      const mediaUrl = await getMediaUrl(message.video.id);
      videoBuffer = await downloadMedia(mediaUrl);
    } else {
      throw new Error('No video URL or ID found');
    }
    
    const detection = await analyzeVideoForAI(videoBuffer);
    
    if (detection.error) {
      await sendTwilioMessage(fromNumber, 
        "🚫 *Video Analysis Failed*\n\n" +
        `⚠️ ${detection.message}\n\n` +
        "💡 Try:\n" +
        "• Shorter video (max 60 seconds)\n" +
        "• Smaller file size (max 16MB)\n" +
        "• MP4 format\n" +
        "• Better quality video"
      );
      return;
    }
    
    await sendTwilioResult(fromNumber, detection);
    updateAnalytics(fromNumber, 'video', detection);
    
  } catch (error) {
    console.error('❌ Twilio video processing error:', error);
    await sendTwilioMessage(fromNumber, 
      "🎥 Couldn't analyze this video. Please try:\n" +
      "• Shorter video (max 60 seconds)\n" +
      "• Smaller file size (max 16MB)\n" +
      "• MP4 format\n" +
      "• Better quality video"
    );
  }
}

// Handle text messages
async function handleText(message, fromNumber) {
  const text = message.text.body.toLowerCase().trim();
  
  if (text.includes('help')) {
    await sendHelp(fromNumber);
  } else if (text.includes('stats')) {
    await sendStats(fromNumber);
  } else {
    await sendWelcome(fromNumber);
  }
}

// Handle Twilio image messages
async function handleTwilioImage(message, fromNumber) {
  try {
    let imageBuffer;
    
    console.log('🖼️ Processing Twilio image message:', {
      hasUrl: !!message.image?.url,
      hasId: !!message.image?.id,
      messageStructure: Object.keys(message)
    });
    
    if (message.image && message.image.url) {
      console.log('📥 Downloading image from Twilio URL...');
      // Direct URL from Twilio - requires authentication
      const response = await axios.get(message.image.url, {
        responseType: 'arraybuffer',
        auth: {
          username: TWILIO_ACCOUNT_SID,
          password: TWILIO_AUTH_TOKEN
        }
      });
      imageBuffer = Buffer.from(response.data);
      console.log(`✅ Downloaded ${imageBuffer.length} bytes from Twilio`);
      
      // Debug: Check what we actually downloaded
      const firstBytes = Array.from(imageBuffer.slice(0, 10)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' ');
      console.log(`🔍 Downloaded data starts with: ${firstBytes}`);
    } else if (message.image && message.image.id) {
      console.log('📥 Downloading image via WhatsApp Media API...');
      // Fallback to original WhatsApp method
      const mediaUrl = await getMediaUrl(message.image.id);
      imageBuffer = await downloadMedia(mediaUrl);
      console.log(`✅ Downloaded ${imageBuffer.length} bytes from WhatsApp`);
    } else {
      throw new Error('No image URL or ID found in message');
    }
    
    const detection = await detectAI(imageBuffer);
    
    if (detection.error) {
      await sendTwilioMessage(fromNumber, 
        "🚫 *AI Detection Temporarily Unavailable*\n\n" +
        "⚠️ Our AI models are currently down.\n" +
        "🔧 We're working to fix this ASAP.\n\n" +
        "⏰ Please try again in a few minutes."
      );
      return;
    }
    
    await sendTwilioResult(fromNumber, detection);
    updateAnalytics(fromNumber, 'image', detection);
    
  } catch (error) {
    console.error('❌ Twilio image error:', error);
    await sendTwilioMessage(fromNumber, "🖼️ Couldn't analyze this image. Try a different format.");
  }
}

// Handle Twilio text messages
async function handleTwilioText(message, fromNumber) {
  const text = message.text.body.toLowerCase().trim();
  
  if (text.includes('help')) {
    await sendTwilioHelp(fromNumber);
  } else if (text.includes('stats')) {
    await sendTwilioStats(fromNumber);
  } else {
    await sendTwilioMessage(fromNumber,
      "🤖 *Welcome to AI Detection Bot!*\n\n" +
      "📸🎥 Send me images and videos and I'll detect if they're AI-generated!\n\n" +
      "✨ *Video Analysis Features:*\n" +
      "• Frame-by-frame AI detection\n" +
      "• Max 60 seconds / 16MB\n" +
      "• High-accuracy multi-frame analysis\n\n" +
      "💡 Commands:\n" +
      "• 'help' - More info\n" +
      "• 'stats' - Your usage\n\n" +
      "🚀 Just send your media to get started!");
  }
}

// Validate image buffer format
function validateImageBuffer(imageBuffer) {
  if (!imageBuffer || imageBuffer.length === 0) {
    return { valid: false, error: 'Empty image buffer' };
  }
  
  // Check for common image file signatures
  const signatures = {
    'JPEG': [0xFF, 0xD8, 0xFF],
    'PNG': [0x89, 0x50, 0x4E, 0x47],
    'GIF': [0x47, 0x49, 0x46],
    'WebP': [0x52, 0x49, 0x46, 0x46] // RIFF (WebP container)
  };
  
  for (const [format, signature] of Object.entries(signatures)) {
    if (signature.every((byte, index) => imageBuffer[index] === byte)) {
      return { valid: true, format };
    }
  }
  
  return { valid: false, error: 'Unsupported image format (need JPEG, PNG, GIF, or WebP)' };
}

// AI Detection
async function detectAI(imageBuffer) {
  try {
    // Validate image buffer before sending to API
    const validation = validateImageBuffer(imageBuffer);
    if (!validation.valid) {
      console.log('❌ Image validation failed:', validation.error);
      return {
        error: true,
        message: validation.error
      };
    }
    
    console.log(`✅ Image validated as ${validation.format} format, size: ${imageBuffer.length} bytes`);
    
    // Debug: Show first few bytes
    const firstBytes = Array.from(imageBuffer.slice(0, 10)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' ');
    console.log(`🔍 First bytes: ${firstBytes}`);
    
    for (const modelName of AI_MODELS) {
      try {
        const response = await axios.post(
          `https://api-inference.huggingface.co/models/${modelName}`,
          imageBuffer,
          {
            headers: {
              'Authorization': `Bearer ${HUGGINGFACE_TOKEN}`,
              'Content-Type': 'application/octet-stream'
            },
            timeout: 30000
          }
        );
        
        const result = response.data;
        if (!result || !Array.isArray(result) || result.length === 0) continue;
        
        let aiScore = 0;
        let realScore = 0;
        
        result.forEach(prediction => {
          if (!prediction || !prediction.label) return;
          
          const label = String(prediction.label).toLowerCase();
          const score = prediction.score || 0;
          
          if (label.includes('ai') || label.includes('artificial') || label.includes('generated')) {
            aiScore = Math.max(aiScore, score);
          } else if (label.includes('real') || label.includes('human') || label.includes('authentic')) {
            realScore = Math.max(realScore, score);
          }
        });
        
        if (aiScore > 0.1 || realScore > 0.1) {
          const isAI = aiScore > realScore;
          const confidence = Math.round((isAI ? aiScore : realScore) * 100);
          
          return {
            isAI,
            confidence: Math.max(60, Math.min(95, confidence)),
            aiScore: Math.round(aiScore * 100),
            realScore: Math.round(realScore * 100),
            model: modelName.split('/').pop()
          };
        }
      } catch (error) {
        console.log(`❌ ${modelName} failed:`, error.message);
        
        if (error.response) {
          console.log(`📊 Status: ${error.response.status}`);
          console.log(`📋 Response data:`, error.response.data);
          
          // Check for specific error types
          if (error.response.status === 400) {
            console.log('🔍 Possible causes for 400 error:');
            console.log('   - Invalid API token');
            console.log('   - Model is loading (try again in 30s)');
            console.log('   - Image format not supported');
            console.log('   - Image too large');
          }
          
          if (error.response.status === 401) {
            console.log('🔑 Authentication failed - check HUGGINGFACE_TOKEN');
          }
          
          if (error.response.status === 503) {
            console.log('⏳ Model is loading - will retry automatically');
          }
        }
      }
    }
    
    return {
      error: true,
      message: 'AI detection models are currently unavailable'
    };
    
  } catch (error) {
    return {
      error: true,
      message: 'AI detection models are currently unavailable'
    };
  }
}

// Video AI Detection with Frame Extraction
async function analyzeVideoForAI(videoBuffer) {
  let tempFiles = [];
  
  try {
    console.log('🎬 Starting video AI detection with frame extraction...');
    console.log('📏 Video buffer size:', videoBuffer.length, 'bytes');
    
    // Check video size (16MB limit for WhatsApp)
    const MAX_SIZE = 16 * 1024 * 1024; // 16MB
    if (videoBuffer.length > MAX_SIZE) {
      return {
        error: true,
        message: 'Video file too large (max 16MB supported)'
      };
    }
    
    // Create temp directory for processing
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-ai-'));
    const videoPath = path.join(tempDir, 'input_video.mp4');
    
    // Save video buffer to temp file
    await fs.writeFile(videoPath, videoBuffer);
    console.log('💾 Video saved to:', videoPath);
    
    // Extract video metadata to check duration
    const ffprobe = require('util').promisify(require('child_process').exec);
    let duration;
    
    try {
      const { stdout } = await ffprobe(
        `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`
      );
      duration = parseFloat(stdout.trim());
      console.log('⏱️ Video duration:', duration, 'seconds');
      
      // Reject videos over 60 seconds
      if (duration > 60) {
        await cleanupTempFiles([tempDir]);
        return {
          error: true,
          message: 'Video too long (max 60 seconds supported). Your video is ' + Math.round(duration) + ' seconds.'
        };
      }
    } catch (error) {
      console.log('⚠️ Could not determine video duration, proceeding with analysis');
      duration = 30; // Assume reasonable duration
    }
    
    // Calculate frame extraction interval (every 2 seconds)
    const frameInterval = 2;
    const numFrames = Math.min(Math.ceil(duration / frameInterval), 30); // Max 30 frames
    
    console.log(`🔍 Extracting ${numFrames} frames (1 every ${frameInterval} seconds)...`);
    
    // Extract frames using ffmpeg-extract-frames
    const framePattern = path.join(tempDir, 'frame_%d.jpg');
    
    try {
      await extractFrames({
        input: videoPath,
        output: framePattern,
        offsets: Array.from({ length: numFrames }, (_, i) => i * frameInterval)
      });
    } catch (error) {
      console.error('❌ Frame extraction failed:', error);
      await cleanupTempFiles([tempDir]);
      return {
        error: true,
        message: 'Failed to extract video frames. Try a different video format.'
      };
    }
    
    // Read extracted frames
    const frameFiles = await fs.readdir(tempDir);
    const imageFrames = frameFiles.filter(file => file.startsWith('frame_') && file.endsWith('.jpg'));
    
    if (imageFrames.length === 0) {
      await cleanupTempFiles([tempDir]);
      return {
        error: true,
        message: 'No frames could be extracted from video'
      };
    }
    
    console.log(`📸 Successfully extracted ${imageFrames.length} frames`);
    
    // Analyze each frame for AI detection
    const frameResults = [];
    let highConfidenceAI = false;
    let highestAIScore = 0;
    let totalAIScore = 0;
    let totalRealScore = 0;
    let framesProcessed = 0;
    
    for (let i = 0; i < imageFrames.length; i++) {
      const framePath = path.join(tempDir, imageFrames[i]);
      tempFiles.push(framePath);
      
      try {
        console.log(`🔍 Analyzing frame ${i + 1}/${imageFrames.length}...`);
        
        // Read frame as buffer
        const frameBuffer = await fs.readFile(framePath);
        
        // Use existing AI detection for this frame
        const frameDetection = await detectAI(frameBuffer);
        
        if (!frameDetection.error) {
          frameResults.push({
            frameIndex: i + 1,
            isAI: frameDetection.isAI,
            confidence: frameDetection.confidence,
            aiScore: frameDetection.aiScore,
            realScore: frameDetection.realScore,
            model: frameDetection.model
          });
          
          // Check for high-confidence AI detection (80% threshold)
          if (frameDetection.isAI && frameDetection.confidence >= 80) {
            console.log(`🚨 High-confidence AI detected in frame ${i + 1}: ${frameDetection.confidence}%`);
            highConfidenceAI = true;
          }
          
          // Track highest AI score and accumulate for averaging
          if (frameDetection.aiScore > highestAIScore) {
            highestAIScore = frameDetection.aiScore;
          }
          
          totalAIScore += frameDetection.aiScore;
          totalRealScore += frameDetection.realScore;
          framesProcessed++;
        } else {
          console.log(`⚠️ Frame ${i + 1} analysis failed, skipping...`);
        }
      } catch (error) {
        console.error(`❌ Error analyzing frame ${i + 1}:`, error);
      }
    }
    
    // Clean up temp files
    await cleanupTempFiles([tempDir]);
    
    if (framesProcessed === 0) {
      return {
        error: true,
        message: 'Could not analyze any video frames'
      };
    }
    
    // Calculate final results
    const avgAIScore = Math.round(totalAIScore / framesProcessed);
    const avgRealScore = Math.round(totalRealScore / framesProcessed);
    
    // Decision logic: High-confidence AI (80%+) wins, otherwise use average
    let finalIsAI, finalConfidence;
    
    if (highConfidenceAI) {
      finalIsAI = true;
      finalConfidence = Math.min(95, Math.max(80, highestAIScore));
      console.log(`✅ Video marked as AI due to high-confidence frame detection`);
    } else {
      finalIsAI = avgAIScore > avgRealScore;
      finalConfidence = Math.max(60, Math.min(95, finalIsAI ? avgAIScore : avgRealScore));
      console.log(`✅ Video result based on average: ${finalIsAI ? 'AI' : 'Real'} (${finalConfidence}%)`);
    }
    
    console.log(`📊 Final video analysis: ${finalIsAI ? 'AI' : 'Real'} (${finalConfidence}%)`);
    console.log(`📈 Frames processed: ${framesProcessed}/${imageFrames.length}`);
    console.log(`📊 Average scores - AI: ${avgAIScore}%, Real: ${avgRealScore}%`);
    
    return {
      isAI: finalIsAI,
      confidence: finalConfidence,
      aiScore: avgAIScore,
      realScore: avgRealScore,
      model: 'Video Frame Analysis',
      service: 'HuggingFace Multi-Frame',
      framesAnalyzed: framesProcessed,
      totalFramesExtracted: imageFrames.length,
      videoDuration: Math.round(duration),
      highConfidenceDetection: highConfidenceAI,
      frameResults: frameResults.slice(0, 5) // Include up to 5 frame details
    };
    
  } catch (error) {
    console.error('❌ Video analysis error:', error);
    
    // Clean up any temp files on error
    if (tempFiles.length > 0) {
      await cleanupTempFiles(tempFiles.map(f => path.dirname(f)));
    }
    
    return {
      error: true,
      message: 'Video analysis failed. Please try a different video format or shorter duration.'
    };
  }
}

// Helper function to clean up temporary files
async function cleanupTempFiles(directories) {
  for (const dir of directories) {
    try {
      await fs.rmdir(dir, { recursive: true });
      console.log('🧹 Cleaned up temp directory:', dir);
    } catch (error) {
      console.log('⚠️ Could not clean up temp directory:', dir);
    }
  }
}

// Get media URL
async function getMediaUrl(mediaId) {
  const response = await axios.get(
    `https://graph.facebook.com/v18.0/${mediaId}`,
    { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } }
  );
  return response.data.url;
}

// Download media
async function downloadMedia(mediaUrl) {
  const response = await axios.get(mediaUrl, {
    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer'
  });
  return Buffer.from(response.data);
}

// Send detection results
async function sendResult(toNumber, detection) {
  const emoji = detection.isAI ? "🤖" : "✅";
  const status = detection.isAI ? "AI-Generated" : "Authentic";
  const confidenceBar = '█'.repeat(Math.round(detection.confidence / 10)) + 
                       '░'.repeat(10 - Math.round(detection.confidence / 10));
  
  const message = 
    `${emoji} *${status.toUpperCase()}*\n\n` +
    `📊 Confidence: ${detection.confidence}%\n` +
    `[${confidenceBar}]\n\n` +
    `${detection.isAI ? 
      "🤖 This appears to be AI-generated content" : 
      "✅ This appears to be authentic content"}\n\n` +
    `📊 AI Score: ${detection.aiScore}% | Real Score: ${detection.realScore}%\n` +
    `🔧 Model: ${detection.model}\n\n` +
    `📸 Send another image to analyze more!`;

  await sendText(toNumber, message);
}

// Send welcome message
async function sendWelcome(toNumber) {
  const message = 
    "🤖 *Welcome to AI Detection Bot!*\n\n" +
    "📸🎥 Send me images and videos and I'll detect if they're AI-generated!\n\n" +
    "✨ *Video Analysis Features:*\n" +
    "• Frame-by-frame AI detection\n" +
    "• Max 60 seconds / 16MB\n" +
    "• High-accuracy multi-frame analysis\n\n" +
    "💡 Commands:\n" +
    "• 'help' - More info\n" +
    "• 'stats' - Your usage\n\n" +
    "🚀 Just send your media to get started!";

  await sendText(toNumber, message);
}

// Send help message
async function sendHelp(toNumber) {
  const message = 
    "🆘 *AI Detection Bot Help*\n\n" +
    "*How to use:*\n" +
    "1. Send any image or video\n" +
    "2. Get AI detection results with confidence scores\n" +
    "3. Videos analyzed frame-by-frame for accuracy\n\n" +
    "*Commands:*\n" +
    "• 'help' - This message\n" +
    "• 'stats' - Usage statistics\n\n" +
    "*What I detect:*\n" +
    "• AI-generated images\n" +
    "• AI-generated videos\n" +
    "• Deepfakes\n" +
    "• Synthetic media\n\n" +
    "*Video Limits:*\n" +
    "• Max 60 seconds duration\n" +
    "• Max 16MB file size\n" +
    "• Supports MP4, MOV formats\n\n" +
    "🔬 Powered by HuggingFace AI models!";

  await sendText(toNumber, message);
}

// Send user statistics
async function sendStats(toNumber) {
  const stats = userStats.get(toNumber) || { 
    messagesCount: 0, 
    imagesAnalyzed: 0,
    videosAnalyzed: 0, 
    aiDetected: 0,
    joinDate: new Date() 
  };
  
  const daysSince = Math.floor((new Date() - stats.joinDate) / (1000 * 60 * 60 * 24));
  const totalAnalyzed = stats.imagesAnalyzed + stats.videosAnalyzed;
  const aiPercentage = totalAnalyzed > 0 ? 
    Math.round((stats.aiDetected / totalAnalyzed) * 100) : 0;
  
  const message = 
    "📊 *Your Statistics*\n\n" +
    `👤 Member for: ${daysSince} days\n` +
    `💬 Messages: ${stats.messagesCount}\n` +
    `📸 Images analyzed: ${stats.imagesAnalyzed}\n` +
    `🎥 Videos analyzed: ${stats.videosAnalyzed}\n` +
    `📈 Total analyzed: ${totalAnalyzed}\n` +
    `🤖 AI detected: ${stats.aiDetected}\n` +
    `📊 AI detection rate: ${aiPercentage}%\n\n` +
    "📱 Send more media to analyze!";

  await sendText(toNumber, message);
}

// Send text message
async function sendText(toNumber, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: toNumber,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('❌ Error sending message:', error.response?.data || error.message);
  }
}

// Send Twilio message
async function sendTwilioMessage(toNumber, message) {
  if (!twilioClient) {
    console.error('❌ Twilio client not configured - check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    return;
  }

  if (!TWILIO_PHONE_NUMBER) {
    console.error('❌ TWILIO_PHONE_NUMBER not configured in environment variables');
    return;
  }

  try {
    // Clean and format phone numbers properly
    let cleanToNumber = toNumber;
    
    // Fix common formatting issues
    if (toNumber.includes('whatsapp:')) {
      // Extract number and ensure it has +
      let number = toNumber.replace('whatsapp:', '').trim();
      if (!number.startsWith('+')) {
        number = '+' + number;
      }
      cleanToNumber = 'whatsapp:' + number;
    }
    
    // Match the channel format (SMS vs WhatsApp)  
    const fromNumber = cleanToNumber.startsWith('whatsapp:') 
      ? `whatsapp:${TWILIO_PHONE_NUMBER.replace(/^whatsapp:/, '').replace(/^\+/, '')}`
      : TWILIO_PHONE_NUMBER.replace(/^whatsapp:/, '');

    console.log(`📤 Sending message from ${fromNumber} to ${cleanToNumber}`);
    console.log(`🔧 Using TWILIO_PHONE_NUMBER: ${TWILIO_PHONE_NUMBER}`);

    await twilioClient.messages.create({
      body: message,
      from: fromNumber,
      to: cleanToNumber
    });
    
    console.log('✅ Message sent successfully');
  } catch (error) {
    console.error('❌ Error sending Twilio message:', error.message);
    
    // Specific error handling
    if (error.message.includes('Channel with the specified From address')) {
      console.error('💡 Fix: Update TWILIO_PHONE_NUMBER to match your Twilio number');
      console.error('💡 Current configured number:', TWILIO_PHONE_NUMBER);
      console.error('💡 Make sure it matches your Twilio console configuration');
    }
    
    if (error.message.includes('same To and From')) {
      console.error('💡 Fix: Cannot send message to the same number (testing limitation)');
    }
    
    if (error.message.includes('not a valid phone number')) {
      console.error('💡 Fix: Check phone number format - should include country code with +');
    }
  }
}

// Send Twilio detection results
async function sendTwilioResult(toNumber, detection) {
  const emoji = detection.isAI ? "🤖" : "✅";
  const status = detection.isAI ? "AI-Generated" : "Authentic";
  const confidenceBar = '█'.repeat(Math.round(detection.confidence / 10)) + 
                       '░'.repeat(10 - Math.round(detection.confidence / 10));
  
  const message = 
    `${emoji} *${status.toUpperCase()}*\n\n` +
    `📊 Confidence: ${detection.confidence}%\n` +
    `[${confidenceBar}]\n\n` +
    `${detection.isAI ? 
      "🤖 This appears to be AI-generated content" : 
      "✅ This appears to be authentic content"}\n\n` +
    `📊 AI Score: ${detection.aiScore}% | Real Score: ${detection.realScore}%\n` +
    `🔧 Model: ${detection.model}\n\n` +
    `📸 Send another image to analyze more!`;

  await sendTwilioMessage(toNumber, message);
}

// Send Twilio help message
async function sendTwilioHelp(toNumber) {
  const message = 
    "🆘 *AI Detection Bot Help*\n\n" +
    "*How to use:*\n" +
    "1. Send any image\n" +
    "2. Get instant AI detection results\n" +
    "3. See confidence scores\n\n" +
    "*Commands:*\n" +
    "• 'help' - This message\n" +
    "• 'stats' - Usage statistics\n\n" +
    "*What I detect:*\n" +
    "• AI-generated images\n" +
    "• Deepfakes\n" +
    "• Synthetic media\n\n" +
    "🔬 Powered by HuggingFace AI models!";

  await sendTwilioMessage(toNumber, message);
}

// Send Twilio user statistics
async function sendTwilioStats(toNumber) {
  const stats = userStats.get(toNumber) || { 
    messagesCount: 0, 
    imagesAnalyzed: 0,
    videosAnalyzed: 0, 
    aiDetected: 0,
    joinDate: new Date() 
  };
  
  const daysSince = Math.floor((new Date() - stats.joinDate) / (1000 * 60 * 60 * 24));
  const totalAnalyzed = stats.imagesAnalyzed + stats.videosAnalyzed;
  const aiPercentage = totalAnalyzed > 0 ? 
    Math.round((stats.aiDetected / totalAnalyzed) * 100) : 0;
  
  const message = 
    "📊 *Your Statistics*\n\n" +
    `👤 Member for: ${daysSince} days\n` +
    `💬 Messages: ${stats.messagesCount}\n` +
    `📸 Images analyzed: ${stats.imagesAnalyzed}\n` +
    `🎥 Videos analyzed: ${stats.videosAnalyzed}\n` +
    `📈 Total analyzed: ${totalAnalyzed}\n` +
    `🤖 AI detected: ${stats.aiDetected}\n` +
    `📊 AI detection rate: ${aiPercentage}%\n\n` +
    "📱 Send more media to analyze!";

  await sendTwilioMessage(toNumber, message);
}

// Update user statistics
function updateUserStats(phoneNumber) {
  const stats = userStats.get(phoneNumber) || {
    messagesCount: 0,
    imagesAnalyzed: 0,
    videosAnalyzed: 0,
    aiDetected: 0,
    joinDate: new Date()
  };
  
  stats.messagesCount++;
  userStats.set(phoneNumber, stats);
}

// Update analytics
function updateAnalytics(phoneNumber, mediaType, detection) {
  const stats = userStats.get(phoneNumber);
  if (stats) {
    if (mediaType === 'image') stats.imagesAnalyzed++;
    if (mediaType === 'video') stats.videosAnalyzed++;
    if (detection.isAI) stats.aiDetected++;
    userStats.set(phoneNumber, stats);
  }
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: '🤖 WhatsApp AI Detection Bot',
    status: 'running'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', users: userStats.size });
});

// Validate configuration on startup
function validateConfig() {
  const issues = [];
  
  if (!HUGGINGFACE_TOKEN || HUGGINGFACE_TOKEN === 'your_huggingface_token_here') {
    issues.push('❌ HUGGINGFACE_TOKEN not configured');
  }
  
  if (!WHATSAPP_TOKEN || WHATSAPP_TOKEN === 'your_long_lived_token_here') {
    issues.push('⚠️ WHATSAPP_TOKEN not configured (WhatsApp features disabled)');
  }
  
  if (!PHONE_NUMBER_ID || PHONE_NUMBER_ID === 'your_phone_number_id_here') {
    issues.push('⚠️ PHONE_NUMBER_ID not configured (WhatsApp features disabled)');
  }
  
  if (issues.length > 0) {
    console.log('\n🔧 Configuration Issues:');
    issues.forEach(issue => console.log(`   ${issue}`));
    console.log('\n💡 Please update your .env file with real API credentials\n');
  }
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 WhatsApp AI Detection Bot started!');
  console.log(`📡 Server running on port ${PORT}`);
  
  // Validate configuration
  validateConfig();
});

module.exports = app;