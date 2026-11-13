import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { bootstrap } from '@/app/providers/bootstrap';
import { registerServiceWorker } from '@/app/serviceWorker';
import '@/styles/index.css';

registerServiceWorker();

const root = createRoot(document.getElementById('root')!);

bootstrap()
  .catch((err) => console.error('[FileShare] startup', err))
  .finally(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
