// Typen fuer tsc --checkJs (jsconfig.json): Browser-Erweiterungen und Testzugang, die das Spiel nutzt
interface Window {
  __game: any;
  resizeGame: () => void;
  webkitAudioContext: typeof AudioContext;
}

// Trystero wird zur Laufzeit vom CDN geladen
declare module 'https://cdn.jsdelivr.net/*';
