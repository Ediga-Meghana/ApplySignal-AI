export const MAX_RESUME_BYTES = 5 * 1024 * 1024
export const MAX_RESUME_CHARS = 15000 // matches the AI function's input limit
export class ResumeError extends Error {}
export type ResumeKind = 'pdf' | 'docx'
/** Checks extension, size AND magic bytes (so a renamed .exe is rejected). Files are never executed or uploaded. */
export function validateResumeFile(f: { name: string; size: number }, head: Uint8Array): ResumeKind {
  const ext = f.name.toLowerCase().split('.').pop()
  if (ext !== 'pdf' && ext !== 'docx') throw new ResumeError('Only PDF and DOCX files are supported.')
  if (f.size === 0) throw new ResumeError('The file is empty.')
  if (f.size > MAX_RESUME_BYTES) throw new ResumeError('The file is larger than 5 MB.')
  const sig = (...b: number[]) => b.every((x, i) => head[i] === x)
  if (ext === 'pdf' ? !sig(0x25, 0x50, 0x44, 0x46) : !sig(0x50, 0x4b, 0x03, 0x04)) throw new ResumeError(`This file does not look like a real .${ext} file.`)
  return ext
}
export async function extractResumeText(file: File, opts: { pdfWorkerSrc?: string; ocr?: boolean } = {}): Promise<{ text: string; truncated: boolean }> {
  const buf = await file.arrayBuffer()
  const kind = validateResumeFile(file, new Uint8Array(buf.slice(0, 8)))
  let text = ''
  let pdfDocument: { numPages: number; getPage: (n: number) => Promise<any> } | null = null
  try {
    if (kind === 'docx') { const mammoth = await import('mammoth'); text = (await mammoth.extractRawText(typeof Buffer !== 'undefined' ? { buffer: Buffer.from(buf) } : { arrayBuffer: buf })).value }
    else {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      if (opts.pdfWorkerSrc) pdfjs.GlobalWorkerOptions.workerSrc = opts.pdfWorkerSrc
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
      pdfDocument = doc
      const pages: string[] = []
      for (let i = 1; i <= Math.min(doc.numPages, 10); i++) { const c = await (await doc.getPage(i)).getTextContent(); pages.push(c.items.map(it => ('str' in it ? it.str : '')).join(' ')) }
      text = pages.join('\n\n')
    }
  } catch { throw new ResumeError('This file could not be read. It may be corrupted or password-protected.') }
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length < 30 && kind === 'pdf' && pdfDocument && opts.ocr) {
    try { const { ocrPdfDocument } = await import('./ocr'); text = (await ocrPdfDocument(pdfDocument)).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() }
    catch (e) { throw new ResumeError(`No readable text was found and OCR could not run: ${e instanceof Error ? e.message : 'unknown OCR error'}`) }
  }
  if (text.length < 30) throw new ResumeError('No readable text was found. This may be a scanned document. Enable OCR or paste the text instead.')
  return { text: text.slice(0, MAX_RESUME_CHARS), truncated: text.length > MAX_RESUME_CHARS }
}
