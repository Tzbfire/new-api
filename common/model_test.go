package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsImageGenerationModelRecognizesVersionedGPTImageModels(t *testing.T) {
	assert.True(t, IsImageGenerationModel("gpt-image-1"))
	assert.True(t, IsImageGenerationModel("gpt-image-2"))
	assert.True(t, IsImageGenerationModel("Gpt-Image-Next"))
	assert.False(t, IsImageGenerationModel("gpt-5"))
}
