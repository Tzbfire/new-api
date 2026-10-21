import { ApiError, ensureFreshAuthentication, jsonBody, request } from './api'
import { passwordFields } from './password'
import { passkeyAssertion, type PasskeyFlow } from './passkey'

export interface VerificationMethod {
  method: string
  available: boolean
  reason?: string
}
export interface LoginChallenge {
  require_verification: true
  flow_token: string
  expires_at: number
  methods: VerificationMethod[]
}
export interface SecurityOperation {
  scope: string
  context?: Record<string, unknown>
}
export interface SecurityRequirements {
  scope: string
  methods: VerificationMethod[]
  oauth_providers?: { slug: string; name: string }[]
  password_encryption_enabled: boolean
}
export interface SecurityProof {
  proof_token: string
  expires_at: number
  method: string
  scope: string
}

export async function verifySecurity(
  operation: SecurityOperation,
  requirements: SecurityRequirements,
  method: string,
  value: string,
) {
  await ensureFreshAuthentication()
  if (!requirements.methods.some((item) => item.method === method && item.available))
    throw new ApiError('This verification method is currently unavailable.')
  let proof: SecurityProof
  const details = {
    scope: operation.scope,
    ...(operation.context ? { context: operation.context } : {}),
  }
  if (method === 'passkey') {
    const flow = await request<PasskeyFlow>('/api/user/passkey/verify/begin', {
      method: 'POST',
      ...jsonBody(details),
    })
    const credential = await passkeyAssertion(flow)
    proof = await request<SecurityProof>('/api/user/passkey/verify/finish', {
      method: 'POST',
      ...jsonBody({ flow_token: flow.flow_token, credential }),
    })
  } else {
    proof = await request<SecurityProof>('/api/verify', {
      method: 'POST',
      ...jsonBody({
        ...details,
        method,
        ...(method === 'password'
          ? await passwordFields(value, requirements.password_encryption_enabled)
          : { code: value }),
      }),
    })
  }
  if (
    !proof.proof_token ||
    proof.scope !== operation.scope ||
    proof.expires_at <= Date.now() / 1000
  )
    throw new ApiError('Security verification has expired. Please verify again.')
  return proof.proof_token
}
