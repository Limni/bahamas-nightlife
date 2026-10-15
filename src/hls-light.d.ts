// hls.js ships types for its full build only; the light build (no subtitles,
// DRM or alternate audio, about half the size) has the same API.
declare module 'hls.js/light' {
  export { default } from 'hls.js';
}
