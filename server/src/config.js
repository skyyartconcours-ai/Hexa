const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),
  publicUrl: (env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, ''),
  dbPath: env.DB_PATH || './data/giveaway.db',
  sessionSecret: env.SESSION_SECRET || '',
  broadcasterId: env.BROADCASTER_ID || '',
  broadcasterLogin: (env.BROADCASTER_LOGIN || '').toLowerCase(),
  twitch: {
    clientId: env.TWITCH_CLIENT_ID || '',
    clientSecret: env.TWITCH_CLIENT_SECRET || '',
  },
  extension: {
    clientId: env.EXTENSION_CLIENT_ID || '',
    secret: env.EXTENSION_SECRET || '',
    ownerId: env.EXTENSION_OWNER_ID || env.BROADCASTER_ID || '',
  },
  eventsubSecret: env.EVENTSUB_SECRET || '',
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || 'mailto:contact@example.com',
  },
};

const REQUIRED = {
  SESSION_SECRET: config.sessionSecret,
  BROADCASTER_ID: config.broadcasterId,
  BROADCASTER_LOGIN: config.broadcasterLogin,
  TWITCH_CLIENT_ID: config.twitch.clientId,
  TWITCH_CLIENT_SECRET: config.twitch.clientSecret,
  EXTENSION_CLIENT_ID: config.extension.clientId,
  EXTENSION_SECRET: config.extension.secret,
  EVENTSUB_SECRET: config.eventsubSecret,
};

export function missingConfig() {
  const missing = Object.entries(REQUIRED).filter(([, v]) => !v).map(([k]) => k);
  if (!config.vapid.publicKey || !config.vapid.privateKey) missing.push('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY');
  return missing;
}
