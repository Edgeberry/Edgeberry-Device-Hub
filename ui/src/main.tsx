import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'bootstrap/dist/css/bootstrap.min.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
/* Lato, bundled rather than fetched: 400 and 700 only - Bootstrap's
   fw-semibold (600) resolves up to 700. Matches Edgeberry-device-software. */
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import './theme.css';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
