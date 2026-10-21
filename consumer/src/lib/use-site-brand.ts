import { resolveSiteBrand } from './brand'
import { useStatus } from './status'

export function useSiteBrand() {
  return resolveSiteBrand(useStatus().data)
}
