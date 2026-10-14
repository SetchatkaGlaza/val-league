import './styles/base.css';
import './styles/auth.css';
import './styles/doc.css';
import './styles/app.css';
import { initBackground } from './js/background.js';
import { motion, $ } from './js/ui.js';
import { assets } from './js/layouts.js';
import { start } from './js/app.js';

// Фон создаётся один раз и живёт между всеми страницами — поэтому переходы не «мигают».
if (motion) initBackground($('#bg'));

start();

// Когда браузер освободится, заранее грузим картинки обоих каркасов, чтобы первый переход не моргал.
const warm = () => Object.values(assets).forEach((src) => { const i = new Image(); i.src = src; });
if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 3000 });
else setTimeout(warm, 1200);
