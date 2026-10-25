/* SpectroScope parsers & DSP — extracted unchanged from the original app */
class FFT {
    constructor(size) {
        this.size = size; this.sinTable = new Float32Array(size); this.cosTable = new Float32Array(size); this.reverseTable = new Uint32Array(size);
        for (let i = 0; i < size; i++) { this.sinTable[i] = Math.sin(-Math.PI * 2 * i / size); this.cosTable[i] = Math.cos(-Math.PI * 2 * i / size); }
        let limit = 1; let bit = size >> 1;
        while (limit < size) { for (let i = 0; i < limit; i++) { this.reverseTable[i + limit] = this.reverseTable[i] + bit; } limit = limit << 1; bit = bit >> 1; }
    }
    forward(real) {
        const size = this.size; const imag = new Float32Array(size);
        for (let i = 0; i < size; i++) { let j = this.reverseTable[i]; if (j > i) { let temp = real[i]; real[i] = real[j]; real[j] = temp; } }
        for (let step = 1; step < size; step <<= 1) {
            let jump = step << 1; let tablestep = size / jump;
            for (let group = 0; group < step; group++) {
                let k = group * tablestep; let c = this.cosTable[k]; let s = this.sinTable[k];
                for (let pair = group; pair < size; pair += jump) {
                    let match = pair + step;
                    let tpre = real[match] * c - imag[match] * s; let tpim = imag[match] * c + real[match] * s;
                    real[match] = real[pair] - tpre; imag[match] = imag[pair] - tpim; real[pair] += tpre; imag[pair] += tpim;
                }
            }
        }
        const magnitudes = new Float32Array(size / 2);
        for(let i = 0; i < size / 2; i++) {
            let mag = Math.sqrt(real[i]*real[i] + imag[i]*imag[i]) / (size / 2);
            let db = 20 * Math.log10(mag + 1e-6); magnitudes[i] = Math.max(-120, db);
        }
        return magnitudes;
    }
}

const colorStops = [
    { db: -110, rgb: [0, 0, 0] }, { db: -90,  rgb: [43, 2, 85] },
    { db: -60,  rgb: [180, 20, 90] }, { db: -30,  rgb: [240, 150, 20] },
    { db: 0,    rgb: [252, 255, 164] }
];

function getRGB(db) {
    if (db <= colorStops[0].db) return colorStops[0].rgb;
    if (db >= colorStops[colorStops.length-1].db) return colorStops[colorStops.length-1].rgb;
    for (let i = 0; i < colorStops.length - 1; i++) {
        if (db >= colorStops[i].db && db <= colorStops[i+1].db) {
            const range = colorStops[i+1].db - colorStops[i].db;
            const p = (db - colorStops[i].db) / range;
            const r = colorStops[i].rgb[0] + p * (colorStops[i+1].rgb[0] - colorStops[i].rgb[0]);
            const g = colorStops[i].rgb[1] + p * (colorStops[i+1].rgb[1] - colorStops[i].rgb[1]);
            const b = colorStops[i].rgb[2] + p * (colorStops[i+1].rgb[2] - colorStops[i].rgb[2]);
            return [r, g, b];
        }
    }
    return [0,0,0];
}

function applyHannWindow(buffer) {
    const size = buffer.length;
    for (let i = 0; i < size; i++) buffer[i] = buffer[i] * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds === Infinity) return "0:00";
    const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
