// Aplica o tema antes da renderização para evitar flash de cor.
// Arquivo separado (e não inline) para funcionar com a Content-Security-Policy de produção.
try {
  var t = localStorage.getItem('studio85_theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
