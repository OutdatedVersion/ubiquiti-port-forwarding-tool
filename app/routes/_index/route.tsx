import { json, type MetaFunction } from '@remix-run/node';
import {
  TrashIcon,
  CheckCircleIcon,
  PauseCircleIcon,
} from '@heroicons/react/24/solid';
import { useLoaderData } from '@remix-run/react';
import { getPortForwards } from './unifi';
import { env } from '../../env';

export const meta: MetaFunction = () => {
  return [
    { title: 'New Remix App' },
    { name: 'description', content: 'Welcome to Remix!' },
  ];
};

export const loader = async () => {
  const user = {
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
    publicIpAddress: '1.2.3.4',
    servers: user.servers.map((srv) => ({
      ...srv,
      forwards: forwards
        .filter((fwd) => fwd.fwd === srv.privateIpAddress)
        .map((fwd) => ({
          publicPort: parseInt(fwd.dst_port, 10),
          targetPort: parseInt(fwd.fwd_port, 10),
          enabled: fwd.enabled,
        })),
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

export default function Index() {
  const data = useLoaderData<typeof loader>();

  return (
    <div className="m-4">
      <div className="mb-8 w-full bg-sky-300 p-3 rounded-md">
        <h1 className="text-lg font-bold font-mono">{data.publicIpAddress}</h1>
        <h1 className="text-sm">Internet accessible IP address</h1>
        <p className="mt-3">
          Traffic from the Internet to your servers is blocked by default.
        </p>
      </div>

      {data.servers.map((srv) => (
        <div
          key={srv.privateIpAddress}
          className="mt-4 p-3 bg-gray-100 rounded-md"
        >
          <div>
            <h1 className="text-lg font-bold font-mono">
              {srv.privateIpAddress}
            </h1>
            <h1 className="text-sm">
              {srv.cores} vCPU / {formatMemory(srv.memory)} RAM
            </h1>
          </div>

          <table className="mt-4 table-auto w-full">
            <thead>
              <tr className="text-left">
                <th>Internet</th>
                <th>Target</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {srv.forwards.map((fwd) => (
                <tr key={fwd.publicPort}>
                  <td className="py-1.5">:{fwd.publicPort}</td>
                  <td>:{fwd.targetPort}</td>
                  <td>
                    <button>
                      {fwd.enabled ? (
                        <CheckCircleIcon className="inline h-6 w-6 text-green-700" />
                      ) : (
                        <PauseCircleIcon className="inline h-6 w-6 text-red-700" />
                      )}
                    </button>
                    <button>
                      <TrashIcon className="inline ml-1.5 h-5 w-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
