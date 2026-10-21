import { ApiError, jsonBody, request } from './api'
import type { AuthBundle } from './auth-state'

export interface PasskeyFlow {
  flow_token: string
  expires_at: number
  options: { publicKey: unknown }
  rp_ids?: string[]
}

export async function passkeyAssertion(flow: PasskeyFlow) {
  if (!flow.flow_token || flow.expires_at <= Date.now() / 1000)
    throw new ApiError('Verification flow expired')
  if (!window.isSecureContext || !window.PublicKeyCredential)
    throw new ApiError('Passkeys require a supported browser and HTTPS')
  const { startAuthentication } = await import('@simplewebauthn/browser')
  try {
    return await startAuthentication({
      optionsJSON: flow.options.publicKey as Parameters<
        typeof startAuthentication
      >[0]['optionsJSON'],
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError'))
      throw new ApiError('Passkey verification was cancelled or timed out')
    throw error
  }
}

export async function signInWithPasskey(loginFlow?: string, rpID?: string): Promise<AuthBundle> {
  const prefix = loginFlow ? '/api/user/login/passkey' : '/api/user/passkey/login'
  const flow = await request<PasskeyFlow>(`${prefix}/begin`, {
    method: 'POST',
    ...jsonBody({
      ...(loginFlow ? { flow_token: loginFlow } : {}),
      ...(rpID ? { rp_id: rpID } : {}),
    }),
  })
  const credential = await passkeyAssertion(flow)
  return request<AuthBundle>(`${prefix}/finish`, {
    method: 'POST',
    ...jsonBody(
      loginFlow
        ? { flow_token: loginFlow, passkey_flow_token: flow.flow_token, credential }
        : { flow_token: flow.flow_token, credential },
    ),
  })
}

export async function registerPasskey(proof: string) {
  const flow = await request<PasskeyFlow>('/api/user/passkey/register/begin', {
    method: 'POST',
    headers: { 'X-Security-Proof': proof },
  })
  if (flow.expires_at <= Date.now() / 1000) throw new ApiError('Verification flow expired')
  const { startRegistration } = await import('@simplewebauthn/browser')
  const credential = await startRegistration({
    optionsJSON: flow.options.publicKey as Parameters<typeof startRegistration>[0]['optionsJSON'],
  })
  await request('/api/user/passkey/register/finish', {
    method: 'POST',
    ...jsonBody({ flow_token: flow.flow_token, credential }),
  })
}
