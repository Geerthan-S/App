export function matchesFileSignature(bytes: Buffer, contentType: string): boolean {
  if (contentType === 'application/pdf') return bytes.subarray(0, 4).toString('ascii') === '%PDF';
  if (contentType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}
