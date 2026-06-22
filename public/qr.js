// Générateur de QR code minimal, sans dépendance — mode octets, niveau M,
// versions 1 à 4 (suffisant pour une URL courte type https://…/?code=AB).
// Expose window.QR.svg(text, opts) -> chaîne SVG.
(function (global) {
  // Corps de Galois GF(256), polynôme primitif 0x11d.
  const EXP = new Array(512), LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function rsGen(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const r = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { r[j] ^= g[j]; r[j + 1] ^= gmul(g[j], EXP[i]); }
      g = r;
    }
    return g; // longueur n+1, g[0] = 1
  }
  function rsEnc(data, n) {
    const g = rsGen(n);
    const ecc = new Array(n).fill(0);
    for (const d of data) {
      const k = d ^ ecc[0];
      ecc.shift(); ecc.push(0);
      if (k !== 0) for (let j = 0; j < n; j++) ecc[j] ^= gmul(g[j + 1], k);
    }
    return ecc;
  }

  // Capacités (octets), codewords de données, EC/bloc, nb de blocs — niveau M.
  const CAP = { 1: 14, 2: 26, 3: 42, 4: 62 };
  const DATACW = { 1: 16, 2: 28, 3: 44, 4: 64 };
  const ECB = { 1: 10, 2: 16, 3: 26, 4: 18 };
  const NB = { 1: 1, 2: 1, 3: 1, 4: 2 };

  function toBytes(text) {
    const s = unescape(encodeURIComponent(text));
    const a = [];
    for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 0xff);
    return a;
  }

  function encode(text) {
    const bytes = toBytes(text);
    let version = 0;
    for (let v = 1; v <= 4; v++) if (bytes.length <= CAP[v]) { version = v; break; }
    if (!version) throw new Error("QR: texte trop long");
    const totalData = DATACW[version];
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);           // indicateur mode octets
    push(bytes.length, 8);     // compteur (8 bits, versions 1-9)
    for (const b of bytes) push(b, 8);
    const cap = totalData * 8;
    for (let i = 0; i < Math.min(4, cap - bits.length); i++) bits.push(0); // terminateur
    while (bits.length % 8) bits.push(0);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }
    const pad = [0xec, 0x11]; let pi = 0;
    while (cw.length < totalData) cw.push(pad[(pi++) & 1]);
    const nb = NB[version], ecn = ECB[version], per = totalData / nb;
    const dB = [], eB = [];
    for (let b = 0; b < nb; b++) { const blk = cw.slice(b * per, (b + 1) * per); dB.push(blk); eB.push(rsEnc(blk, ecn)); }
    const fin = [];
    for (let i = 0; i < per; i++) for (let b = 0; b < nb; b++) fin.push(dB[b][i]);
    for (let i = 0; i < ecn; i++) for (let b = 0; b < nb; b++) fin.push(eB[b][i]);
    const fbits = [];
    for (const c of fin) for (let i = 7; i >= 0; i--) fbits.push((c >> i) & 1);
    return { version, bits: fbits };
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => ((r >> 1) + ((c / 3) | 0)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function build(version, dataBits) {
    const size = 17 + 4 * version;
    const m = Array.from({ length: size }, () => new Array(size).fill(0));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, v) => { m[r][c] = v ? 1 : 0; fn[r][c] = true; };
    function finder(r, c) {
      for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
        const rr = r + i, cc = c + j;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const d = (i >= 0 && i <= 6 && (j === 0 || j === 6)) || (j >= 0 && j <= 6 && (i === 0 || i === 6)) || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        set(rr, cc, d);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    set(4 * version + 9, 8, true); // module sombre
    const AC = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26] }[version];
    for (const r of AC) for (const c of AC) {
      if (fn[r][c]) continue;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1);
    }
    // réservation des zones d'info de format
    for (let i = 0; i < 9; i++) { if (i !== 6) { fn[8][i] = true; fn[i][8] = true; } }
    for (let i = 0; i < 8; i++) { fn[8][size - 1 - i] = true; fn[size - 1 - i][8] = true; }
    fn[8][8] = true;
    // données en zigzag
    let idx = 0, up = true;
    for (let col = size - 1; col >= 1; col -= 2) {
      if (col === 6) col = 5;
      for (let i = 0; i < size; i++) {
        const row = up ? size - 1 - i : i;
        for (let j = 0; j < 2; j++) {
          const cc = col - j;
          if (!fn[row][cc]) { m[row][cc] = idx < dataBits.length ? dataBits[idx] : 0; idx++; }
        }
      }
      up = !up;
    }
    return { m, fn, size };
  }

  function penalty(m, size) {
    let p = 0;
    const run = (get) => {
      let r = 1;
      for (let i = 1; i < size; i++) { if (get(i) === get(i - 1)) r++; else { if (r >= 5) p += 3 + (r - 5); r = 1; } }
      if (r >= 5) p += 3 + (r - 5);
    };
    for (let r = 0; r < size; r++) run((i) => m[r][i]);
    for (let c = 0; c < size; c++) run((i) => m[i][c]);
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const scan = (line) => {
      for (let i = 0; i + 11 <= line.length; i++) {
        let a = true, b = true;
        for (let k = 0; k < 11; k++) { if (line[i + k] !== pat1[k]) a = false; if (line[i + k] !== pat2[k]) b = false; }
        if (a || b) p += 40;
      }
    };
    for (let r = 0; r < size; r++) scan(m[r]);
    for (let c = 0; c < size; c++) { const col = []; for (let r = 0; r < size; r++) col.push(m[r][c]); scan(col); }
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
    p += Math.floor(Math.abs((dark / (size * size)) * 100 - 50) / 5) * 10;
    return p;
  }

  function formatBits(mask) {
    const data = mask; // niveau M = 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
    return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
  }
  function placeFormat(m, size, fmt) {
    const bit = (i) => (fmt >> i) & 1;
    for (let i = 0; i <= 5; i++) m[8][i] = bit(i);
    m[8][7] = bit(6); m[8][8] = bit(7); m[7][8] = bit(8);
    for (let i = 9; i < 15; i++) m[14 - i][8] = bit(i);
    for (let i = 0; i < 8; i++) m[size - 1 - i][8] = bit(i);
    for (let i = 8; i < 15; i++) m[8][size - 15 + i] = bit(i);
    m[size - 8][8] = 1; // ré-affirme le module sombre (écrasé par le bit 7)
  }

  function matrix(text) {
    const { version, bits } = encode(text);
    const { m, fn, size } = build(version, bits);
    let best = null, bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const mm = m.map((r) => r.slice());
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c] && MASKS[mask](r, c)) mm[r][c] ^= 1;
      placeFormat(mm, size, formatBits(mask));
      const p = penalty(mm, size);
      if (p < bestP) { bestP = p; best = mm; }
    }
    return { size, modules: best };
  }

  function svg(text, opts) {
    opts = opts || {};
    const quiet = opts.quiet == null ? 4 : opts.quiet;
    const { size, modules } = matrix(text);
    const dim = size + quiet * 2;
    const fg = opts.fg || "#0b0e13", bg = opts.bg || "#ffffff";
    let rects = "";
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`;
    const px = opts.px || 180;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" width="${px}" height="${px}"><rect width="${dim}" height="${dim}" fill="${bg}"/><g fill="${fg}">${rects}</g></svg>`;
  }

  global.QR = { matrix, svg, _formatBits: formatBits };
})(typeof window !== "undefined" ? window : globalThis);
