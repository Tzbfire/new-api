export type StudyAttachment = { name: string; text?: string; image?: string }

export async function readStudyAttachment(file: File): Promise<StudyAttachment> {
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose a file smaller than 8 MB.')
  if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    const image = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('The file could not be read.'))
      reader.readAsDataURL(file)
    })
    return { name: file.name, image }
  }
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
    try {
      const pdf = await task.promise
      if (pdf.numPages > 30) throw new Error('Choose a PDF with at most 30 pages.')
      let text = ''
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number)
        const content = await page.getTextContent()
        text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + '\n'
        if (text.length > 24_000)
          throw new Error('Study material must contain at most 24,000 characters.')
      }
      if (!text.trim())
        throw new Error(
          'This PDF has no extractable text. Use OCR or attach page images with a vision model.',
        )
      return { name: file.name, text }
    } finally {
      await task.destroy()
    }
  }
  if (!/\.(txt|md|csv)$/i.test(file.name))
    throw new Error('Choose a PNG, JPEG, WebP, PDF, TXT, Markdown, or CSV file.')
  const text = await file.text()
  if (!text.trim()) throw new Error('The file contains no text.')
  if (text.length > 24_000)
    throw new Error('Study material must contain at most 24,000 characters.')
  return { name: file.name, text }
}