function getTrueAudioMetadata(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const meta = { sampleRate: null, bitDepth: null, isLossless: false };
    if (view.byteLength < 4) return meta;

    try {
        // 1. Check FLAC
        if (view.getUint32(0, false) === 0x664C6143) {
            meta.isLossless = true;
            meta.sampleRate = (view.getUint8(18) << 12) | (view.getUint8(19) << 4) | (view.getUint8(20) >> 4);
            meta.bitDepth = (((view.getUint8(20) & 0x01) << 4) | (view.getUint8(21) >> 4)) + 1;
            return meta;
        }
        
        // 2. Check WAV
        if (view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645) {
            meta.isLossless = true;
            let offset = 12;
            while (offset < view.byteLength && offset < 1024) {
                if (view.getUint32(offset, false) === 0x666D7420) {
                    meta.sampleRate = view.getUint32(offset + 12, true);
                    meta.bitDepth = view.getUint16(offset + 22, true);
                    break;
                }
                offset += 8 + view.getUint32(offset + 4, true);
            }
            return meta;
        }

        // 3. Scan Lossy Formats
        const scanLimit = Math.min(view.byteLength, 131072);
        for (let i = 0; i < scanLimit - 8; i++) {
            if (view.getUint32(i, false) === 0x6D646864) {
                const version = view.getUint8(i + 4);
                meta.sampleRate = version === 0 ? view.getUint32(i + 16, false) : view.getUint32(i + 24, false);
                return meta;
            }
            if (view.getUint32(i, false) === 0x4F707573 && view.getUint32(i + 4, false) === 0x48656164) {
                meta.sampleRate = 48000; return meta;
            }
            if (view.getUint8(i) === 0x01 && view.getUint32(i+1, false) === 0x766F7262 && view.getUint16(i+5, false) === 0x6973) {
                meta.sampleRate = view.getUint32(i + 12, true); return meta;
            }
        }

        // MP3 Fallback Scan
        let mp3Offset = 0;
        if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
            mp3Offset = 10 + ((view.getUint8(6) << 21) | (view.getUint8(7) << 14) | (view.getUint8(8) << 7) | view.getUint8(9));
        }
        if (mp3Offset < scanLimit - 2) {
            for (let i = mp3Offset; i < scanLimit - 2; i++) {
                if (view.getUint8(i) === 0xFF && (view.getUint8(i+1) & 0xE0) === 0xE0) {
                    const layer = (view.getUint8(i+1) & 0x06) >> 1;
                    const version = (view.getUint8(i+1) & 0x18) >> 3;
                    const srIndex = (view.getUint8(i+2) & 0x0C) >> 2;
                    if (layer !== 0 && version !== 1 && srIndex !== 3) {
                        const rates = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
                        if (rates[version] && rates[version][srIndex]) {
                            meta.sampleRate = rates[version][srIndex];
                            return meta;
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn("Could not parse binary header.", e);
    }
    return meta;
}

function normalizePicture(picture) {
    if (!picture || picture.data == null) return null;
    let bytes;
    try {
        const value = picture.data;
        if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
        else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        else if (Array.isArray(value)) bytes = new Uint8Array(value);
        else if (value && value.buffer instanceof ArrayBuffer) {
            bytes = new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength || value.buffer.byteLength);
        } else return null;
    } catch (error) {
        console.warn('Could not normalize embedded cover art.', error);
        return null;
    }
    if (!bytes || bytes.length < 4) return null;
    const mime = inferImageMime(bytes, picture.format);
    if (!mime) return null;
    return { data: bytes, format: mime };
}

function inferImageMime(bytes, declaredFormat) {
    const raw = String(declaredFormat || '').trim().toLowerCase();
    const declared = raw.startsWith('image/') ? raw : ({
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
        webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml'
    })[raw.replace(/^\./, '')] || '';
    // Sniff file signatures instead of trusting inconsistent MIME labels in tags.
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    if (declared === 'image/jpg') return 'image/jpeg';
    if (['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/avif', 'image/svg+xml'].includes(declared)) return declared;
    return null;
}

function readUint32BE(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length) return null;
    return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function readSynchsafe32(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length) return null;
    return ((bytes[offset] & 0x7F) << 21) | ((bytes[offset + 1] & 0x7F) << 14) |
           ((bytes[offset + 2] & 0x7F) << 7) | (bytes[offset + 3] & 0x7F);
}

function pictureFromBytes(bytes, format) {
    if (!bytes || bytes.length < 4) return null;
    const mime = inferImageMime(bytes, format);
    return mime ? { data: bytes, format: mime } : null;
}

function parseId3Picture(bytes, offset = 0, boundary = bytes.length) {
    if (offset + 10 > boundary || bytes[offset] !== 0x49 || bytes[offset + 1] !== 0x44 || bytes[offset + 2] !== 0x33) return null;
    const version = bytes[offset + 3];
    if (version < 2 || version > 4) return null;
    const tagSize = readSynchsafe32(bytes, offset + 6);
    if (tagSize == null) return null;
    const end = Math.min(boundary, offset + 10 + tagSize);
    let cursor = offset + 10;
    const flags = bytes[offset + 5];
    // ID3v2.3/v2.4 can contain an extended header before the first frame.
    if (flags & 0x40) {
        if (cursor + 4 > end) return null;
        if (version === 3) {
            const extendedSize = readUint32BE(bytes, cursor);
            if (extendedSize == null) return null;
            cursor += 4 + extendedSize;
        } else if (version === 4) {
            const extendedSize = readSynchsafe32(bytes, cursor);
            if (extendedSize == null || extendedSize < 4) return null;
            cursor += extendedSize;
        }
    }
    const headerSize = version === 2 ? 6 : 10;
    while (cursor + headerSize <= end) {
        const idLength = version === 2 ? 3 : 4;
        let frameId = '';
        for (let i = 0; i < idLength; i++) frameId += String.fromCharCode(bytes[cursor + i]);
        if (!frameId.trim() || [...frameId].some(ch => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) > 0x7E)) break;
        let frameSize;
        if (version === 2) frameSize = (bytes[cursor + 3] << 16) | (bytes[cursor + 4] << 8) | bytes[cursor + 5];
        else if (version === 4) frameSize = readSynchsafe32(bytes, cursor + 4);
        else frameSize = readUint32BE(bytes, cursor + 4);
        if (!frameSize || frameSize < 1 || cursor + headerSize + frameSize > end) break;
        if (frameId === 'APIC' || frameId === 'PIC') {
            const frameStart = cursor + headerSize;
            const frameEnd = frameStart + frameSize;
            const encoding = bytes[frameStart];
            let mime = '';
            let mimeEnd;
            let picTypeOffset;
            if (frameId === 'APIC') {
                mimeEnd = frameStart + 1;
                while (mimeEnd < frameEnd && bytes[mimeEnd] !== 0) mimeEnd++;
                if (mimeEnd >= frameEnd) return null;
                for (let i = frameStart + 1; i < mimeEnd; i++) mime += String.fromCharCode(bytes[i]);
                picTypeOffset = mimeEnd + 1;
            } else {
                if (frameStart + 5 >= frameEnd) return null;
                const fmt = String.fromCharCode(bytes[frameStart + 1], bytes[frameStart + 2], bytes[frameStart + 3]).toLowerCase();
                mime = fmt === 'jpg' || fmt === 'jpeg' ? 'image/jpeg' : fmt === 'png' ? 'image/png' : fmt;
                picTypeOffset = frameStart + 4;
            }
            if (mime.startsWith('-->') || picTypeOffset >= frameEnd) return null;
            const descStart = picTypeOffset + 1;
            let imageStart = -1;
            if (encoding === 1 || encoding === 2) {
                for (let i = descStart; i + 1 < frameEnd; i += 2) {
                    if (bytes[i] === 0 && bytes[i + 1] === 0) { imageStart = i + 2; break; }
                }
            } else {
                for (let i = descStart; i < frameEnd; i++) {
                    if (bytes[i] === 0) { imageStart = i + 1; break; }
                }
            }
            if (imageStart >= 0 && imageStart < frameEnd) return pictureFromBytes(bytes.subarray(imageStart, frameEnd), mime);
        }
        cursor += headerSize + frameSize;
    }
    return null;
}

function parseFlacPictureBlock(bytes, start, end) {
    let cursor = start;
    const takeLength = () => {
        const value = readUint32BE(bytes, cursor);
        if (value == null) throw new Error('Truncated FLAC picture block');
        cursor += 4;
        return value;
    };
    try {
        takeLength(); // picture type
        const mimeLength = takeLength();
        if (mimeLength > end - cursor) return null;
        let mime = '';
        for (let i = 0; i < mimeLength; i++) mime += String.fromCharCode(bytes[cursor + i]);
        cursor += mimeLength;
        const descriptionLength = takeLength();
        if (descriptionLength > end - cursor) return null;
        cursor += descriptionLength;
        // width, height, color depth, indexed-color count
        if (cursor + 16 > end) return null;
        cursor += 16;
        const imageLength = takeLength();
        if (imageLength < 4 || imageLength > end - cursor) return null;
        return pictureFromBytes(bytes.subarray(cursor, cursor + imageLength), mime);
    } catch (_) {
        return null;
    }
}

function parseFlacPicture(bytes) {
    if (bytes.length < 8 || bytes[0] !== 0x66 || bytes[1] !== 0x4C || bytes[2] !== 0x61 || bytes[3] !== 0x43) return null;
    let cursor = 4;
    while (cursor + 4 <= bytes.length) {
        const header = bytes[cursor];
        const type = header & 0x7F;
        const length = (bytes[cursor + 1] << 16) | (bytes[cursor + 2] << 8) | bytes[cursor + 3];
        const start = cursor + 4;
        const end = start + length;
        if (end > bytes.length || end < start) return null;
        if (type === 6) {
            const picture = parseFlacPictureBlock(bytes, start, end);
            if (picture) return picture;
        }
        cursor = end;
        if (header & 0x80) break;
    }
    return null;
}

function parseMp4Cover(bytes) {
    const knownContainers = new Set(['moov', 'udta', 'meta', 'ilst', 'trak', 'mdia', 'minf', 'stbl', 'moof', 'traf']);
    let found = null;
    function scan(start, end, insideCovr, depth) {
        if (depth > 16 || found) return;
        let cursor = start;
        while (cursor + 8 <= end && cursor + 8 <= bytes.length) {
            let size = readUint32BE(bytes, cursor);
            const type = String.fromCharCode(bytes[cursor + 4], bytes[cursor + 5], bytes[cursor + 6], bytes[cursor + 7]);
            let headerSize = 8;
            if (size === 1) {
                const high = readUint32BE(bytes, cursor + 8);
                const low = readUint32BE(bytes, cursor + 12);
                if (high == null || low == null) return;
                size = high * 0x100000000 + low;
                headerSize = 16;
            } else if (size === 0) size = end - cursor;
            if (size < headerSize || cursor + size > end || cursor + size > bytes.length) return;
            if (type === 'data' && insideCovr && size >= headerSize + 8) {
                const dataType = readUint32BE(bytes, cursor + headerSize);
                const dataStart = cursor + headerSize + 8;
                const picture = pictureFromBytes(bytes.subarray(dataStart, cursor + size), dataType === 14 ? 'image/png' : dataType === 13 ? 'image/jpeg' : '');
                if (picture) { found = picture; return; }
            }
            if (type === 'covr') {
                scan(cursor + headerSize, cursor + size, true, depth + 1);
            } else if (knownContainers.has(type)) {
                let childStart = cursor + headerSize;
                if (type === 'meta') childStart += 4; // FullBox version + flags
                if (childStart <= cursor + size) scan(childStart, cursor + size, insideCovr, depth + 1);
            }
            cursor += size;
        }
    }
    scan(0, bytes.length, false, 0);
    return found;
}

// Ogg stores Opus/Vorbis comments inside packets; a packet may span multiple Ogg pages.
// Reading raw bytes alone misses comments when page lacing splits them.
function parseOggComments(bytes) {
    const packets = [];
    let packetParts = [];
    let cursor = 0;
    while (cursor + 27 <= bytes.length) {
        if (bytes[cursor] !== 0x4F || bytes[cursor + 1] !== 0x67 || bytes[cursor + 2] !== 0x67 || bytes[cursor + 3] !== 0x53) {
            cursor++;
            continue;
        }
        const segments = bytes[cursor + 26];
        if (cursor + 27 + segments > bytes.length) break;
        const lacingStart = cursor + 27;
        let dataCursor = lacingStart + segments;
        let validPage = true;
        for (let i = 0; i < segments; i++) {
            const length = bytes[lacingStart + i];
            if (dataCursor + length > bytes.length) { validPage = false; break; }
            packetParts.push(bytes.subarray(dataCursor, dataCursor + length));
            dataCursor += length;
            if (length < 255) {
                let total = 0;
                for (const part of packetParts) total += part.length;
                const packet = new Uint8Array(total);
                let out = 0;
                for (const part of packetParts) { packet.set(part, out); out += part.length; }
                packets.push(packet);
                packetParts = [];
            }
        }
        if (!validPage) break;
        cursor = dataCursor;
    }
    const readLE32 = (arr, at) => at + 4 <= arr.length ? (arr[at] | (arr[at+1] << 8) | (arr[at+2] << 16) | (arr[at+3] << 24)) >>> 0 : null;
    const decoder = new TextDecoder('utf-8', { fatal: false });
    for (const packet of packets) {
        let offset = 0;
        if (packet.length >= 8 && decoder.decode(packet.subarray(0, 8)) === 'OpusTags') offset = 8;
        else if (packet.length >= 7 && packet[0] === 3 && decoder.decode(packet.subarray(1, 7)) === 'vorbis') offset = 7;
        else continue;
        const vendorLength = readLE32(packet, offset);
        if (vendorLength == null || vendorLength > packet.length - offset - 4) continue;
        offset += 4 + vendorLength;
        const count = readLE32(packet, offset);
        if (count == null || count > 10000) continue;
        offset += 4;
        const tags = {};
        for (let i = 0; i < count && offset + 4 <= packet.length; i++) {
            const length = readLE32(packet, offset); offset += 4;
            if (length == null || length > packet.length - offset) break;
            const value = decoder.decode(packet.subarray(offset, offset + length)); offset += length;
            const eq = value.indexOf('=');
            if (eq <= 0) continue;
            const key = value.slice(0, eq).trim().toUpperCase();
            const val = value.slice(eq + 1).trim();
            if (!val) continue;
            const map = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumartist', ALBUM_ARTIST: 'albumartist', GENRE: 'genre', DATE: 'year', YEAR: 'year', TRACKNUMBER: 'track', COMPOSER: 'composer', COMMENT: 'comment' };
            if (key === 'METADATA_BLOCK_PICTURE') {
                try {
                    const binary = atob(val);
                    const block = new Uint8Array(binary.length);
                    for (let j = 0; j < binary.length; j++) block[j] = binary.charCodeAt(j);
                    tags.picture = parseFlacPictureBlock(block, 0, block.length) || tags.picture;
                } catch (_) { /* ignore malformed picture comment */ }
            } else if (map[key] && !tags[map[key]]) tags[map[key]] = val;
            else if (key === 'COVERART' && !tags.picture) {
                try {
                    const binary = atob(val);
                    const art = new Uint8Array(binary.length);
                    for (let j = 0; j < binary.length; j++) art[j] = binary.charCodeAt(j);
                    tags.picture = pictureFromBytes(art, '');
                } catch (_) { /* ignore malformed legacy cover */ }
            }
        }
        return tags;
    }
    return {};
}

function parseOggPicture(bytes) {
    const needle = 'METADATA_BLOCK_PICTURE=';
    const target = Array.from(needle, ch => ch.charCodeAt(0));
    let searchFrom = 0;
    while (searchFrom <= bytes.length - target.length) {
        const i = bytes.indexOf(target[0], searchFrom);
        if (i < 0 || i > bytes.length - target.length) break;
        searchFrom = i + 1;
        let match = true;
        for (let j = 1; j < target.length; j++) if (bytes[i + j] !== target[j]) { match = false; break; }
        if (!match) continue;
        let end = i + target.length;
        while (end < bytes.length) {
            const b = bytes[end];
            if (!((b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39) || b === 0x2B || b === 0x2F || b === 0x3D)) break;
            end++;
        }
        try {
            const encodedBytes = bytes.subarray(i + target.length, end);
            let encoded = '';
            for (let offset = 0; offset < encodedBytes.length; offset += 8192) {
                encoded += String.fromCharCode(...encodedBytes.subarray(offset, Math.min(offset + 8192, encodedBytes.length)));
            }
            const binary = atob(encoded);
            const block = new Uint8Array(binary.length);
            for (let j = 0; j < binary.length; j++) block[j] = binary.charCodeAt(j);
            return parseFlacPictureBlock(block, 0, block.length);
        } catch (_) { /* try another comment occurrence */ }
    }
    return null;
}

function extractEmbeddedPicture(arrayBuffer, fileName) {
    try {
        const bytes = new Uint8Array(arrayBuffer);
        const ext = String(fileName || '').split('.').pop().toLowerCase();
        if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
            const picture = parseId3Picture(bytes);
            if (picture) return picture;
        }
        if (ext === 'flac' || (bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43)) {
            const picture = parseFlacPicture(bytes);
            if (picture) return picture;
        }
        if (['m4a', 'mp4', 'alac', 'aac'].includes(ext) || (bytes.length >= 8 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp')) {
            const picture = parseMp4Cover(bytes);
            if (picture) return picture;
        }
        if (['ogg', 'oga', 'opus'].includes(ext)) {
            const picture = parseOggPicture(bytes);
            if (picture) return picture;
        }
        if (ext === 'wav' || ext === 'wave' || ext === 'aiff' || ext === 'aif') {
            // Some WAV/AIFF files carry an ID3 chunk with APIC/PIC artwork.
            for (let i = 12; i + 10 < bytes.length; i++) {
                const id3Chunk = bytes[i] === 0x49 && bytes[i + 1] === 0x44 && bytes[i + 2] === 0x33;
                if (id3Chunk) {
                    const picture = parseId3Picture(bytes, i);
                    if (picture) return picture;
                }
            }
        }
    } catch (error) {
        console.warn('Fallback cover-art extraction failed.', error);
    }
    return null;
}

