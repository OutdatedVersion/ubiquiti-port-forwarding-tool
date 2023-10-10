import {
  type ActionFunctionArgs,
  json,
  type MetaFunction,
} from '@remix-run/node';
import {
  TrashIcon,
  CheckCircleIcon,
  PauseCircleIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import { Form, useLoaderData, useNavigation } from '@remix-run/react';
import { createPortForward, getPortForwards } from './unifi';
import { env } from '../../env';
import { getPublicIpAddress } from './ip';
import { useRef, useState } from 'react';
import { z } from 'zod';
import cn from 'classnames';

export const meta: MetaFunction = () => {
  return [
    { title: 'New Remix App' },
    { name: 'description', content: 'Welcome to Remix!' },
  ];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = Object.fromEntries(await request.formData());
  console.log('action', formData);
  const data = z
    .discriminatedUnion('intent', [
      z.object({
        intent: z.literal('delete'),
        privateIpAddress: z.string(),
        targetPort: z.number(),
      }),
      z.object({
        intent: z.literal('add'),
        publicPort: z.coerce.number().positive().min(10000).max(65535),
        targetPort: z.coerce.number().positive().max(65535),
        // TODO: IP address is assigned to authenticated user
        targetIpAddress: z.string().ip({ version: 'v4' }),
      }),
    ])
    .parse(formData);

  if (data.intent === 'delete') {
    console.log('remove', data);
  } else if (data.intent === 'add') {
    await createPortForward({
      publicPort: data.publicPort,
      targetPort: data.targetPort,
      targetIpAddress: data.targetIpAddress,
      auth: {
        username: env.ROUTER_USERNAME,
        password: env.ROUTER_PASSWORD,
        routerIpAddress: env.ROUTER_IP_ADDRESS,
      },
    });
  }

  return null;
};

export const loader = async () => {
  const user = {
    // 65,535
    servers: [
      {
        privateIpAddress: '192.168.1.199',
        // the following are purely cosmetic
        cores: 2,
        memory: 8192,
      },
    ],
  };

  const forwards = await getPortForwards({
    auth: {
      username: env.ROUTER_USERNAME,
      password: env.ROUTER_PASSWORD,
      routerIpAddress: env.ROUTER_IP_ADDRESS,
    },
  });

  return json({
    publicIpAddress: await getPublicIpAddress(),
    servers: user.servers.map((srv) => ({
      ...srv,
      forwards: [
        ...forwards
          .filter((fwd) => fwd.fwd === srv.privateIpAddress)
          .map((fwd) => ({
            publicPort: parseInt(fwd.dst_port, 10),
            targetPort: parseInt(fwd.fwd_port, 10),
            enabled: fwd.enabled,
          })),
      ],
    })),
  });
};

// Margin: Factors of 2, usually incremented by 2
// Padding: Usually odd

const formatMemory = (megabytes: number) => {
  const gigabytes = megabytes / 1024;

  if (gigabytes >= 1) {
    return `${gigabytes.toFixed(1)} GB`;
  }
  return `${megabytes} MB`;
};

const randomInteger = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const PortForwardEntry = ({ fwd, optimistic }: any) => {
  return (
    <tr>
      <td className="py-1.5">:{fwd.publicPort}</td>
      <td>:{fwd.targetPort}</td>
      <td>
        <button
          data-intent={fwd.enabled ? 'disable' : 'enable'}
          data-public-port={fwd.publicPort}
        >
          {fwd.enabled || optimistic ? (
            <CheckCircleIcon
              className={cn(
                'inline h-6 w-6',
                optimistic ? 'text-yellow-400' : 'text-green-700',
              )}
            />
          ) : (
            <PauseCircleIcon className="inline h-6 w-6 text-red-700" />
          )}
        </button>
        <button
          data-intent="remove"
          data-public-port={fwd.publicPort}
          disabled={optimistic}
        >
          <TrashIcon
            className={cn('ml-1.5 inline h-5 w-5', {
              'text-gray-600': optimistic,
            })}
          />
        </button>
      </td>
    </tr>
  );
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  const [isAdding, setIsAdding] = useState(false);
  const intentElement = useRef<HTMLInputElement>(null);

  return (
    <div className="m-4">
      <div className="mb-8 w-full rounded-md bg-sky-300 p-3">
        <h1 className="font-mono text-lg font-bold">{data.publicIpAddress}</h1>
        <h1 className="text-sm">Internet accessible IP address</h1>
        <p className="mt-3">
          Traffic from the Internet to your servers is blocked by default.
        </p>
      </div>

      {data.servers.map((srv) => (
        <div
          key={srv.privateIpAddress}
          className="mt-4 rounded-md bg-gray-100 p-3"
        >
          <div>
            <h1 className="font-mono text-lg font-bold">
              {srv.privateIpAddress}
            </h1>
            <h1 className="text-sm">
              {srv.cores} vCPU / {formatMemory(srv.memory)} RAM
            </h1>
          </div>

          <Form
            method="post"
            onSubmit={(event) => {
              const submitter = (event.nativeEvent as SubmitEvent).submitter;
              if (!submitter || !intentElement.current) {
                console.error('no submitter and/or intentElement', {
                  submitter,
                  intentElement,
                });
                return;
              }
              const { intent } = submitter.dataset;
              if (intent) {
                intentElement.current.value = intent;
              }
              setIsAdding(false);
            }}
          >
            <input
              ref={intentElement}
              hidden
              type="text"
              name="intent"
              defaultValue={''}
            />

            <table className="mt-4 w-full table-fixed">
              <thead>
                <tr className="text-left">
                  <th>Internet</th>
                  <th>Target</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {srv.forwards.map((fwd) => (
                  <PortForwardEntry key={fwd.publicPort} fwd={fwd} />
                ))}
                {navigation.formData && (
                  <PortForwardEntry
                    fwd={Object.fromEntries(navigation.formData)}
                    optimistic={true}
                  />
                )}

                {isAdding && (
                  <tr>
                    <td className="py-3">
                      <input
                        name="publicPort"
                        type="text"
                        readOnly
                        className="w-16 rounded-sm p-1.5"
                        value={randomInteger(10000, 65535)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        readOnly
                        className="hidden"
                        name="targetIpAddress"
                        value={srv.privateIpAddress}
                      />
                      <input
                        name="targetPort"
                        type="text"
                        className="w-16 rounded-sm p-1.5"
                      />
                    </td>
                    <td>
                      <button type="submit" data-intent="add">
                        <CheckIcon className="inline h-6 w-6" />
                      </button>
                      <button onClick={() => setIsAdding(false)}>
                        <XMarkIcon className="ml-1.5 inline h-6 w-6" />
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {!isAdding && (
              <button
                className="p-1 text-blue-400"
                onClick={() => setIsAdding(true)}
              >
                Forward another port
              </button>
            )}
          </Form>
        </div>
      ))}
    </div>
  );
}
