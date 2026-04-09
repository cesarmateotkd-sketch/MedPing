'use strict';
const twilio = require('twilio');
const config = require('../config');
const logger = require('./logger');

let client;
if (process.env.SMS_MOCK !== 'true') {
  client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
}

/**
 * Send an SMS via Twilio.
 * When SMS_MOCK=true, logs the message instead of calling Twilio.
 * @param {string} to   - Destination phone number in E.164 format.
 * @param {string} body - Message text.
 * @returns {Promise<string>} Twilio message SID (or 'mock-sid').
 */
async function sendSMS(to, body) {
  if (process.env.SMS_MOCK === 'true') {
    logger.info('[SMS MOCK] Would send SMS', { to, body });
    return 'mock-sid';
  }
  const message = await client.messages.create({
    from: config.TWILIO_PHONE_NUMBER,
    to,
    body,
  });
  return message.sid;
}

module.exports = { sendSMS };
