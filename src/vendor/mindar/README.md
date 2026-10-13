# Vendored MindAR

Source: official npm `mind-ar@1.2.5`, MIT license in LICENSE. Three.js is pinned separately. Runtime files are bundled by Vite and served from this site, without a remote CDN dependency.

Local fixes in mindar-image-three.prod.js: retain/remove the resize handler; guard resize before camera startup; use outputColorSpace instead of deprecated outputEncoding; reject asynchronous startup errors; release a camera stream granted after cancellation. Application teardown handles worker, media and renderer cleanup. Keep these patches when upgrading.
