import { matchesFileSignature } from '../src/verification/evidenceSignature';

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
