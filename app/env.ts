import { z } from 'zod';

// we want to fail on module load
export const env = z
  .object({
    ROUTER_IP_ADDRESS: z.string(),
    ROUTER_USERNAME: z.string(),
    ROUTER_PASSWORD: z.string(),
  })
  .parse(process.env);
