import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { MemberProvider } from './member-context.tsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      // Keep showing the last confirmed data while offline; errors are shown next to it.
      placeholderData: (previous: unknown) => previous,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root ausente');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <MemberProvider>
          <App />
        </MemberProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
