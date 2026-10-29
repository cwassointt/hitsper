// Busca el fragmento de 30 s de cada canción en la API pública de iTunes.
const cache = new Map();
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function findTrack(song) {
  const key = `${song.artist}|${song.title}`;
  if (!cache.has(key)) cache.set(key, lookup(song).catch(() => null));
  return cache.get(key);
}

async function lookup(song) {
  const term = encodeURIComponent(`${song.artist} ${song.title}`);
  const res = await fetch(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=15`);
  const { results = [] } = await res.json();
  const firstWord = norm(song.artist).split(/[\s&,]+/)[0];
  const hit = results.find(r => r.previewUrl && norm(r.artistName).includes(firstWord)) ||
    results.find(r => r.previewUrl);
  return hit ? { preview: hit.previewUrl, art: hit.artworkUrl100?.replace('100x100', '600x600') } : null;
}
