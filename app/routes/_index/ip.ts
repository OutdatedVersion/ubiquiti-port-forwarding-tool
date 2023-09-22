let publicIpAddress: string | undefined;
let publicIpAddressExpiresAt = 0;
export const getPublicIpAddress = async () => {
  if (publicIpAddress && publicIpAddressExpiresAt - Date.now() > 0) {
    console.log('Public IP address cache hit');
    return publicIpAddress;
  }

  const ipinfo = await fetch('https://request-ip-address.benn.workers.dev');
  if (ipinfo.ok) {
    publicIpAddress = (await ipinfo.text()).trim();
    const hourMs = 3.6e6;
    publicIpAddressExpiresAt = Date.now() + hourMs * 4;
    console.log(
      `Public IP address retrieved for use until ${new Date(
        publicIpAddressExpiresAt,
      ).toISOString()}`,
    );
    return publicIpAddress;
  }
};
