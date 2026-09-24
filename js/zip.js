// zip.js — minimal ZIP writer (no dependencies).
//
// Enough of PKZIP to package a batch of generated files for download: local
// headers, a central directory, and an end-of-central-directory record. Entries
// are DEFLATE-compressed via CompressionStream where the browser offers it and
// stored uncompressed otherwise — LTC is a square wave, so it deflates by an
// order of magnitude and the difference between a 3 MB and a 55 MB download is
// worth the fifteen lines.
//
// No Zip64: callers cap total output well under 4 GB.

let _crcTable = null;
function crcTable() {
  if (_crcTable) return _crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  _crcTable = t;
  return t;
}

export function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time, the format ZIP has carried since 1989. */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    // Pathological input can deflate larger than it started; store it instead.
    return out.length < bytes.length ? out : null;
  } catch {
    return null;   // unsupported or failed — the caller stores the entry
  }
}

const utf8 = s => new TextEncoder().encode(s);

/**
 * Build a ZIP archive.
 *
 * @param {Array<{name: string, data: Uint8Array|ArrayBuffer|string}>} entries
 * @param {{ compress?: boolean, date?: Date, onProgress?: (done:number,total:number)=>void }} opts
 * @returns {Promise<Blob>}
 */
export async function zipFiles(entries, opts = {}) {
  const { compress = true, date = new Date(), onProgress = null } = opts;
  const { time: dosTime, date: dosDate } = dosDateTime(date);

  const chunks = [];        // assembled into a Blob — never one contiguous buffer
  const central = [];
  let offset = 0;

  const push = (bytes) => { chunks.push(bytes); offset += bytes.length; };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const raw = typeof entry.data === 'string' ? utf8(entry.data)
      : entry.data instanceof Uint8Array ? entry.data
        : new Uint8Array(entry.data);
    const name = utf8(entry.name);

    const crc = crc32(raw);
    const deflated = compress ? await deflateRaw(raw) : null;
    const body = deflated || raw;
    const method = deflated ? 8 : 0;

    const localOffset = offset;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);        // version needed
    local.setUint16(6, 0x0800, true);    // UTF-8 filename flag
    local.setUint16(8, method, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);        // extra field length
    push(new Uint8Array(local.buffer));
    push(name);
    push(body);

    central.push({ name, crc, csize: body.length, usize: raw.length, method, localOffset });
    onProgress?.(i + 1, entries.length);
  }

  const cdStart = offset;
  for (const e of central) {
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true);
    h.setUint16(4, 20, true);            // version made by
    h.setUint16(6, 20, true);            // version needed
    h.setUint16(8, 0x0800, true);
    h.setUint16(10, e.method, true);
    h.setUint16(12, dosTime, true);
    h.setUint16(14, dosDate, true);
    h.setUint32(16, e.crc, true);
    h.setUint32(20, e.csize, true);
    h.setUint32(24, e.usize, true);
    h.setUint16(28, e.name.length, true);
    h.setUint16(30, 0, true);            // extra
    h.setUint16(32, 0, true);            // comment
    h.setUint16(34, 0, true);            // disk number start
    h.setUint16(36, 0, true);            // internal attrs
    h.setUint32(38, 0, true);            // external attrs
    h.setUint32(42, e.localOffset, true);
    push(new Uint8Array(h.buffer));
    push(e.name);
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, central.length, true);
  end.setUint16(10, central.length, true);
  end.setUint32(12, offset - cdStart, true);
  end.setUint32(16, cdStart, true);
  end.setUint16(20, 0, true);
  push(new Uint8Array(end.buffer));

  return new Blob(chunks, { type: 'application/zip' });
}
