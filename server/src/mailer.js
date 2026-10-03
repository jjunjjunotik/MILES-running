'use strict';

/* Email. Only one kind goes out — the password reset code — so this is one
   function over two transports: Resend's HTTP API when RESEND_API_KEY and
   MAIL_FROM are set, and the console otherwise. Tests pass in their own. */

function createMailer(config, override) {
  if (override) return override;

  if (config.resendApiKey && config.mailFrom) {
    return {
      kind: 'resend',
      async send(message) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: config.mailFrom, to: [message.to], subject: message.subject, text: message.text }),
        });
        if (!res.ok) throw new Error(`resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      },
    };
  }

  const production = process.env.NODE_ENV === 'production';
  if (production) {
    console.warn('[mail] RESEND_API_KEY / MAIL_FROM are not set: password reset emails cannot be sent.');
  }
  return {
    kind: 'console',
    async send(message) {
      // In development the code is printed so a reset can be finished by hand.
      // In production it never is: logs are not a place for secrets.
      if (production) console.warn(`[mail] not sent (no provider): "${message.subject}"`);
      else console.log(`[mail] to ${message.to}: ${message.subject}\n${message.text}`);
    },
  };
}

module.exports = { createMailer };
