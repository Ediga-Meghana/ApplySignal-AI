// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateResumeFile, extractResumeText, ResumeError, MAX_RESUME_BYTES } from './resume'
const fx = (n: string, type: string) => { const b = readFileSync(new URL(`./fixtures/${n}`, import.meta.url)); return new File([b], n, { type }) }
const head = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0])
describe('validateResumeFile', () => {
  it('accepts real signatures', () => { expect(validateResumeFile({ name: 'a.PDF', size: 10 }, head(0x25, 0x50, 0x44, 0x46))).toBe('pdf'); expect(validateResumeFile({ name: 'a.docx', size: 10 }, head(0x50, 0x4b, 3, 4))).toBe('docx') })
  it('rejects bad type, empty, oversize, and disguised files', () => { for (const [n, s, h] of [['a.exe', 5, head(0x4d, 0x5a)], ['a.pdf', 0, head(0x25, 0x50, 0x44, 0x46)], ['a.pdf', MAX_RESUME_BYTES + 1, head(0x25, 0x50, 0x44, 0x46)], ['a.pdf', 5, head(0x4d, 0x5a)], ['a.docx', 5, head(0x25, 0x50, 0x44, 0x46)]] as const) expect(() => validateResumeFile({ name: n, size: s }, h)).toThrow(ResumeError) })
})
describe('extractResumeText', () => {
  it('reads DOCX', async () => { expect((await extractResumeText(fx('resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).text).toContain('Python, SQL, React') })
  it('reads text PDF', async () => { expect((await extractResumeText(fx('resume.pdf', 'application/pdf'))).text).toContain('Built a REST API') })
  it('explains scanned/blank PDFs', async () => { await expect(extractResumeText(fx('scanned.pdf', 'application/pdf'))).rejects.toThrow(/scanned|OCR/i) })
  it('rejects a corrupted file with a safe message', async () => { await expect(extractResumeText(new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4, 5, 6])], 'x.pdf'))).rejects.toThrow(ResumeError) })
})
