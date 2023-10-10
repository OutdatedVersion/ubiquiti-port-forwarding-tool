import assert from 'node:assert';
import { Agent, request } from 'undici';
import { decode as decodeJwt } from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../env';
import debug from 'debug';

// should we just accept a URL?
export interface RouterConnectionDetails {
  username: string;
  password: string;
  routerIpAddress: string;
}

const debugLog = debug('unifi');

const dispatcher = new Agent({
  connect: {
    host: env.ROUTER_IP_ADDRESS,
    // Ubiquiti products issue themselves a TLS certificate from
    // per-device-generated certificate authorities not available in
    // any production system's authority store that we must ignore.
    rejectUnauthorized: false,
  },
});

let token: string | undefined;
let tokenExpiresAt = 0;
let csrfToken: string | undefined;
const tokenDebugLog = debugLog.extend('token');
const getToken = async ({
  username,
  password,
  routerIpAddress,
}: {
  username: string;
  password: string;
  routerIpAddress: string;
}) => {
  // TODO: should probably lock this to prevent multiple tokens being issued
  if (token && tokenExpiresAt >= Date.now()) {
    tokenDebugLog('Unifi token cache hit');
    return token;
  }

  // Load the login page up to get a valid CSRF token
  // We won't need anything else from this response
  const { headers: bootstrapHeaders } = await request(
    `https://${routerIpAddress}/login?redirect=/`,
    {
      dispatcher,
      headers: {
        accept: 'text/html',
      },
    },
  );
  tokenDebugLog('Bootstrap headers', bootstrapHeaders);

  const { headers } = await request(
    `https://${routerIpAddress}/api/auth/login`,
    {
      dispatcher,
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': bootstrapHeaders['x-csrf-token'],
      },
      body: JSON.stringify({
        username,
        password,
        token: '',
        rememberMe: false,
      }),
    },
  );
  tokenDebugLog('authn response headers', headers);

  const setCookieHeader = headers['set-cookie'] as string;
  const probablyToken = setCookieHeader.substring(
    'TOKEN='.length,
    setCookieHeader.indexOf(';'),
  );
  tokenDebugLog(`'Set-Cookie' header`, setCookieHeader);

  // We need to get the expiration timestamp but I'd also
  // like to smoke check we parsed out the right thing
  const decoded = z
    .object({
      exp: z.number(),
      iat: z.number(),
      jti: z.string(),
      userId: z.string(),
      csrfToken: z.string(),
    })
    .parse(decodeJwt(probablyToken));

  tokenDebugLog('Decoded token', decoded);
  // I'm not sure how long this token is valid for 🤔
  // The Unifi UI updates their CSRF token on every request though
  // this is in the token payload implying it lasts as long as the token.
  token = probablyToken;
  tokenExpiresAt = decoded.exp * 1000;
  csrfToken = decoded.csrfToken;

  tokenDebugLog(
    `Unifi token retrieved for use until ${new Date(
      tokenExpiresAt,
    ).toISOString()}`,
  );

  return token;
};

export const getPortForwards = async ({
  auth,
}: {
  auth: RouterConnectionDetails;
}) => {
  const { statusCode, body } = await request(
    `https://${auth.routerIpAddress}/proxy/network/api/s/default/rest/portforward`,
    {
      dispatcher,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: `TOKEN=${await getToken(auth)}`,
      },
    },
  );

  if (statusCode !== 200) {
    const error: Error & { statusCode?: number } = new Error(
      'could not list port forwards',
    );
    error.statusCode = statusCode;
    throw error;
  }

  let json;
  for await (let data of body) {
    if (!Buffer.isBuffer(data)) {
      data = Buffer.from(data);
    }

    // using the hopeful idiot method on if the response fits in one frame :]
    json = JSON.parse(data);
  }

  const base = {
    pfwd_interface: z.string(),
    fwd: z.string(),
    src: z.string(),
    log: z.boolean(),
    proto: z.enum(['tcp_udp', 'udp', 'tcp']),
    name: z.string(),
    dst_port: z.string(),
    site_id: z.string(),
    _id: z.string(),
    fwd_port: z.string(),
  };

  return z
    .object({
      meta: z.object({ rc: z.literal('ok') }),
      data: z.array(
        z.discriminatedUnion('enabled', [
          z
            .object({
              enabled: z.literal(true),
              destination_ip: z.string(),
            })
            .extend(base),
          z
            .object({
              enabled: z.literal(false),
            })
            .extend(base),
        ]),
      ),
    })
    .parse(json).data;
};

export const createPortForward = async ({
  publicPort,
  targetPort,
  targetIpAddress,
  auth,
}: {
  publicPort: number;
  targetPort: number;
  targetIpAddress: string;
  auth: RouterConnectionDetails;
}) => {
  const response = await request(
    `https://${auth.routerIpAddress}/proxy/network/api/s/default/rest/portforward`,
    {
      dispatcher,
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        cookie: `TOKEN=${await getToken(auth)}`,
      },
      body: JSON.stringify(
        {
          // I'm ok with a "try again if it collides" strat in this project
          name: `forwarding-tool-${crypto.randomUUID().substring(0, 8)}`,
          enabled: true,
          pfwd_interface: 'wan',
          src: 'any',
          dst_port: `${publicPort}`,
          fwd: targetIpAddress,
          fwd_port: `${targetPort}`,
          proto: 'tcp_udp',
          log: false,
          destination_ip: 'any',
        },
        null,
        2,
      ),
    },
  );

  assert(response.statusCode === 200);
};

// Remove
// DELETE https://192.168.1.1/proxy/network/api/s/default/rest/portforward/<id>
// {}
