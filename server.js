// WhatsApp AI Detection Bot
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const twilio = require('twilio');

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

const twilioClient = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? 
  twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

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
    const { From, To, Body, MediaUrl0, MessageSid } = req.body;
    
    // Validate required fields
    if (!From) {
      return res.status(400).send('Missing From parameter');
    }
    
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
    } else if (Body) {
      simulatedMessage.text = { body: Body };
    }

    // Process the message using existing logic (keep original From format)
    await handleTwilioMessage(simulatedMessage, From);
    
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
      case 'text':
        await handleTwilioText(message, fromNumber);
        break;
      default:
        await sendTwilioMessage(fromNumber, 
          "🤖 *Welcome to AI Detection Bot!*\n\n" +
          "📸 Send me images and I'll detect if they're AI-generated!\n\n" +
          "💡 Commands:\n" +
          "• 'help' - More info\n" +
          "• 'stats' - Your usage\n\n" +
          "🚀 Just send your image to get started!");
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
    
    if (message.image.url) {
      // Direct URL from Twilio
      const response = await axios.get(message.image.url, {
        responseType: 'arraybuffer'
      });
      imageBuffer = Buffer.from(response.data);
    } else {
      // Fallback to original WhatsApp method
      const mediaUrl = await getMediaUrl(message.image.id);
      imageBuffer = await downloadMedia(mediaUrl);
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
      "📸 Send me images and I'll detect if they're AI-generated!\n\n" +
      "💡 Commands:\n" +
      "• 'help' - More info\n" +
      "• 'stats' - Your usage\n\n" +
      "🚀 Just send your image to get started!");
  }
}

// AI Detection
async function detectAI(imageBuffer) {
  try {
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
    "📸 Send me images and I'll detect if they're AI-generated!\n\n" +
    "💡 Commands:\n" +
    "• 'help' - More info\n" +
    "• 'stats' - Your usage\n\n" +
    "🚀 Just send your image to get started!";

  await sendText(toNumber, message);
}

// Send help message
async function sendHelp(toNumber) {
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

  await sendText(toNumber, message);
}

// Send user statistics
async function sendStats(toNumber) {
  const stats = userStats.get(toNumber) || { 
    messagesCount: 0, 
    imagesAnalyzed: 0, 
    aiDetected: 0,
    joinDate: new Date() 
  };
  
  const daysSince = Math.floor((new Date() - stats.joinDate) / (1000 * 60 * 60 * 24));
  const aiPercentage = stats.imagesAnalyzed > 0 ? 
    Math.round((stats.aiDetected / stats.imagesAnalyzed) * 100) : 0;
  
  const message = 
    "📊 *Your Statistics*\n\n" +
    `👤 Member for: ${daysSince} days\n` +
    `💬 Messages: ${stats.messagesCount}\n` +
    `📸 Images analyzed: ${stats.imagesAnalyzed}\n` +
    `🤖 AI detected: ${stats.aiDetected}\n` +
    `📈 AI detection rate: ${aiPercentage}%\n\n` +
    "📱 Send more images to analyze!";

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
    console.error('❌ Twilio client not configured');
    return;
  }

  try {
    // Match the channel format (SMS vs WhatsApp)
    const fromNumber = toNumber.startsWith('whatsapp:') 
      ? `whatsapp:${TWILIO_PHONE_NUMBER.replace(/^whatsapp:/, '')}`
      : TWILIO_PHONE_NUMBER.replace(/^whatsapp:/, '');

    await twilioClient.messages.create({
      body: message,
      from: fromNumber,
      to: toNumber
    });
  } catch (error) {
    console.error('❌ Error sending Twilio message:', error.message);
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
    aiDetected: 0,
    joinDate: new Date() 
  };
  
  const daysSince = Math.floor((new Date() - stats.joinDate) / (1000 * 60 * 60 * 24));
  const aiPercentage = stats.imagesAnalyzed > 0 ? 
    Math.round((stats.aiDetected / stats.imagesAnalyzed) * 100) : 0;
  
  const message = 
    "📊 *Your Statistics*\n\n" +
    `👤 Member for: ${daysSince} days\n` +
    `💬 Messages: ${stats.messagesCount}\n` +
    `📸 Images analyzed: ${stats.imagesAnalyzed}\n` +
    `🤖 AI detected: ${stats.aiDetected}\n` +
    `📈 AI detection rate: ${aiPercentage}%\n\n` +
    "📱 Send more images to analyze!";

  await sendTwilioMessage(toNumber, message);
}

// Update user statistics
function updateUserStats(phoneNumber) {
  const stats = userStats.get(phoneNumber) || {
    messagesCount: 0,
    imagesAnalyzed: 0,
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 WhatsApp AI Detection Bot started!');
  console.log(`📡 Server running on port ${PORT}`);
});

module.exports = app;