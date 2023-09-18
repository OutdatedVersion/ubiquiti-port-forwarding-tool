import { Agent, request } from 'undici';
import { decode as decodeJwt } from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../env';

const dispatcher = new Agent({
  connect: {
    host: env.ROUTER_IP_ADDRESS,
    // Ubiquiti products issue themselves a TLS certificate from
    // per-device-generated certificate authorities not available in
    // any production system's authority store that we must ignore.
    rejectUnauthorized: false,
  },
});

let csrfToken: string | undefined;
let token: string | undefined;
let tokenExpiresAt = 0;
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
  if (token && tokenExpiresAt <= Date.now()) {
    console.log('cached');
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
    }
  );

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
    }
  );

  const setCookieHeader = headers['set-cookie'] as string;
  const probablyToken = setCookieHeader.substring(
    'TOKEN='.length,
    setCookieHeader.indexOf(';')
  );

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

  // I'm not sure how long this token is valid for 🤔
  // The Unifi UI updates their CSRF token on every request though
  // this is in the token payload implying it lasts as long as the token.
  csrfToken = decoded.csrfToken;
  token = probablyToken;
  tokenExpiresAt = decoded.exp;

  console.log(
    `New Unifi token retrieved for use until ${new Date(
      tokenExpiresAt * 1000
    ).toISOString()}`
  );

  return token;
};

export const getPortForwards = async ({
  auth,
}: {
  auth: { username: string; password: string; routerIpAddress: string };
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
    }
  );

  if (statusCode !== 200) {
    const error: Error & { statusCode?: number } = new Error(
      'could not list port forwards'
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
        ])
      ),
    })
    .parse(json).data;
};
