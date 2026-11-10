# Neon Rush — Runner de combate 3D

Un arcade runner en tercera persona creado con Vite y Three.js.

## Descripción

Pilota un dron de combate por una autopista infinita: esquiva barreras, derriba enemigos, recoge celdas de energía y encadena combos para lograr la mayor puntuación. La velocidad y la dificultad aumentan con la distancia recorrida.

## Características

- Runner infinito con generación procedural de obstáculos, enemigos y power-ups
- Tres tipos de enemigos: swarm, turret (dispara) y blocker (resistente)
- Dash invulnerable, escudo y fuego rápido
- Sistema de combo multiplicador y récord local (localStorage)
- Pantallas de menú, pausa y fin de juego con estadísticas
- Feedback visual: flash de daño, números flotantes, hit-stop, shake de cámara y viñeta de velocidad
- Audio sintetizado con Web Audio (silenciable con M)

## Controles

- **A / D** o **← / →**: mover
- **W** o **↑**: disparar hacia adelante
- **Espacio / Shift**: dash
- **P**: pausa · **M**: sonido · **Enter**: iniciar/reintentar

## Scripts disponibles

- `npm run dev` - Inicia el servidor de desarrollo Vite
- `npm run build` - Construye la aplicación para producción
- `npm run preview` - Vista previa del build de producción

## Tecnologías

- [Vite](https://vitejs.dev/) - Build tool y dev server
- [Three.js](https://threejs.org/) - Librería 3D

## Licencia

MIT
