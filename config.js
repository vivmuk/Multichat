// config.js — API key placeholder for local/self-hosted use.
// On Netlify/Railway with VENICE_API_KEY set, build.js replaces this script tag
// with an inline window.VENICE_API_KEY assignment before deployment.
// Without an env var the app will prompt the user to enter their key via the auth modal.
if (typeof window !== 'undefined' && !window.VENICE_API_KEY) {
  window.VENICE_API_KEY = '';
}
