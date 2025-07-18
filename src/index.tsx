import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { ThemeModeProvider } from './theme/theme';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

console.log('Starting to render React app');

root.render(
  <React.StrictMode>
    <ThemeModeProvider>
      <App />
    </ThemeModeProvider>
  </React.StrictMode>
);

reportWebVitals();
