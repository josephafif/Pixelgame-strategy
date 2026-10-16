// Run-length encoding for per-tile arrays (territory, roads, exploration).
// Used by the wire protocol and by saved games.

/** Run-length encode a typed array into [value, count, value, count, ...]. */
export function rle(arr) {
  const out = [];
  let v = arr[0];
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === v) n++;
    else {
      out.push(v, n);
      v = arr[i];
      n = 1;
    }
  }
  out.push(v, n);
  return out;
}

export function unrle(data, Type, length) {
  const out = new Type(length);
  let i = 0;
  for (let k = 0; k < data.length; k += 2) {
    out.fill(data[k], i, i + data[k + 1]);
    i += data[k + 1];
  }
  return out;
}
