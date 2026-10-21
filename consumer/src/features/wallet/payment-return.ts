export type PaymentReturn = 'success' | 'fail' | 'pending'

export function paymentReturnSearch(search: Record<string, unknown>): {
  pay?: PaymentReturn
  show_history?: boolean
} {
  const pay = search.pay
  return {
    pay: pay === 'success' || pay === 'fail' || pay === 'pending' ? pay : undefined,
    show_history: search.show_history === true || search.show_history === 'true' ? true : undefined,
  }
}
