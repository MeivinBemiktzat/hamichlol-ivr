const DEFAULT_CHUNK_SIZE = 600;

function cleanTtsText(text) {
  return String(text || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[.]/g, ',')
    .replace(/-/g, ' ')
    .replace(/&/g, ' ו ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitText(text, maxLength = Number(process.env.TTS_CHUNK_SIZE || DEFAULT_CHUNK_SIZE)) {
  const cleaned = cleanTtsText(text);
  if (!cleaned) return [];

  const chunks = [];
  let remaining = cleaned;

  while (remaining.length > maxLength) {
    let cut = Math.max(
      remaining.lastIndexOf(',', maxLength),
      remaining.lastIndexOf('!', maxLength),
      remaining.lastIndexOf('?', maxLength),
      remaining.lastIndexOf(':', maxLength),
    );
    if (cut < Math.floor(maxLength * 0.55)) cut = remaining.lastIndexOf(' ', maxLength);
    if (cut <= 0) cut = maxLength;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function readResponse(prompt, parameterSpec) {
  return `read=${prompt}=${parameterSpec}`;
}

function idListMessageResponse(items) {
  return `id_list_message=${items.join('.')}`;
}

function textMessageResponse(text, chunkSize) {
  const chunks = splitText(text, chunkSize);
  return idListMessageResponse(chunks.map((chunk) => `t-${chunk}`));
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  cleanTtsText,
  splitText,
  readResponse,
  idListMessageResponse,
  textMessageResponse,
};
