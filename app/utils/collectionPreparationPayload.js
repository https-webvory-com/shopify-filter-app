import {deflateSync, inflateSync} from 'node:zlib';

// Public rankings are ID lists, not product documents. Compress them so catalog
// coverage does not require retaining hundreds of megabytes of repeated IDs.
export function encodePreparation(value) {
  const json=JSON.stringify(value);
  return json.length<4096 ? json : 'z1:'+deflateSync(json).toString('base64');
}

export function decodePreparation(raw) {
  return JSON.parse(raw?.startsWith('z1:')
    ? inflateSync(Buffer.from(raw.slice(3),'base64'),{maxOutputLength:32*1024*1024}).toString()
    : raw);
}
