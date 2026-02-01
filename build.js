// Build script to inject Netlify environment variables into HTML files
const fs = require('fs');
const path = require('path');

const apiKey = process.env.VENICE_API_KEY || '';

if (!apiKey) {
  console.warn('⚠️  Warning: VENICE_API_KEY environment variable is not set');
  console.warn('   The app will still work if you have config.js or a meta tag with the API key');
} else {
  console.log('✅ VENICE_API_KEY found, injecting into HTML files');
}

// Escape the API key for safe injection into JavaScript
const escapedApiKey = apiKey ? apiKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"') : '';

// Create the script injection
const scriptInjection = apiKey ? `
  <script>
    // API key injected from Netlify environment variable
    window.VENICE_API_KEY = '${escapedApiKey}';
  </script>` : '';

// HTML files to process
const htmlFiles = ['index.html', 'dashboard.html'];

htmlFiles.forEach(filename => {
  const htmlPath = path.join(__dirname, filename);

  // Check if file exists
  if (!fs.existsSync(htmlPath)) {
    console.log(`ℹ️  ${filename} not found, skipping`);
    return;
  }

  let html = fs.readFileSync(htmlPath, 'utf8');

  // Replace the config.js script tag with the injected script (if API key exists)
  // If no API key, keep the config.js fallback
  if (apiKey) {
    html = html.replace(
      /<script src="config\.js"[^>]*><\/script>/,
      scriptInjection
    );
    console.log(`✅ API key injected into ${filename}`);
  } else {
    console.log(`ℹ️  No API key to inject into ${filename}, using config.js fallback`);
  }

  // Write the updated HTML
  fs.writeFileSync(htmlPath, html, 'utf8');
});

console.log('✅ Build complete');

