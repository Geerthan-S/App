import { matchesFileSignature } from '../src/verification/evidenceSignature';
import { displayFileName } from '../src/verification/evidenceFileName';

describe('Evidence file signature screening', () => {
  test('accepts bytes that match PDF, PNG, and JPEG MIME types', () => {
    expect(matchesFileSignature(Buffer.from('%PDF-1.7'), 'application/pdf')).toBe(true);
    expect(matchesFileSignature(Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png')).toBe(true);
    expect(matchesFileSignature(Buffer.from('ffd8ffdb', 'hex'), 'image/jpeg')).toBe(true);
  });

  test('rejects a file disguised by MIME type', () => {
    expect(matchesFileSignature(Buffer.from('<script>'), 'application/pdf')).toBe(false);
    expect(matchesFileSignature(Buffer.from('%PDF-1.7'), 'image/png')).toBe(false);
    expect(matchesFileSignature(Buffer.from('ffd8ffdb', 'hex'), 'application/octet-stream')).toBe(false);
  });
});

describe('Evidence display file name', () => {
  test('keeps an ordinary file name', () => {
    expect(displayFileName('TNMC certificate.pdf')).toBe('TNMC certificate.pdf');
  });

  test('strips path separators and control characters, and caps the length', () => {
    expect(displayFileName('../../etc/pass\u0000wd.pdf')).toBe('....etcpasswd.pdf');
    expect(displayFileName('a'.repeat(300))).toHaveLength(120);
  });

  test('returns null for missing or empty names', () => {
    expect(displayFileName(undefined)).toBeNull();
    expect(displayFileName(' \n ')).toBeNull();
  });
});
