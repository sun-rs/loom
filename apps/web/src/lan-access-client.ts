export type LanDevice = {
  createdAt: string;
  deviceId: string;
  displayName: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

export type LanPairingCode = {
  code: string;
  expiresAt: string;
  inviteId: string;
};

export type LanAccessSession =
  | { available: false }
  | { authenticated: false; available: true }
  | { authenticated: true; available: true; device: LanDevice };

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class LanAccessClient {
  readonly #fetch: FetchLike;

  constructor(input: { fetch?: FetchLike } = {}) {
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async session(signal?: AbortSignal): Promise<LanAccessSession> {
    const response = await this.#fetch("/_rah/session", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      method: "GET",
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.status === 404 || !isJsonResponse(response)) {
      return { available: false };
    }
    const body = await readJson(response);
    if (response.status === 401) {
      if (!isRecord(body) || body.authenticated !== false) {
        throw new Error("malformed LAN session response");
      }
      return { authenticated: false, available: true };
    }
    if (!response.ok) throw await responseError(response, body);
    if (!isRecord(body) || body.authenticated !== true) {
      throw new Error("malformed LAN session response");
    }
    return {
      authenticated: true,
      available: true,
      device: parseDevice(body.device),
    };
  }

  async listDevices(signal?: AbortSignal): Promise<LanDevice[]> {
    const body = await this.#json("/_rah/devices", {
      method: "GET",
      ...(signal === undefined ? {} : { signal }),
    });
    if (!isRecord(body) || !Array.isArray(body.devices)) {
      throw new Error("malformed LAN device list");
    }
    return body.devices.map(parseDevice);
  }

  async issuePairingCode(signal?: AbortSignal): Promise<LanPairingCode> {
    const body = await this.#json("/_rah/pairing-codes", {
      method: "POST",
      ...(signal === undefined ? {} : { signal }),
    });
    if (
      !isRecord(body) ||
      typeof body.code !== "string" ||
      !/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/u.test(body.code) ||
      !isTimestamp(body.expiresAt) ||
      typeof body.inviteId !== "string" ||
      body.inviteId.length === 0
    ) {
      throw new Error("malformed LAN pairing-code response");
    }
    return {
      code: body.code,
      expiresAt: body.expiresAt,
      inviteId: body.inviteId,
    };
  }

  async revokeDevice(deviceId: string, signal?: AbortSignal): Promise<void> {
    if (deviceId.length === 0 || deviceId.length > 128) {
      throw new Error("LAN device ID is invalid");
    }
    const response = await this.#fetch(
      `/_rah/devices/${encodeURIComponent(deviceId)}/revoke`,
      {
        body: "{}",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        method: "POST",
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (response.status === 204) return;
    const body = isJsonResponse(response)
      ? await readJson(response)
      : undefined;
    throw await responseError(response, body);
  }

  async #json(
    path: string,
    input: { method: "GET" | "POST"; signal?: AbortSignal },
  ): Promise<unknown> {
    const response = await this.#fetch(path, {
      ...(input.method === "POST"
        ? {
            body: "{}",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
          }
        : { headers: { accept: "application/json" } }),
      credentials: "same-origin",
      method: input.method,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const body = isJsonResponse(response)
      ? await readJson(response)
      : undefined;
    if (!response.ok) throw await responseError(response, body);
    if (body === undefined)
      throw new Error("LAN edge returned a non-JSON response");
    return body;
  }
}

function parseDevice(value: unknown): LanDevice {
  if (
    !isRecord(value) ||
    !isTimestamp(value.createdAt) ||
    typeof value.deviceId !== "string" ||
    value.deviceId.length === 0 ||
    typeof value.displayName !== "string" ||
    value.displayName.length === 0 ||
    !isTimestamp(value.lastSeenAt) ||
    !(value.revokedAt === null || isTimestamp(value.revokedAt))
  ) {
    throw new Error("malformed LAN device");
  }
  return {
    createdAt: value.createdAt,
    deviceId: value.deviceId,
    displayName: value.displayName,
    lastSeenAt: value.lastSeenAt,
    revokedAt: value.revokedAt,
  };
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonResponse(response: Response): boolean {
  return (
    response.headers.get("content-type")?.includes("application/json") === true
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("LAN edge returned malformed JSON");
  }
}

async function responseError(
  response: Response,
  body: unknown,
): Promise<Error> {
  const message =
    isRecord(body) && typeof body.message === "string"
      ? body.message
      : `LAN edge request failed (${String(response.status)})`;
  return new Error(message);
}
