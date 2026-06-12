import axios from 'axios';
import { WhatsAppConfig } from '../types';

export class WhatsAppService {
  private config: WhatsAppConfig;

  constructor(config: WhatsAppConfig) {
    this.config = config;
  }

  async sendText(text: string, overrideNumber?: string) {
    if (!this.config.enabled || !this.config.apiUrl || !this.config.apiKey) {
      console.warn('WhatsApp is not configured or enabled.');
      return;
    }

    const targetNumber = overrideNumber || this.config.phoneNumber;
    if (!targetNumber) {
      console.warn('No target phone number provided for WhatsApp message.');
      return;
    }

    try {
      const response = await axios.post(
        `${this.config.apiUrl}/message/sendText/${this.config.instanceName}`,
        {
          number: targetNumber,
          text: text
        },
        {
          headers: {
            'apikey': this.config.apiKey,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
      throw error;
    }
  }
}
