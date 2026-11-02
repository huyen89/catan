import type { FastifyHelmetOptions } from '@fastify/helmet';
import type { Config } from '../config';

const GOOGLE = 'https://accounts.google.com';

/** Helmet options: strict CSP that still allows Google Identity Services and same-origin sockets. */
export function helmetOptions(config: Config): FastifyHelmetOptions {
  const wsOrigin = config.publicOrigin?.replace(/^http/, 'ws');
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", GOOGLE],
        styleSrc: ["'self'", "'unsafe-inline'", GOOGLE],
        frameSrc: ["'self'", GOOGLE],
        connectSrc: ["'self'", GOOGLE, ...(wsOrigin ? [wsOrigin] : [])],
        imgSrc: ["'self'", 'data:', 'https:'],
        mediaSrc: ["'self'", 'blob:', 'mediastream:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.secureCookies ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Google's sign-in popup needs to talk back to the opener.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.secureCookies ? undefined : false,
  };
}
