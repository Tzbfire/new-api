import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readStudyAttachment } from '../attachments'

const pdf = vi.hoisted(() => ({ pages: 1, text: 'Explain photosynthesis', destroy: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: pdf.pages,
      getPage: async () => ({ getTextContent: async () => ({ items: [{ str: pdf.text }] }) }),
    }),
    destroy: pdf.destroy,
  }),
}))
function documentFile(name = 'lesson.pdf') {
  const file = new File([], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(0) })
  return file
}
beforeEach(() => {
  pdf.pages = 1
  pdf.text = 'Explain photosynthesis'
  pdf.destroy.mockClear()
})
describe('local study material extraction', () => {
  it('extracts PDF text without uploading the PDF file', async () => {
    expect(await readStudyAttachment(documentFile())).toEqual({
      name: 'lesson.pdf',
      text: 'Explain photosynthesis\n',
    })
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })
  it('rejects scanned PDFs without silently sending an empty document', async () => {
    pdf.text = ' '
    await expect(readStudyAttachment(documentFile())).rejects.toThrow('no extractable text')
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })
  it('rejects PDFs above the page limit and releases parser resources', async () => {
    pdf.pages = 31
    await expect(readStudyAttachment(documentFile())).rejects.toThrow('at most 30 pages')
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })
  it('rejects extracted text beyond the limit rather than silently truncating it', async () => {
    pdf.text = 'x'.repeat(24_001)
    await expect(readStudyAttachment(documentFile())).rejects.toThrow('at most 24,000 characters')
  })
})
