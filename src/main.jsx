import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './styles/task-contrast.css';
import { initGcalPrefs } from './lib/gcalPrefs.js';
import { initTaskContrast } from './lib/taskContrast.js';

initGcalPrefs();
initTaskContrast();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
