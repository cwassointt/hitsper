# HITSTER (versión web)

Juego musical para jugar con amigos en **un solo dispositivo**: suena una canción y cada jugador debe colocarla en el año correcto de su línea del tiempo. Gana quien llegue primero a 10 cartas.

- Reglas oficiales: fichas HITSTER (saltar, desafiar, comprar carta), modos Normal, PRO, Experto y Cooperativo.
- Música: fragmentos de 30 s de la API pública de iTunes (sin cuentas ni claves).
- Sin base de datos: la partida se guarda en el navegador y se puede continuar tras recargar.
- HTML + CSS + JavaScript sin compilación.

## Jugar en local

```bash
python -m http.server 5173
```

Abre http://localhost:5173

## Tests de reglas

```bash
npm test
```

## Añadir canciones

Edita `js/songs.js`: cada entrada es `[título, artista, año de lanzamiento original]`.

## Desplegar en Vercel

1. En vercel.com → *Add New → Project* → importa este repositorio de GitHub.
2. Framework: **Other**, sin comando de build, directorio raíz `./`.
3. *Deploy*. Cada `git push` a `main` vuelve a publicar.
