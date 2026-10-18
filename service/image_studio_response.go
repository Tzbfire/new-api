package service

import "context"

var imageStudioLegacyResponseSlot = make(chan struct{}, 1)

// AcquireImageStudioLegacyResponseSlot serializes memory-heavy provider
// adapters that have not implemented the Studio streaming sink yet.
func AcquireImageStudioLegacyResponseSlot(ctx context.Context) (func(), error) {
	select {
	case imageStudioLegacyResponseSlot <- struct{}{}:
		return func() { <-imageStudioLegacyResponseSlot }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
