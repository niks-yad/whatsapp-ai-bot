#!/bin/bash

# Test script for WhatsApp AI Detection Bot
# This simulates a WhatsApp webhook call with an image

echo "🚀 Testing WhatsApp AI Detection Bot with curl..."

# Test URL
SERVER_URL="http://localhost:3000"

# Create a mock WhatsApp webhook payload
# This simulates what WhatsApp would send when a user sends an image
WEBHOOK_PAYLOAD='{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "test_entry",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15551234567",
              "phone_number_id": "123456789"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Test User"
                },
                "wa_id": "917011571999"
              }
            ],
            "messages": [
              {
                "from": "917011571999",
                "id": "test_message_123",
                "timestamp": "1642678400",
                "type": "image",
                "image": {
                  "caption": "Is this AI generated?",
                  "mime_type": "image/webp",
                  "sha256": "test_hash",
                  "id": "test_media_id"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}'

echo "📡 Testing webhook endpoint..."
echo "🔗 Sending request to: $SERVER_URL/webhook"

# Send the webhook request
curl -X POST "$SERVER_URL/webhook" \
  -H "Content-Type: application/json" \
  -d "$WEBHOOK_PAYLOAD" \
  -v

echo -e "\n\n✅ Test completed!"
echo "💡 Note: This test will fail at media download since we're using mock IDs"
echo "📊 Check the server logs to see if the AI detection logic runs correctly"