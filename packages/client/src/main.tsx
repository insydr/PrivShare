import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/index.css';

// Initialize WebAssembly error handling
const initWasm = async () => {
  try {
    // Dynamically import the WASM module
    // The actual WASM initialization will happen in the worker
    console.log('[PrivShare] Initializing Zero-Trust Architecture...');
    console.log('[PrivShare] All processing happens locally in your browser.');
    console.log('[PrivShare] Your files never leave your device.');
  } catch (error) {
    console.error('[PrivShare] Failed to initialize:', error);
  }
};

initWasm();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
