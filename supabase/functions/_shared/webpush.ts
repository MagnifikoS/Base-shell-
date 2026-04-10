/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SHARED — Web Push crypto (VAPID + AES-128-GCM)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SINGLE SOURCE OF TRUTH for Web Push encryption.
 * Used by: notif-check-badgeuse, push-send
 *
 * DO NOT duplicate this code elsewhere.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function sendWebPush(
  endpoint: string,
  p256dhKey: string,
  authSecret: string,
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<Response> {
  const vapidPubKeyData = base64UrlDecode(vapidPublicKey);
  const vapidPrivKeyData = base64UrlDecode(vapidPrivateKey);
  const jwt = await createVapidJwt(endpoint, vapidPrivKeyData, vapidPubKeyData);
  const encrypted = await encryptPayload(p256dhKey, authSecret, payload);

  return await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "Content-Length": String(encrypted.byteLength),
      Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
      TTL: "86400",
      Urgency: "normal",
    },
    body: encrypted,
  });
}

async function createVapidJwt(
  endpoint: string,
  privateKeyRaw: Uint8Array,
  publicKeyRaw: Uint8Array
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const header = { typ: "JWT", alg: "ES256" };
  const jwtPayload = {
    aud: audience,
    exp: expiration,
    sub: "mailto:push@restaurant-os.app",
  };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(jwtPayload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(publicKeyRaw.slice(1, 33)),
    y: base64UrlEncode(publicKeyRaw.slice(33, 65)),
    d: base64UrlEncode(privateKeyRaw),
  };

  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function encryptPayload(
  p256dhKey: string,
  authSecret: string,
  payload: string
): Promise<Uint8Array> {
  const clientPublicKey = base64UrlDecode(p256dhKey);
  const clientAuth = base64UrlDecode(authSecret);
  const payloadBytes = new TextEncoder().encode(payload);

  const ephemeralKey = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
  );

  const clientKey = await crypto.subtle.importKey(
    "raw", clientPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientKey }, ephemeralKey.privateKey, 256
  );

  const ephemeralPubKey = await crypto.subtle.exportKey("raw", ephemeralKey.publicKey);
  const ephemeralPubKeyBytes = new Uint8Array(ephemeralPubKey);
  const sharedSecretBytes = new Uint8Array(sharedSecret);

  const authInfo = new Uint8Array([
    ...new TextEncoder().encode("WebPush: info\0"),
    ...clientPublicKey,
    ...ephemeralPubKeyBytes,
  ]);

  const prkKey = await crypto.subtle.importKey(
    "raw", clientAuth, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, sharedSecretBytes));
  const ikm = await hkdfExpand(prk, authInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const cePrkKey = await crypto.subtle.importKey(
    "raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const cePrk = new Uint8Array(await crypto.subtle.sign("HMAC", cePrkKey, ikm));
  const cek = await hkdfExpand(cePrk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(cePrk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const paddedPayload = new Uint8Array([...payloadBytes, 2]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, paddedPayload);

  const rs = paddedPayload.length + 16;
  const headerBytes = new Uint8Array(16 + 4 + 1 + 65);
  headerBytes.set(salt, 0);
  new DataView(headerBytes.buffer).setUint32(16, rs, false);
  headerBytes[20] = 65;
  headerBytes.set(ephemeralPubKeyBytes, 21);

  const result = new Uint8Array(headerBytes.length + encrypted.byteLength);
  result.set(headerBytes, 0);
  result.set(new Uint8Array(encrypted), headerBytes.length);
  return result;
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const input = new Uint8Array([...info, 1]);
  const output = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
  return output.slice(0, length);
}

export function base64UrlDecode(str: string): Uint8Array {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64UrlEncode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
