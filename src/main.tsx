import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { EngineLab } from './ui/EngineLab';
import './ui/base.css';
import './ui/game.css';

// 주소에 ?lab 이 있으면 엔진 시험 화면을 연다
const lab = new URLSearchParams(window.location.search).has('lab');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {lab ? <EngineLab /> : <App />}
  </StrictMode>,
);
