export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const temp = new Uint8Array(a.length + b.length);
  temp.set(a);
  temp.set(b, a.length);
  return temp;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}
