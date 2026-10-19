import React from 'react';
import { createRoot } from 'react-dom/client';
import '@mantine/core/styles.css';
import { MantineProvider } from '@mantine/core';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><MantineProvider><App /></MantineProvider></React.StrictMode>);
