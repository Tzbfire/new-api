package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestImageStudioJobBodyRoundTrip(t *testing.T) {
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	key, err := StageImageStudioJobBody("task_job_1", "application/json", []byte(`{"n":1}`))
	require.NoError(t, err)
	ct, body, err := LoadImageStudioJobBody(key)
	require.NoError(t, err)
	require.Equal(t, "application/json", ct)
	require.Equal(t, []byte(`{"n":1}`), body)
	RemoveImageStudioJobBody(key)
	_, _, err = LoadImageStudioJobBody(key)
	require.Error(t, err)
}
