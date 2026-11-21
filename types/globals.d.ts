// Types for tsc --checkJs (jsconfig.json): browser extensions and test access used by the game
interface Window {
  __game: any;
  resizeGame: () => void;
  webkitAudioContext: typeof AudioContext;
}

// Trystero is loaded from the CDN at runtime
declare module 'https://cdn.jsdelivr.net/*';
