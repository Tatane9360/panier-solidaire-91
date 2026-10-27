# Modules ECMAScript plutôt que CommonJS

Le code utilise ESM (`"type": "module"` dans `package.json`, `import`/`export`), le format natif de Node.js 26 et celui des exemples de `node:test`. Revenir à CommonJS obligerait à réécrire chaque import du projet ; mélanger les deux formats est exclu.
