'use strict';
const twilio = require('twilio');
const config = require('../config');

const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

/**
 * Send an SMS via Twilio.
 * @param {string} to   - Destination phone number in E.164 format.
 * @param {string} body - Message text.
 * @returns {Promise<string>} Twilio message SID.
 */
async function sendSMS(to, body) {
  const message = await client.messages.create({
    from: config.TWILIO_PHONE_NUMBER,
    to,
    body,
  });
  return message.sid;
}

module.exports = { sendSMS };
