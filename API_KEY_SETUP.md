# API Key Setup

The application now uses environment variables to store the Venice AI API key securely.

## For Netlify Deployment (Recommended)

### Static HTML App (index.html)

1. In Netlify Dashboard:
   - Go to **Site settings** > **Environment variables**
   - Add a new variable:
     - **Key**: `VENICE_API_KEY`
     - **Value**: `your-actual-api-key-here`
   - Click **Save**

2. The build script (`build.js`) will automatically inject the API key during deployment.

### React App (venice-multi-chat)

1. In Netlify Dashboard:
   - Go to **Site settings** > **Environment variables**
   - Add a new variable:
     - **Key**: `REACT_APP_VENICE_API_KEY`
     - **Value**: `your-actual-api-key-here`
   - Click **Save**

2. Netlify will automatically use this during the React build process.

## For Local Development

### Static HTML App

1. Copy `config.js.example` to `config.js`:
   ```bash
   cp config.js.example config.js
   ```

2. Edit `config.js` and add your API key:
   ```javascript
   window.VENICE_API_KEY = 'your-actual-api-key-here';
   ```

### React App

1. Copy `.env.example` to `.env` in the `venice-multi-chat` directory:
   ```bash
   cd venice-multi-chat
   cp .env.example .env
   ```

2. Edit `.env` and add your API key:
   ```
   REACT_APP_VENICE_API_KEY=your-actual-api-key-here
   ```

3. Restart the React development server for changes to take effect.

## Security Notes

- Never commit `config.js` or `.env` files to version control
- Add them to `.gitignore`:
  ```
  config.js
  venice-multi-chat/.env
  ```
- For Netlify, environment variables are encrypted and only accessible during builds

