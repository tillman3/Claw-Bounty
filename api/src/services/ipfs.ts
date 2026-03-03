/**
 * IPFS/Pinata Integration Service (M-3 scaffolding)
 *
 * Provides functions to pin JSON data to IPFS via Pinata.
 * Requires PINATA_API_KEY and PINATA_SECRET_KEY env vars to be set.
 *
 * NOT wired into the main flow yet — this is scaffolding for future use.
 */

const PINATA_BASE_URL = "https://api.pinata.cloud";

interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

interface PinOptions {
  name?: string;
  keyvalues?: Record<string, string>;
}

/**
 * Pin a JSON object to IPFS via Pinata
 * @param data - JSON-serializable object to pin
 * @param options - Optional metadata (name, key-value pairs)
 * @returns The IPFS CID (content identifier)
 * @throws If Pinata credentials are missing or the request fails
 */
export async function pinJSON(data: unknown, options?: PinOptions): Promise<string> {
  const apiKey = process.env.PINATA_API_KEY;
  const secretKey = process.env.PINATA_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error("IPFS: PINATA_API_KEY and PINATA_SECRET_KEY must be set in environment");
  }

  const body = {
    pinataContent: data,
    pinataMetadata: {
      name: options?.name || "abb-data",
      keyvalues: options?.keyvalues || {},
    },
  };

  const response = await fetch(`${PINATA_BASE_URL}/pinning/pinJSONToIPFS`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      pinata_api_key: apiKey,
      pinata_secret_api_key: secretKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pinata pin failed (${response.status}): ${text}`);
  }

  const result = (await response.json()) as PinataResponse;
  return result.IpfsHash;
}

/**
 * Fetch JSON from IPFS via a public gateway
 * @param cid - The IPFS CID to fetch
 * @returns Parsed JSON data
 */
export async function fetchFromIPFS<T = unknown>(cid: string): Promise<T> {
  const gateway = process.env.IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs";
  const response = await fetch(`${gateway}/${cid}`);

  if (!response.ok) {
    throw new Error(`IPFS fetch failed (${response.status}): ${cid}`);
  }

  return response.json() as Promise<T>;
}
