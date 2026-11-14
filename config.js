// config.js — optional local key for the chat and benchmark pages.
// Leave it empty in the repository: visitors enter their own Venice key in the
// chat, and it stays in their browser. The model catalogue never needs a key.
if (typeof window !== 'undefined' && !window.VENICE_API_KEY) {
  window.VENICE_API_KEY = '';
}
