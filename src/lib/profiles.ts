import { circlesConfig } from "@/lib/circles";

type ProfileResult = {
  name?: string;
};

function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

export async function loadProfileNames(addresses: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(addresses.map(normalizeAddress).filter(Boolean))];
  if (!unique.length) return {};

  const entries = await Promise.all(unique.map(async (address) => {
    try {
      const response = await fetch(circlesConfig.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: address,
          method: "circles_getProfileByAddress",
          params: [address]
        })
      });
      if (!response.ok) return null;
      const payload = await response.json() as { result?: ProfileResult | null };
      const name = payload.result?.name?.trim();
      return name ? [address, name] as const : null;
    } catch {
      return null;
    }
  }));

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
}
