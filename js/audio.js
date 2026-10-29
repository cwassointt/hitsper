// Busca el fragmento de 30 s de cada canción en la API pública de iTunes.
const cache = new Map();
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '');

export function findTrack(song) {
  const key = `${song.artist}|${song.title}`;
  if (!cache.has(key)) cache.set(key, lookup(song).catch(() => null));
  return cache.get(key);
}

// Exige el artista correcto (nunca versiones de otros) y la palabra más larga del título;
// si no aparece, devuelve null y el juego cambia de canción.
export function pickTrack(results, song) {
  const artist = norm(song.artist).replace(/^the /, '').split(' ')[0];
  const word = norm(song.title).split(' ').sort((a, b) => b.length - a.length)[0];
  const hit = results.find(r => r.previewUrl && norm(r.artistName).includes(artist) && norm(r.trackName).includes(word));
  return hit ? { preview: hit.previewUrl, art: hit.artworkUrl100?.replace('100x100', '600x600'), name: hit.trackName, by: hit.artistName } : null;
}

async function lookup(song) {
  const term = encodeURIComponent(`${song.artist} ${song.title}`);
  const res = await fetch(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=25`);
  const { results = [] } = await res.json();
  return pickTrack(results, song);
}
