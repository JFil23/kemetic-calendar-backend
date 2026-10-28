import { EmailMessage } from 'cloudflare:email';
import { handleContact } from './handler.mjs';

export default {
  fetch(request, env) {
    return handleContact(request, {
      limiter: env.CONTACT_RATE_LIMIT,
      version: env.VERSION_METADATA?.tag || '',
      send: env.CONTACT_EMAIL?.send
        ? message => env.CONTACT_EMAIL.send(new EmailMessage(message.from, message.to, message.raw))
        : undefined,
    });
  },
};
