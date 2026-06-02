import { withTimeout } from "./async";
import { getCurrentSession, getSupabaseProjectUrl, getSupabasePublishableKey } from "./supabase";

async function parseEdgeResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    let message = text || `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error || parsed.message || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

export async function invokePublicEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  const response = await withTimeout(
    fetch(`${getSupabaseProjectUrl()}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        apikey: getSupabasePublishableKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    20_000,
    `${name} istegi zaman asimina ugradi.`,
  );

  return parseEdgeResponse<T>(response);
}

export async function invokeAuthedEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  const session = await getCurrentSession();
  if (!session?.access_token) {
    throw new Error("Bu işlem için giriş yapmalısın.");
  }

  const response = await withTimeout(
    fetch(`${getSupabaseProjectUrl()}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        apikey: getSupabasePublishableKey(),
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    20_000,
    `${name} istegi zaman asimina ugradi.`,
  );

  return parseEdgeResponse<T>(response);
}
