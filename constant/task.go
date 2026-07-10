package constant

type TaskPlatform string

const (
	TaskPlatformSuno        TaskPlatform = "suno"
	TaskPlatformMidjourney               = "mj"
	TaskPlatformImageStudio              = "image_studio"
)

const (
	SunoActionMusic  = "MUSIC"
	SunoActionLyrics = "LYRICS"

	TaskActionGenerate          = "generate"
	TaskActionTextGenerate      = "textGenerate"
	TaskActionFirstTailGenerate = "firstTailGenerate"
	TaskActionReferenceGenerate = "referenceGenerate"
	TaskActionRemix             = "remixGenerate"
	TaskActionImageGeneration   = "imageGeneration"
	TaskActionImageEdit         = "imageEdit"
)

var SunoModel2Action = map[string]string{
	"suno_music":  SunoActionMusic,
	"suno_lyrics": SunoActionLyrics,
}
