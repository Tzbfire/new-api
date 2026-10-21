import { ApiError, request } from './api'

export function base64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

// 遵循后端 RSA-OAEP / v2 混合加密协议，失败时禁止回退明文登录。
export async function passwordFields(
  password: string,
  encrypted: boolean,
): Promise<Record<string, string>> {
  if (!encrypted) return { password }
  if (!globalThis.crypto?.subtle)
    throw new ApiError('A secure HTTPS connection is required to sign in')
  const key = await request<{ enabled: boolean; kid: string; public_key: string }>(
    '/api/user/login/encryption-key',
  )
  if (!key.enabled || !key.kid || !key.public_key)
    throw new ApiError('The sign-in encryption key is unavailable')
  const pem = key.public_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const der = Uint8Array.from(atob(pem), (letter) => letter.charCodeAt(0))
  const publicKey = await crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
  const plaintext = new TextEncoder().encode(password)
  let ciphertext: string
  if (
    plaintext.byteLength <=
    (publicKey.algorithm as RsaHashedKeyAlgorithm).modulusLength / 8 - 66
  ) {
    ciphertext = base64(await crypto.subtle.encrypt('RSA-OAEP', publicKey, plaintext))
  } else {
    const secret = crypto.getRandomValues(new Uint8Array(32))
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const aesKey = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt'])
    const [wrapped, payload] = await Promise.all([
      crypto.subtle.encrypt(
        { name: 'RSA-OAEP', label: new TextEncoder().encode('password-v2') },
        publicKey,
        secret,
      ),
      crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: nonce,
          additionalData: new TextEncoder().encode(`password-v2:${key.kid}`),
        },
        aesKey,
        plaintext,
      ),
    ])
    ciphertext = ['v2', base64(wrapped), base64(nonce.buffer), base64(payload)].join('.')
  }
  return { password_encrypted: ciphertext, encryption_key_id: key.kid }
}
